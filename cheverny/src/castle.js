/* Château de Cheverny, modelled from photographs.

   Built 1624-1630 for Philippe Hurault, comte de Cheverny, in white tuffeau
   from the quarries at Bourré. The composition is strictly symmetrical: two
   square end pavilions capped with bell domes ("dômes à l'impériale") and
   lanterns, two lower wings under steep slate roofs, and a taller central
   frontispiece.

   The two long fronts are treated differently, and the model follows suit:
   the north front onto the cour d'honneur is banded ashlar throughout, with
   busts of Roman emperors between the first-floor windows; the south front
   and the returns are rendered panels framed by dressed white stone, with
   louvred shutters and a dry moat at their feet.

   All dimensions are in metres. X runs along the fronts (west negative),
   Z runs north (negative) to south (positive), Y is up. */
(function (global) {
  'use strict'

  const CH = global.CH
  const PR = CH.PROFILES

  /* --- the levels --------------------------------------------------------- */

  const BASE = -3.8          // bottom of the masonry, below the moat floor
  const FLOOR = 1.45         // main floor / terrace level
  const G_TOP = 6.85         // top of the ground storey
  const F_TOP = 11.85        // top of the first storey — the wings' cornice
  const A_TOP = 16.35        // top of the pavilions' attic storey

  const G_SILL = 2.55, G_WIN = 3.55   // ground-floor window opening
  const F_SILL = 7.85, F_WIN = 3.05   // first-floor window opening
  const A_SILL = 12.65, A_WIN = 2.75  // pavilion attic window opening

  /* --- the blocks --------------------------------------------------------- */

  const PAV_W = 13.0, PAV_D = 15.0    // end pavilions
  const WING_W = 13.6, WING_D = 12.0  // linking wings
  const CTR_W = 9.6, CTR_D = 14.2     // central frontispiece, breaking forward

  const PAV_X = 24.4                  // centre of each pavilion
  const WING_X = 11.4                 // centre of each wing

  CH.LAYOUT = { PAV_X, PAV_W, PAV_D, WING_D, CTR_D, FLOOR, BASE }

  /* --- small parts -------------------------------------------------------- */

  /** Flat slab of dressed stone lying on a wall face, proud of it by `p`.
      (x, y) is the bottom-centre of the slab in wall space. */
  function slabAt (b, x, y, w, h, p) {
    b.push()
    b.translate(x, y, p / 2)
    b.box(w, h, p)
    b.pop()
  }

  /** Dressed surround around an opening: jambs, lintel and a moulded sill. */
  function dressing (b, x, y, w, h, opts = {}) {
    const t = opts.t || 0.34
    const p = opts.p || 0.10
    b.material('stone')
    slabAt(b, x - (w + t) / 2, y, t, h + t, p)
    slabAt(b, x + (w + t) / 2, y, t, h + t, p)
    slabAt(b, x, y + h, w + 2 * t, t, p)
    if (opts.sill !== false) {
      b.push()
      b.translate(x, y - 0.26, 0)
      b.sweepRect(w + 2 * t + 0.2, p * 2, PR.sill)
      b.pop()
    }
    if (opts.keystone) {
      slabAt(b, x, y + h - 0.1, 0.44, t + 0.5, p + 0.06)
    }
    if (opts.pediment) {
      b.push()
      b.translate(x, y + h + t, 0)
      pediment(b, w + 2 * t + 0.5, 0.62, opts.pediment === 'round')
      b.pop()
    }
  }

  /** Triangular (or segmental) pediment standing on the local origin, facing
      +Z. `outline` is the closed front polygon, wound counter-clockwise. */
  function pediment (b, w, h, round) {
    const x = w / 2
    const d = 0.30
    const outline = [[-x, 0, 0], [x, 0, 0]]
    if (round) {
      for (let i = 11; i >= 1; i--) outline.push([-x + (w * i) / 12, Math.sin((i / 12) * Math.PI) * h, 0])
    } else {
      outline.push([0, h, 0])
    }

    b.poly(outline)
    b.poly(outline.map(p => [p[0], p[1], -d]).reverse())
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], c = outline[(i + 1) % outline.length]
      b.poly([a, [a[0], a[1], -d], [c[0], c[1], -d], c])
    }

    b.push()
    b.translate(0, -0.16, -d / 2)
    b.box(w + 0.3, 0.18, d + 0.14)
    b.pop()
  }

  /** Oeil-de-boeuf: a round window in a moulded stone frame, in low relief on
      the wall face. */
  function oeil (b, x, y, r) {
    b.push()
    b.translate(x, y, 0)
    b.rotateX(Math.PI / 2)
    b.material('stone')
    b.revolve([[r, 0], [r * 1.34, 0.08], [r * 1.42, 0.18], [r * 1.16, 0.26], [r * 1.02, 0.24]], 20)
    b.material('glass')
    b.cyl(r, 0.02, 20, { capBottom: false })
    b.pop()
  }

  /** Bust of a Roman emperor in an oval medallion — the motif that runs along
      the first floor of the north front. */
  function bust (b, x, y) {
    b.push()
    b.translate(x, y, 0)
    b.material('stone')
    // Oval frame.
    b.push()
    b.scale(1.0, 1.30, 1.0)
    b.rotateX(Math.PI / 2)
    b.revolve([[0.50, 0], [0.62, 0.13], [0.68, 0.26], [0.54, 0.36], [0.48, 0.33]], 18)
    b.pop()
    // Head and shoulders in relief.
    b.push()
    b.translate(0, 0.10, 0.22)
    b.scale(1.0, 1.0, 0.55)
    b.sphere(0.19, 12, 8)
    b.pop()
    b.push()
    b.translate(0, -0.32, 0.19)
    b.scale(1.0, 1.0, 0.5)
    b.revolve([[0.36, 0], [0.31, 0.22], [0.17, 0.36]], 14)
    b.pop()
    // Scrolled console beneath.
    b.push()
    b.translate(0, -0.88, 0.08)
    b.box(0.36, 0.32, 0.26)
    b.pop()
    b.pop()
  }

  /** Interlocking quoins up a corner. The corner is at the local origin with
      one face looking +X and the other +Z. */
  function quoins (b, y0, y1, opts = {}) {
    const p = opts.p || 0.10
    const c = 0.44
    b.material('stone')
    for (let i = 0, y = y0; y < y1 - 0.05; i++, y += c) {
      const h = Math.min(c, y1 - y) - 0.02
      const a = i % 2 === 0 ? 1.05 : 0.60
      const l = i % 2 === 0 ? 0.60 : 1.05
      b.push()
      b.translate(p / 2, y, -a / 2)
      b.box(p, h, a)
      b.pop()
      b.push()
      b.translate(-l / 2, y, p / 2)
      b.box(l, h, p)
      b.pop()
    }
  }

  /** A single window: reveal, glazing bars, and either glass or shutters. */
  function windowUnit (b, w, h, opts = {}) {
    const depth = 0.36
    b.material('stone')
    b.reveal(w, h, depth)

    // Unlit interior behind everything, so no opening is ever see-through.
    b.material('interior')
    b.push()
    b.translate(0, 0, -depth)
    b.poly([[-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, h, 0], [-w / 2, h, 0]])
    b.pop()

    if (opts.kind === 'door') {
      b.material('wood')
      b.push()
      b.translate(0, 0, -0.20)
      for (const s of [-1, 1]) {
        b.push()
        b.translate((s * (w - 0.1)) / 4, 0.02, 0)
        b.box((w - 0.16) / 2, h - 0.06, 0.09)
        b.pop()
      }
      b.pop()
      return
    }

    if (opts.shut) {
      b.material('shutter')
      const leaf = (w - 0.12) / 2
      for (const s of [-1, 1]) {
        b.push()
        b.translate(s * (leaf + 0.06) / 2, 0.05, -0.14)
        b.box(leaf, h - 0.1, 0.07)
        b.pop()
      }
      return
    }

    b.material('glass')
    b.push()
    b.translate(0, 0, -depth + 0.04)
    b.poly([[-w / 2, 0.02, 0], [w / 2, 0.02, 0], [w / 2, h - 0.02, 0], [-w / 2, h - 0.02, 0]])
    b.pop()

    if (opts.cross !== false && h > 2.2) {
      b.material('stone')
      b.push()
      b.translate(0, 0, -depth + 0.10)
      b.box(0.13, h, 0.16)
      b.translate(0, h * 0.56, 0)
      b.box(w, 0.15, 0.16)
      b.pop()
    }
  }

  /** A run of wall, built in its own frame: the face lies in the XY plane at
      z = 0 looking towards +Z, x measured from the middle of the run, y from
      the bottom of the masonry. */
  function facade (b, o) {
    const panel = o.style === 'panel'
    const wins = o.wins || []

    b.material(panel ? 'plaster' : 'stone')
    b.wallPanel(o.w, o.h, wins)

    for (const win of wins) {
      b.push()
      b.translate(win.x, win.y, 0)
      windowUnit(b, win.w, win.h, win)
      b.pop()
      if (win.kind !== 'door') {
        dressing(b, win.x, win.y, win.w, win.h, {
          t: win.dress === 'slim' ? 0.26 : 0.34,
          p: panel ? 0.11 : 0.07,
          keystone: win.keystone,
          pediment: win.pediment
        })
      } else {
        dressing(b, win.x, win.y, win.w, win.h, { t: 0.42, p: 0.14, sill: false, keystone: true })
      }
    }

    // Horizontal dressings: a band at every floor level.
    b.material('stone')
    for (const y of o.bands || []) {
      b.push()
      b.translate(0, y, 0.065)
      b.box(o.w, 0.34, 0.13)
      b.pop()
    }

    for (const m of o.medallions || []) bust(b, m, o.medY)
    for (const e of o.oeils || []) oeil(b, e, o.oeilY, 0.42)
  }

  /* --- storeys ------------------------------------------------------------ */

  /** Places a facade on one side of a block. `side` is 'N', 'S', 'E' or 'W';
      w is the length of that side. */
  function side (b, cx, cz, hw, hd, sideName, o) {
    b.push()
    if (sideName === 'N') { b.translate(cx, 0, cz - hd); b.rotateY(Math.PI) }
    if (sideName === 'S') b.translate(cx, 0, cz + hd)
    if (sideName === 'E') { b.translate(cx + hw, 0, cz); b.rotateY(Math.PI / 2) }
    if (sideName === 'W') { b.translate(cx - hw, 0, cz); b.rotateY(-Math.PI / 2) }
    facade(b, o)
    b.pop()
  }

  function bays (n, spacing) {
    const out = []
    for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * spacing)
    return out
  }

  /** Windows for one storey of a facade. */
  function storey (xs, y, h, w, opts = {}) {
    return xs.map((x, i) => ({
      x, y, h, w,
      kind: opts.kind || 'window',
      shut: opts.shut ? (i + (opts.seed || 0)) % 3 !== 1 : false,
      keystone: opts.keystone,
      pediment: opts.pediment,
      dress: opts.dress
    }))
  }

  /* --- roofs -------------------------------------------------------------- */

  /** The bell dome over a pavilion, its lantern and its finial. */
  function dome (b, w, d, y) {
    const H = 7.0
    // A shallow shoulder, then a long steep sweep to a small flat where the
    // lantern stands: the silhouette of a dôme à l'impériale, not an onion.
    const profile = [
      [1.00, 0], [0.985, 0.11], [0.945, 0.24], [0.880, 0.38], [0.790, 0.52],
      [0.665, 0.65], [0.505, 0.78], [0.330, 0.89], [0.205, 0.96], [0.185, 1.0]
    ].map(([s, t]) => [s, y + t * H])

    b.material('lead')
    b.bell(w / 2, d / 2, 1.4, profile, 5)

    // Dormers around the foot of the dome.
    for (const [dx, dz, rot] of [
      [-3.2, -d / 2 + 0.4, Math.PI], [3.2, -d / 2 + 0.4, Math.PI],
      [-3.2, d / 2 - 0.4, 0], [3.2, d / 2 - 0.4, 0],
      [-w / 2 + 0.4, 0, -Math.PI / 2], [w / 2 - 0.4, 0, Math.PI / 2]
    ]) {
      b.push()
      b.translate(dx, y - 0.2, dz)
      b.rotateY(rot)
      lucarne(b, 1.5, 2.5, { round: false })
      b.pop()
    }

    lantern(b, y + H - 0.15)
  }

  /** Open lantern (campanile) with its little dome, ball and spike. */
  function lantern (b, y) {
    b.push()
    b.translate(0, y, 0)
    b.material('stone')
    b.box(2.9, 0.42, 2.9)
    b.push()
    b.translate(0, 0.42, 0)
    b.sweepRect(2.9, 2.9, PR.corniceSmall)
    b.pop()

    // Corner posts, with a light balustrade between them.
    const p = 1.12
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.push()
        b.translate(sx * p, 0.8, sz * p)
        b.box(0.30, 2.5, 0.30)
        b.pop()
      }
    }
    b.material('iron')
    for (const s of [-1, 1]) {
      b.push()
      b.translate(0, 1.0, s * p)
      b.box(2.0, 0.09, 0.07)
      b.translate(0, 0.62, 0)
      b.box(2.0, 0.09, 0.07)
      b.pop()
      b.push()
      b.translate(s * p, 1.0, 0)
      b.box(0.07, 0.09, 2.0)
      b.translate(0, 0.62, 0)
      b.box(0.07, 0.09, 2.0)
      b.pop()
    }

    b.material('stone')
    b.push()
    b.translate(0, 3.3, 0)
    b.box(2.7, 0.3, 2.7)
    b.translate(0, 0.3, 0)
    b.sweepRect(2.7, 2.7, PR.corniceSmall)
    b.pop()

    b.material('lead')
    b.push()
    b.translate(0, 4.0, 0)
    b.bell(1.35, 1.35, 0.5, [
      [1.0, 0], [0.98, 0.35], [0.88, 0.75], [0.70, 1.10], [0.44, 1.45], [0.18, 1.70], [0.06, 1.80]
    ], 6)
    b.translate(0, 1.8, 0)
    b.sphere(0.22, 12, 7)
    b.material('iron')
    b.translate(0, 0.2, 0)
    b.cyl(0.045, 2.2, 6)
    b.translate(0, 2.2, 0)
    b.cyl(0.10, 0.10, 6)
    b.pop()
    b.pop()
  }

  /** Dormer window standing on a roof or at the foot of a dome. */
  function lucarne (b, w, h, opts = {}) {
    const d = 2.2
    b.material('stone')
    b.push()
    b.translate(0, 0, -d / 2)
    b.box(w + 0.5, h, d, { skip: 'S' })
    b.pop()

    if (opts.round) {
      b.material('stone')
      b.wallPanel(w + 0.5, h, [])
      oeil(b, 0, h * 0.55, w * 0.36)
    } else {
      b.material('stone')
      b.wallPanel(w + 0.5, h, [{ x: 0, y: 0.5, w, h: h - 1.0 }])
      b.push()
      b.translate(0, 0.5, 0)
      windowUnit(b, w, h - 1.0, { cross: false })
      b.pop()
      dressing(b, 0, 0.5, w, h - 1.0, { t: 0.24, p: 0.08, sill: false })
    }

    b.push()
    b.translate(0, h, -d / 2 + 0.1)
    b.sweepRect(w + 0.8, d, PR.corniceSmall)
    b.pop()
    b.push()
    b.translate(0, h + 0.38, 0)
    pediment(b, w + 1.0, 0.7, !!opts.round)
    b.pop()
  }

  /** Tall tuffeau chimney stack with a moulded cap. */
  function chimney (b, x, z, y, h) {
    b.push()
    b.translate(x, y, z)
    b.material('stone')
    b.box(1.5, h, 1.15)
    b.translate(0, h, 0)
    b.sweepRect(1.5, 1.15, PR.corniceSmall)
    b.push()
    b.translate(0, 0.38, 0)
    b.box(1.2, 0.55, 0.9)
    b.pop()
    b.pop()
  }

  /* --- the blocks --------------------------------------------------------- */

  function pavilion (b, cx) {
    const hw = PAV_W / 2, hd = PAV_D / 2

    // Masonry base, hidden in the ground on the north side and exposed in the
    // moat on the south.
    b.material('stoneOld')
    b.push()
    b.translate(cx, 0, 0)
    b.box(PAV_W + 0.5, FLOOR - BASE, PAV_D + 0.5, { y0: BASE, skip: 'T' })
    b.pop()

    const xs = bays(3, 4.35)
    const zs = bays(3, 5.0)

    // North front: banded ashlar, busts between the first-floor windows.
    side(b, cx, 0, hw, hd, 'N', {
      w: PAV_W, h: A_TOP, style: 'ashlar',
      wins: [
        ...storey(xs, G_SILL, G_WIN, 1.62, { keystone: true }),
        ...storey(xs, F_SILL, F_WIN, 1.62, { keystone: true }),
        ...storey(xs, A_SILL, A_WIN, 1.5, { dress: 'slim' })
      ],
      bands: [G_TOP, F_TOP],
      medallions: [-2.2, 2.2], medY: F_SILL + 1.6
    })

    // The other three sides: rendered panels in a stone frame.
    for (const [name, list, seed] of [['S', zs, 0], ['E', zs, 1], ['W', zs, 2]]) {
      const wide = name === 'S' ? PAV_W : PAV_D
      const cols = name === 'S' ? xs : list
      side(b, cx, 0, hw, hd, name, {
        w: wide, h: A_TOP, style: 'panel',
        wins: [
          ...storey(cols, G_SILL, G_WIN, 1.62, { shut: true, seed }),
          ...storey(cols, F_SILL, F_WIN, 1.62, { shut: true, seed: seed + 1 }),
          ...storey(cols, A_SILL, A_WIN, 1.5, { shut: true, seed, dress: 'slim' })
        ],
        bands: [G_TOP, F_TOP],
        oeils: cols.length === 3 ? [(cols[0] + cols[1]) / 2, (cols[1] + cols[2]) / 2] : [],
        oeilY: F_SILL - 1.15
      })
    }

    // Quoins at the four corners.
    for (const [sx, sz, rot] of [[1, 1, 0], [1, -1, Math.PI / 2], [-1, -1, Math.PI], [-1, 1, -Math.PI / 2]]) {
      b.push()
      b.translate(cx + sx * hw, 0, sz * hd)
      b.rotateY(rot)
      quoins(b, FLOOR - 1.2, A_TOP)
      b.pop()
    }

    // Plinth, attic cornice, dome.
    b.material('stone')
    b.push()
    b.translate(cx, FLOOR - 1.05, 0)
    b.sweepRect(PAV_W, PAV_D, PR.plinth)
    b.pop()
    b.push()
    b.translate(cx, A_TOP, 0)
    b.sweepRect(PAV_W, PAV_D, PR.cornice)
    b.pop()

    b.push()
    b.translate(cx, 0, 0)
    dome(b, PAV_W + 0.5, PAV_D + 0.5, A_TOP + 0.86)
    b.pop()

    for (const sz of [-1, 1]) {
      chimney(b, cx + (cx > 0 ? 4.6 : -4.6), sz * (hd - 1.6), A_TOP + 0.7, 4.6)
    }
  }

  function wing (b, cx) {
    const hw = WING_W / 2, hd = WING_D / 2
    const xs = bays(3, 4.4)

    b.material('stoneOld')
    b.push()
    b.translate(cx, 0, 0)
    b.box(WING_W, FLOOR - BASE, WING_D + 0.5, { y0: BASE, skip: 'T' })
    b.pop()

    side(b, cx, 0, hw, hd, 'N', {
      w: WING_W, h: F_TOP, style: 'ashlar',
      wins: [
        ...storey(xs, G_SILL, G_WIN, 1.62, { keystone: true }),
        ...storey(xs, F_SILL, F_WIN, 1.62, { keystone: true })
      ],
      bands: [G_TOP],
      medallions: [-2.2, 2.2], medY: F_SILL + 1.6
    })

    side(b, cx, 0, hw, hd, 'S', {
      w: WING_W, h: F_TOP, style: 'panel',
      wins: [
        ...storey(xs, G_SILL, G_WIN, 1.62, { shut: true, seed: 2 }),
        ...storey(xs, F_SILL, F_WIN, 1.62, { shut: true })
      ],
      bands: [G_TOP],
      oeils: [(xs[0] + xs[1]) / 2, (xs[1] + xs[2]) / 2], oeilY: F_SILL - 1.15
    })

    b.material('stone')
    b.push()
    b.translate(cx, FLOOR - 1.05, 0)
    b.sweepRect(WING_W, WING_D, PR.plinth)
    b.pop()
    b.push()
    b.translate(cx, F_TOP, 0)
    b.sweepRect(WING_W, WING_D, PR.cornice)
    b.pop()

    // Steep slate roof, with dormers looking both ways.
    const ry = F_TOP + 0.86
    b.material('slate')
    b.push()
    b.translate(cx, ry, 0)
    b.hipRoof(WING_W + 0.4, WING_D + 0.7, 8.4, { inset: 4.0 })
    b.pop()

    for (const dx of [-4.2, 4.2]) {
      b.push()
      b.translate(cx + dx, ry - 1.4, -hd - 0.15)
      b.rotateY(Math.PI)
      lucarne(b, 1.5, 3.4, { round: true })
      b.pop()
      b.push()
      b.translate(cx + dx, ry - 1.4, hd + 0.3)
      lucarne(b, 1.5, 3.4, { round: true })
      b.pop()
    }

    chimney(b, cx + (cx > 0 ? -5.6 : 5.6), 0, ry + 2.0, 5.4)
  }

  function centre (b) {
    const hw = CTR_W / 2, hd = CTR_D / 2
    const top = 13.6

    b.material('stoneOld')
    b.push()
    b.box(CTR_W, FLOOR - BASE, CTR_D, { y0: BASE, skip: 'T' })
    b.pop()

    // North front: the door under a broad window and the crowning frontispiece.
    side(b, 0, 0, hw, hd, 'N', {
      w: CTR_W, h: top, style: 'ashlar',
      wins: [
        { x: 0, y: FLOOR, w: 2.5, h: 4.2, kind: 'door' },
        { x: 0, y: F_SILL - 0.5, w: 2.3, h: F_WIN + 0.5, kind: 'window', keystone: true },
        { x: -3.1, y: G_SILL, w: 1.3, h: G_WIN, kind: 'window', dress: 'slim' },
        { x: 3.1, y: G_SILL, w: 1.3, h: G_WIN, kind: 'window', dress: 'slim' },
        { x: -3.1, y: F_SILL, w: 1.3, h: F_WIN, kind: 'window', dress: 'slim' },
        { x: 3.1, y: F_SILL, w: 1.3, h: F_WIN, kind: 'window', dress: 'slim' }
      ],
      bands: [G_TOP, F_TOP]
    })

    side(b, 0, 0, hw, hd, 'S', {
      w: CTR_W, h: top, style: 'panel',
      wins: [
        { x: 0, y: FLOOR, w: 2.5, h: 4.2, kind: 'door' },
        { x: 0, y: F_SILL - 0.5, w: 2.3, h: F_WIN + 0.5, kind: 'window', keystone: true },
        { x: -3.1, y: G_SILL, w: 1.3, h: G_WIN, kind: 'window', dress: 'slim' },
        { x: 3.1, y: G_SILL, w: 1.3, h: G_WIN, kind: 'window', dress: 'slim' },
        { x: -3.1, y: F_SILL, w: 1.3, h: F_WIN, kind: 'window', dress: 'slim' },
        { x: 3.1, y: F_SILL, w: 1.3, h: F_WIN, kind: 'window', dress: 'slim' }
      ],
      bands: [G_TOP, F_TOP]
    })

    b.material('stone')
    b.push()
    b.translate(0, FLOOR - 1.05, 0)
    b.sweepRect(CTR_W, CTR_D, PR.plinth)
    b.pop()
    b.push()
    b.translate(0, top, 0)
    b.sweepRect(CTR_W, CTR_D, PR.cornice)
    b.pop()

    // The frontispiece above the cornice: a panel carrying an oval medallion
    // between scrolled shoulders, crowned by a small pediment.
    for (const s of [-1, 1]) {
      b.push()
      b.translate(0, top + 0.86, s * (hd - 0.45))
      if (s < 0) b.rotateY(Math.PI)
      b.material('stone')
      b.box(6.8, 3.4, 0.9, { skip: 'B' })
      for (const sx of [-1, 1]) {
        b.push()
        b.translate(sx * 2.2, 0.5, 0.48)
        b.box(0.34, 2.6, 0.2)
        b.pop()
      }
      b.push()
      b.translate(0, 1.9, 0.48)
      b.scale(1.45, 1.45, 1)
      bust(b, 0, 0)
      b.pop()
      // Scrolled shoulders either side, stepping down to the wings.
      for (const sx of [-1, 1]) {
        b.push()
        b.translate(sx * 4.1, 0, 0.2)
        b.box(1.5, 1.9, 0.6)
        b.translate(0, 1.9, 0)
        b.rotateY(sx > 0 ? 0 : Math.PI)
        b.poly([[-0.75, 0, 0.3], [0.75, 0, 0.3], [0.75, 0, -0.3], [-0.75, 0, -0.3]])
        b.pop()
      }
      b.push()
      b.translate(0, 3.4, 0.2)
      b.sweepRect(7.0, 1.3, PR.corniceSmall)
      b.translate(0, 0.38, 0)
      pediment(b, 5.6, 1.25)
      b.pop()
      b.pop()
    }

    // Steep roof and the bell turret on its ridge.
    b.material('slate')
    b.push()
    b.translate(0, top + 0.86, 0)
    b.hipRoof(CTR_W + 0.4, CTR_D + 0.4, 7.6, { inset: 5.0 })
    b.pop()

    b.push()
    b.translate(0, top + 8.0, 0)
    b.material('stone')
    b.box(2.2, 0.5, 2.2)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.push()
        b.translate(sx * 0.82, 0.5, sz * 0.82)
        b.box(0.24, 1.8, 0.24)
        b.pop()
      }
    }
    b.translate(0, 2.3, 0)
    b.box(2.0, 0.28, 2.0)
    b.material('lead')
    b.translate(0, 0.28, 0)
    b.bell(1.0, 1.0, 0.35, [
      [1.0, 0], [0.95, 0.30], [0.82, 0.60], [0.60, 0.90], [0.32, 1.15], [0.10, 1.30]
    ], 6)
    b.material('iron')
    b.translate(0, 1.35, 0)
    b.cyl(0.05, 1.5, 6)
    b.translate(0, 1.5, 0)
    b.box(0.06, 0.9, 0.06)
    b.box(0.5, 0.06, 0.06, { y0: 0.5 })
    b.pop()

    for (const sx of [-1, 1]) chimney(b, sx * 3.6, 0, top + 0.86, 4.4)
  }

  /* --- terraces and steps -------------------------------------------------- */

  function balustrade (b, len, opts = {}) {
    const h = opts.h || 0.95
    const n = Math.max(2, Math.round(len / 0.42))
    b.material('stone')
    b.push()
    b.translate(0, h - 0.2, 0)
    b.box(len, 0.2, 0.42)
    b.pop()
    b.box(len, 0.16, 0.5)
    for (let i = 0; i <= n; i++) {
      const x = -len / 2 + (len * i) / n
      b.push()
      b.translate(x, 0.16, 0)
      b.revolve(CH.BALUSTER.map(([r, y]) => [r, y * (h - 0.36)]), 10)
      b.pop()
    }
  }

  /** The perron in front of the north door: a low terrace with a flight of
      steps down to the gravel of the cour d'honneur. */
  function northSteps (b) {
    const face = -CTR_D / 2
    const front = face - 4.4
    b.material('stoneOld')
    b.push()
    b.translate(0, 0, (face + front) / 2)
    b.box(11.0, FLOOR, face - front)
    b.pop()
    b.material('stone')
    b.push()
    b.translate(0, 0, front)
    b.rotateY(Math.PI)
    b.stairs(7.2, 5, FLOOR / 5, 0.44, { back: 0.4 })
    b.pop()
    for (const sx of [-1, 1]) {
      b.push()
      b.translate(sx * 4.6, FLOOR, (face + front) / 2 + 0.6)
      b.rotateY(Math.PI / 2)
      balustrade(b, 3.4, { h: 0.9 })
      b.pop()
    }
  }

  CH.buildChateau = function (b) {
    pavilion(b, -PAV_X)
    pavilion(b, PAV_X)
    wing(b, -WING_X)
    wing(b, WING_X)
    centre(b)
    northSteps(b)
  }

  CH.balustrade = balustrade
})(window)
