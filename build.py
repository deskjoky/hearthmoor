"""Builds the game from src/.
   index.html          -> the GitHub Pages version (full page, local Three.js)
   dist/artifact.html  -> the Claude artifact version (Three.js from cdnjs)
   Run: python3 build.py"""
import os, json, datetime
BUILD = datetime.datetime.utcnow().strftime('%Y.%m.%d.%H%M')
src = open('src/index.src.html').read()
sim = open('src/sim.js').read()
body = src.replace('<script>/*SIM*/</script>', '<script>\n' + sim + '\n</script>').replace('/*BUILD*/', BUILD)
body = '\n'.join(l for l in body.split('\n') if not l.startswith('window.__hm ='))
os.makedirs('dist', exist_ok=True)
open('dist/artifact.html', 'w').write(body)
page = body.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#35251b">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n'
        '<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-title" content="Hearthmoor">\n'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n'
        '<link rel="icon" type="image/svg+xml" href="icons/icon.svg">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n')
end = page.index('</style>') + len('</style>')
open('index.html', 'w').write(head + page[:end] + '\n</head>\n<body>\n' + page[end:] + '\n</body>\n</html>\n')
# a test copy that keeps the debug hook
test = src.replace('/*BUILD*/', 'test').replace('<script>/*SIM*/</script>', '<script>\n' + sim + '\n</script>').replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js')
open('dist/test.html', 'w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + test + '</body></html>')
json.dump({'build': BUILD}, open('version.json', 'w'))
print('built', BUILD)
