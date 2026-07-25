# Claude Games

Things built from scratch in vanilla JavaScript — arcade games on HTML5 canvas
and a château in WebGL. No engine, no framework, no bundler, and no binary
assets: every sprite, sound, texture and font is generated at runtime.

**[▶ Play](https://bartbeecoders.github.io/claudegames/)**

## Games

| | | |
| --- | --- | --- |
| **[Galaga](galaga/)** | The 1981 Namco classic — formation entrances, diving attacks, tractor-beam capture, dual fighter, challenging stages. | [source](galaga/) · [readme](galaga/README.md) |
| **[Gauntlet](gauntlet/)** | Four heroes and endless generated dungeons — monster nests, locked vaults, magic potions, Death itself, and a health bar that never stops draining. | [source](gauntlet/) · [readme](gauntlet/README.md) |

## Not a game

| | | |
| --- | --- | --- |
| **[Cheverny](cheverny/)** | A real-time 3D model of the Château de Cheverny, built from photographs — bell domes, banded ashlar, a dry moat, an arcaded bridge, and a sun you can move across the sky. Every surface is a noise function; there is no mesh or texture file anywhere. | [source](cheverny/) · [readme](cheverny/README.md) |

## Running locally

Nothing to install. Open `index.html`, or serve it:

```sh
npm start          # zero-dependency static server, prints its LAN address
```

Each project also works straight from `file://`, and builds to a single
self-contained HTML file:

```sh
npm run build      # -> galaga/dist/galaga.html, gauntlet/dist/gauntlet.html, ...
```

Everything works on a phone. Galaga is one-thumb (drag to steer, automatic
fire); Gauntlet is twin-stick (left thumb moves, right thumb aims and fires);
Cheverny is drag to orbit, pinch to zoom.

## Deploying

The repository root is already a working static site, so any static host will
serve it as-is. `.github/workflows/deploy.yml` publishes to GitHub Pages on
every push to `main` — the one-time setup is *Settings → Pages → Source:
**GitHub Actions***.

## Adding a project

Each project is a self-contained folder with its own `index.html`, `src/` and
README. Drop it in, add a card to the root `index.html`, add a row to the table
above, and add it to `build` and `check` in the root `package.json`.

## Licence

MIT — see [LICENSE](LICENSE). Game titles referenced here are trademarks of
their respective owners; these are independent tributes written from scratch,
using no original assets or code.
