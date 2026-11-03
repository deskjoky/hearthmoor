# Hearthmoor

A medieval merchant-to-ruler life sim for phones, played in the browser. Chapter One, The Hired Hand: arrive with 5 coins, work shifts at one of four village shops to learn a trade, then open your own bakery, smithy, tavern or joinery on an empty lot. Hire workers, read the ledger to see why you earned or lost money, and upgrade each shop through three buildings. Chapter Two, A Place in the Village: meet the elder, end a grain shortage, give jobless villagers work, rebuild the watchtower, and take a council seat with a village chest, projects, a travelers' toll and disputes to settle, ending with a summons from Lord Varrow's steward. Optional: buy and rent out a cottage, fill merchant orders, sell a shop to change trades. Includes a title screen, three save slots, and a records page for each playthrough.

**Play:** https://deskjoky.github.io/hearthmoor/

## How it is built

- `src/sim.js`: the whole simulation (economy, villager routines, worker, ledger explanations, saving). Plain JavaScript with no graphics, so it can be tested on its own.
- `src/index.src.html`: the 3D village (Three.js r128), the HUD, and the book-style menus.
- `src/test.js`: headless tests. Run `cd src && node test.js`.
- `build.py`: combines the sources into `index.html`. Run `python3 build.py` after editing anything in `src/`.
- `vendor/three.min.js`: Three.js r128 (MIT licence, see `vendor/THREE-LICENSE`).

Saves are kept in the browser's local storage, with a backup copy and an export code on the book's Save page.
