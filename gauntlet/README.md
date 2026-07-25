# Gauntlet

A modern take on **Gauntlet II** (Atari, 1986) in vanilla JavaScript and HTML5
canvas. Four heroes, generated dungeons, monster nests that never stop, and a
health bar that drains whether or not anything is hitting you.

No engine, no framework, no bundler, no dependencies, and no binary assets —
every sprite, every sound effect and the music are generated at runtime.

**[▶ Play](https://bartbeecoders.github.io/Claudegames/gauntlet/)**

## Running locally

Nothing to install. Open `index.html`, or serve it:

```sh
npm start          # zero-dependency static server on :8081
```

It also builds to a single self-contained HTML file:

```sh
npm run build      # -> dist/gauntlet.html
```

### Controls

| Key | Action |
| --- | --- |
| `←` `→` `↑` `↓` or `WASD` | Move (eight-way) |
| `Space` | Fire the way you are facing |
| drag with the mouse | Aim and fire toward the cursor |
| `Q` / `E` / `Shift` | Use magic |
| `Enter` | Start / choose hero |
| `P` | Pause |
| `M` | Mute |
| `F` | Fullscreen |

On touch it is a twin-stick game — see [On a phone](#on-a-phone).

## On a phone

The whole screen is the controller, and neither stick is drawn until a thumb
lands, so nothing has to be aimed for blind.

- **Left half — move.** A floating stick appears wherever your left thumb goes.
  Tilt to steer; the further you push, the faster you run.
- **Right half — aim and fire.** Holding fires. Tilt to shoot in that
  direction; hold without tilting to keep shooting the way you are walking.
- **Magic** is the round button in the bottom-right corner, showing how many
  potions you are carrying.
- Pause, mute and fullscreen sit in the top-right corner.

Portrait is the intended orientation. Taking damage, blasting a nest and dying
each give a short haptic buzz on devices that support it; muting silences that
too.

To play on an iPhone or iPad the game needs to be served over HTTP — iOS cannot
open a multi-file site from the Files app. Serve it over your Wi-Fi with
`npm start`, put it on any static host, or build the single-file bundle and
AirDrop `dist/gauntlet.html` to the phone, which opens fine from Files and works
offline.

Tap **Share → Add to Home Screen** for a fullscreen icon with no Safari chrome.
The first tap also unlocks audio; iOS will not play sound until you touch the
page.

## The heroes

Each plays differently, and the trade-offs are shown on the select screen.

| | Speed | Shot | Armour | Magic |
| --- | --- | --- | --- | --- |
| **Warrior** (Thor) | medium | strongest | good | weakest |
| **Valkyrie** (Thyra) | medium | strong | best | weak |
| **Wizard** (Merlin) | medium | weakest | worst | strongest |
| **Elf** (Questor) | fastest | weak | worst | weak |

Armour scales incoming damage, so the Valkyrie soaks roughly twice what the
Wizard does. Magic scales the potion blast, which is the only thing that clears
a room — or drives off Death.

## What's in it

- **Generated dungeons.** Rooms are scattered, joined by two-wide L-shaped
  corridors, then furnished. Every level is verified finishable before you see
  it: the game floods the map from your feet to the exit and rerolls the level
  if it cannot get there.
- **Monster nests.** The generators are the real objective. They spawn until
  destroyed, faster on later levels, and the status bar counts what is left.
- **Six monsters.** Grunts chase and hit. Ghosts are quicker and burst on
  contact. Demons shoot. Lobbers keep their distance and arc shots *over* the
  walls. Sorcerers phase in and out. **Death** cannot be shot at all — it eats
  your health in great bites until a potion drives it off.
- **Locked vaults.** A walled strongroom inside a room, holding treasure and a
  potion, with its key somewhere else on the level. Vaults are only ever built
  inside rooms, never across a corridor, so a locked door can never cut off
  the exit — and the key is never sealed inside the vault it opens.
- **Food, potions, treasure and keys**, and an exit chevron at the screen edge
  so a big level never turns into a search of every corridor.
- **The drain.** Health falls constantly. Food is the only thing that buys
  time, and when you get low the game tells you so.

## How it works

Roughly 1,500 lines of plain JavaScript across eight files, loaded as ordinary
`<script>` tags in dependency order. No modules, no build step for development.

Everything is generated at runtime: sprites are baked once from character grids
into offscreen canvases, the 5×7 font is a bitmap table, and the audio is
synthesised with WebAudio. The four heroes share one pair of humanoid grids and
differ only by palette, which is how the arcade original got four characters out
of very little ROM.

The music is a slow minor ostinato sequenced on the WebAudio clock rather than
on `requestAnimationFrame`, scheduled a fraction of a second ahead so it keeps
time regardless of frame rate, and resyncing rather than catching up after a
backgrounded tab.

Movement is resolved one axis at a time against the tile grid, which is what
lets everything slide along a wall instead of sticking to it — worth having when
a horde is herding you down a corridor.

```
index.html          markup, styles and the script list
build.mjs           inlines everything into dist/gauntlet.html
server.mjs          zero-dependency static server for local play
src/util.js         constants, math helpers, eight-way headings
src/audio.js        WebAudio sound effects and the music sequencer
src/sprites.js      pixel art baked to offscreen canvases
src/dungeon.js      level generation and tile rendering
src/entities.js     heroes, monsters, generators, shots, pickups
src/hud.js          5x7 bitmap font and the status bar
src/game.js         state machine, level population, collisions
src/main.js         canvas scaling, twin-stick input, game loop
```

## Licence

MIT — see [LICENSE](../LICENSE). Gauntlet is a trademark of its respective
owner; this is an independent tribute written from scratch, using no original
assets or code.
