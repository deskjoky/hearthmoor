"""Builds index.html (the playable game) from src/. Run: python3 build.py"""
src = open('src/index.src.html').read()
sim = open('src/sim.js').read()
body = src.replace('<script>/*SIM*/</script>', '<script>\n' + sim + '\n</script>')
body = body.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'vendor/three.min.js')
body = '\n'.join(l for l in body.split('\n') if not l.startswith('window.__hm ='))
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
title_end = body.index('</style>') + len('</style>')
html = head + body[:title_end] + '\n</head>\n<body>\n' + body[title_end:] + '\n</body>\n</html>\n'
open('index.html', 'w').write(html)
print('wrote index.html', len(html), 'bytes')
