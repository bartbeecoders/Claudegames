# Château de Cheverny

A real-time 3D model of the Château de Cheverny, in the Loir-et-Cher, built
from photographs. Vanilla JavaScript and WebGL 2 — no meshes, no textures, no
libraries and no build step. Every wall, moulding, slate and leaf is generated
in the browser at load, in about a fifth of a second.

**[▶ Open](https://bartbeecoders.github.io/claudegames/cheverny/)**

## The building

Cheverny was built between 1624 and 1630 for Philippe Hurault, comte de
Cheverny, in the white *tuffeau* limestone quarried at Bourré. The composition
is rigidly symmetrical:

- two square end pavilions capped with bell domes — *dômes à l'impériale* —
  each carrying an open lantern with a ball and spike;
- two lower wings under steep slate roofs pierced by dormers with round
  *oeil-de-boeuf* windows;
- a taller central frontispiece breaking forward, crowned with an oval
  medallion and a small bell turret.

The two long fronts are treated differently and the model follows suit. The
front onto the cour d'honneur is banded ashlar throughout, with busts of Roman
emperors set between the first-floor windows. The garden front and the returns
are rendered panels framed in dressed white stone, with louvred shutters and a
dry moat at their feet, crossed by an arcaded bridge with green ironwork.

Hergé drew Cheverny as Marlinspike Hall in *The Adventures of Tintin*, with the
two end pavilions removed.

## Controls

| | |
| --- | --- |
| drag | orbit |
| scroll / pinch | zoom |
| shift-drag, right-drag | pan |
| **1**–**5** | the five set viewpoints |
| **W** in walk mode | forward (**A**/**S**/**D** to strafe, **Q**/**E** for height, shift to run) |
| **F** | fullscreen |
| **H** | hide the panel |

The time-of-day slider moves the sun along a summer arc: it comes up behind
the garden front, crosses in front of the court around midday, and sets behind
the west pavilion, so each front gets its hour of raking light.

## How it is made

| File | |
| --- | --- |
| `src/util.js` | maths — vectors, 4×4 matrices, a seeded PRNG |
| `src/geom.js` | the mesh builder: a transform stack, lofted surfaces, swept mouldings, hipped roofs, walls with real openings punched through them |
| `src/castle.js` | the château, storey by storey |
| `src/park.js` | ground, moat, bridge, planting |
| `src/gl.js` | WebGL 2 wrapper — programs, meshes, render targets |
| `src/shaders.js` | all the GLSL |
| `src/render.js` | materials, the sun, and the frame's five passes |
| `src/camera.js` | orbit and walk cameras, damped |
| `src/main.js` | boot, panel, loop |

**Geometry.** Nothing is modelled by hand and nothing is loaded. The builder
offers boxes, lofts, surfaces of revolution, bell roofs on a square plan,
mitred mouldings swept round a rectangle, and a wall primitive that takes a
list of openings and emits the masonry between them — so every window has a
real reveal, a real sill and real shadow inside it. The finished model is about
140 000 triangles in twenty draw calls, one per material.

**Surfaces.** There is not a single image file. The ashlar coursing of the
tuffeau, the rows of slates, the seams down the domes, the gravel, the mown
grass, the glazing bars and the leaves are all noise functions evaluated per
fragment, turned into bumps with a derivative trick that needs no UV
parameterisation, and faded out with distance so nothing boils.

**Light.** A shadow map fitted to the estate, a physically-shaped sun with a
sky and ground-bounce ambient, screen-space ambient occlusion subtracted from
that ambient term only, ACES tone mapping, and a procedural sky with two cloud
decks that also lights the scene.

## Running locally

Nothing to install:

```sh
npm start          # http://localhost:8082, prints its LAN address too
npm run build      # -> dist/cheverny.html, one self-contained file
npm run check      # parse every source
```

It also runs straight from `file://`.

## Licence

MIT — see [LICENSE](../LICENSE). The building is a real one; this is an
independent reconstruction from photographs, not a survey drawing, and the
dimensions are eyeballed.
