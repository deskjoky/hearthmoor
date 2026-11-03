# Hearthmoor

A medieval merchant-to-ruler life sim for phones, played in the browser. This is the first playable chapter: start with nothing, gather grain and wood, run a bakery, hire a worker, read the ledger to see why you earned or lost money, and upgrade from a bread stand to a stone bakery.

**Play:** https://deskjoky.github.io/hearthmoor/

## How it is built

- `src/sim.js`: the whole simulation (economy, villager routines, worker, ledger explanations, saving). Plain JavaScript with no graphics, so it can be tested on its own.
- `src/index.src.html`: the 3D village (Three.js r128), the HUD, and the book-style menus.
- `src/test.js`: headless tests. Run `cd src && node test.js`.
- `build.py`: combines the sources into `index.html`. Run `python3 build.py` after editing anything in `src/`.
- `vendor/three.min.js`: Three.js r128 (MIT licence, see `vendor/THREE-LICENSE`).

Saves are kept in the browser's local storage, with a backup copy and an export code on the book's Save page.
