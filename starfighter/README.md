# Starfighter

A 3D space shooter in vanilla JavaScript and WebGL, in the spirit of the
rebel-fighter dogfights and trench runs of early-eighties space opera. Fly a
four-cannon fighter through fighter screens, gut a capital ship, then take the
run down the battle station trench and put a torpedo in the exhaust port.

No engine, no framework, no bundler, no dependencies and no binary assets. The
renderer is written directly against WebGL, every ship and every square metre
of the trench is generated from boxes and lathes at load time, every sound is
synthesised in the browser, and the score is sequenced live.

**[▶ Play](https://bartbeecoders.github.io/claudegames/starfighter/)**

## Running locally

Nothing to install. Open `index.html`, or serve it:

```sh
npm start          # zero-dependency static server on :8082
```

It also builds to a single self-contained HTML file:

```sh
npm run build      # -> dist/starfighter.html
```

## Controls

| Input | Action |
| --- | --- |
| move the **mouse** | Fly. The further from centre, the harder the turn |
| `←` `→` `↑` `↓` or `WASD` | Fly, if you would rather use keys |
| **click** or `Space` | Cannons |
| **right click** or `F` | Proton torpedo (needs a lock) |
| `Shift` | Boost |
| `Q` / `E` | Roll |
| `Z` / `X` | Throttle down / up |
| `C` | Chase view / cockpit view |
| `Enter` | Launch, and fly again after you are hit |
| `P` or `Esc` | Pause |
| `M` | Mute |
| `Shift`+`F` | Fullscreen |
| `I` | Frame counter |

Pull back to climb, as in an aircraft. With the roll keys untouched the ship
banks into its own turns and rolls its wings level again afterwards, so you
always have a horizon to fly against; hold `Q` or `E` and that assist gets out
of the way, which is how you go inverted over a dreadnought's bridge tower.

## How a run goes

A run is three stages, and clearing all three loops you back to the first one
sector deeper and a notch harder — forever, or until something hits you.

1. **Patrol.** Three waves of enemy fighters over an asteroid drift. Standard
   fighters first, then interceptors that out-turn you and bombers that do not
   but hit hard. Your wing flies with you and fights on its own.
2. **Dreadnought.** A two-kilometre capital ship arrives with its own fighter
   screen. Its hull shrugs off everything while any of the three shield domes
   on its spine is standing; drop all three, then work the engine bank at the
   stern, which takes triple damage. Its turrets will be tracking you the
   whole time.
3. **Trench run.** Fourteen kilometres of corridor, flat out, with wall
   turrets, gantries to duck and pillars to thread. Climb above the lip and
   the surface batteries get a clear shot at you. At the end is the exhaust
   port: cannons will not crack it, so hold the reticle on it until the lock
   closes and put a torpedo down the shaft.

## Targeting

The reticle is fixed at the centre of the screen — that is where the cannons
are pointing, harmonised on a point 700 metres out. The floating circle is the
**lead indicator**: fly so that the crosshair sits on it and your bolts and the
target will arrive at the same place at the same time. Holding a target in the
box for about a second closes a **torpedo lock**.

The radar below the reticle is a hemisphere: contacts ahead of you plot inside
the inner ring, contacts behind you plot in the outer band. Red is hostile,
blue is your wing, amber is the objective.

## On a phone

- **Left two thirds of the screen — fly.** A stick appears wherever your thumb
  lands; tilt to steer.
- **FIRE**, **BOOST** and **TORP** are the buttons on the right.
- View, pause, mute and fullscreen sit in the top-right corner.

Landscape is the intended orientation. The renderer watches its own frame
times and quietly drops internal resolution — and then the bloom chain — if
the device cannot hold sixty, so a phone gets a smooth game rather than a
pretty slideshow.

To play on an iPhone or iPad the game needs to be served over HTTP — iOS
cannot open a multi-file site from the Files app. Serve it over your Wi-Fi
with `npm start`, put it on any static host, or build the single-file bundle
and open that.

## How it is built

| File | What is in it |
| --- | --- |
| `src/util.js` | Vectors, quaternions, 4×4 matrices, swept-sphere intersection |
| `src/gl.js` | Context, shader linking, render targets, the sprite atlas |
| `src/geometry.js` | The mesh builder, every ship model, and the trench generator |
| `src/render.js` | Five render passes and the bloom post chain |
| `src/audio.js` | Every sound effect, the engine loop, and the score |
| `src/entities.js` | Pooled bolts, particles, debris and explosions |
| `src/ships.js` | Flight model, enemy AI, wingmen, turrets |
| `src/hud.js` | The 2D overlay: reticle, brackets, radar, menus |
| `src/game.js` | The world, the three stages, collisions, the camera |
| `src/main.js` | Input, the frame loop, the quality watchdog |

A few notes on the parts that were more interesting than they look:

**Nothing is modelled.** `G.mesh()` is a builder with a transform stack and a
handful of primitives — box, tapered box, lathe, sphere, extruded polygon, and
a loft through trapezoid cross-sections. The fighter is about forty calls; the
dreadnought's dagger hull is one loft of six sections with a few hundred
scattered greeble boxes on top, seeded so it looks the same every run.

**The trench is built once and drawn in slices.** Fourteen kilometres of
corridor is generated as thirty-four chunk meshes; the renderer draws the ten
around the player, so the whole run costs about what one capital ship does.

**Two canvases.** The scene is WebGL; the HUD is a plain 2D context stacked on
top. Text stays crisp at any pixel ratio, and it costs the 3D pass nothing.

**The bolts converge.** The cannons sit five metres out on the wingtips. Fired
parallel they straddle whatever is under the crosshair and miss it by inches,
so every gun is harmonised on a point ahead of the ship — the same fix gunnery
officers applied to fighter aircraft in the 1930s.

**Sound is all synthesis.** A blaster is a sawtooth swept 2.1kHz down to 190Hz
through a bandpass, with a short feedback delay for the metallic twang and a
noise transient for the arc. An explosion is filtered noise falling over a sub
drop. The enemy fighter scream is a vibrato'd saw chased by a resonant
bandpass. The score is an original theme in D minor: one sixteen-step bass riff
transposed per bar, brass carrying a four-bar melody, sequenced a fifth of a
second ahead of the clock so it never stutters when a frame runs long.

## Licence

MIT — see [LICENSE](../LICENSE). This is an original game written from
scratch; it uses no assets, code, names or music from any other work.
