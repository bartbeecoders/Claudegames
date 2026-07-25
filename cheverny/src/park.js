/* The setting: the gravel cour d'honneur with its orange trees, the lawns and
   cedars of the park, and — on the south front — the dry moat with its
   arcaded bridge and green ironwork. */
(function (global) {
  'use strict'

  const CH = global.CH

  const FLOOR = 1.45
  const MOAT_N = 8.0          // inner edge of the dry moat
  const MOAT_S = 16.4         // outer edge
  const MOAT_X = 34.0         // how far it runs either side of centre
  const MOAT_Y = -3.9         // its floor

  const FAR = 290             // the ground goes out this far

  /* --- ground ------------------------------------------------------------- */

  /** One patch of ground, subdivided so that interpolation across very large
      triangles stays accurate. Patches never overlap: everything lies at
      y = 0, so two surfaces sharing a plane would z-fight. */
  function field (b, mat, x0, x1, z0, z1) {
    b.material(mat)
    const nx = Math.max(1, Math.round((x1 - x0) / 36))
    const nz = Math.max(1, Math.round((z1 - z0) / 36))
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = x0 + ((x1 - x0) * i) / nx
        const c = x0 + ((x1 - x0) * (i + 1)) / nx
        const d = z0 + ((z1 - z0) * j) / nz
        const e = z0 + ((z1 - z0) * (j + 1)) / nz
        b.poly([[a, 0, e], [c, 0, e], [c, 0, d], [a, 0, d]])
      }
    }
  }

  /** A lawn panel inside the gravel, edged with a band of white chippings. */
  function lawnPanel (b, x0, x1, z0, z1) {
    const e = 1.5
    field(b, 'whiteGravel', x0, x1, z0, z0 + e)
    field(b, 'whiteGravel', x0, x1, z1 - e, z1)
    field(b, 'whiteGravel', x0, x0 + e, z0 + e, z1 - e)
    field(b, 'whiteGravel', x1 - e, x1, z0 + e, z1 - e)
    field(b, 'grass', x0 + e, x1 - e, z0 + e, z1 - e)
  }

  /* The estate reads as a strip of rectangles, laid edge to edge:

       z = -FAR ..-74   park
           -74 ..  -7   cour d'honneur — gravel, two lawn panels, a walk
            -7 ..   8   the château and its terraces
             8 .. 16.4  the dry moat (left open) with gravel either side
          16.4 ..  32   gravel apron on the garden front
            32 .. FAR   park                                            */
  function ground (b) {
    const COURT_X = 52, COURT_N = -74, COURT_S = -7

    field(b, 'grass', -FAR, -COURT_X, -FAR, FAR)
    field(b, 'grass', COURT_X, FAR, -FAR, FAR)
    field(b, 'grass', -COURT_X, COURT_X, -FAR, COURT_N)
    field(b, 'grass', -COURT_X, COURT_X, 32, FAR)
    field(b, 'gravel', -COURT_X, COURT_X, COURT_S, MOAT_N)

    // The court: gravel, with a lawn panel either side of the central walk.
    const panels = [[-36, -6.5], [6.5, 36]]
    field(b, 'gravel', -COURT_X, -36, COURT_N, COURT_S)
    field(b, 'gravel', 36, COURT_X, COURT_N, COURT_S)
    field(b, 'gravel', -6.5, 6.5, COURT_N, COURT_S)
    for (const [x0, x1] of panels) {
      field(b, 'gravel', x0, x1, COURT_N, -64)
      field(b, 'gravel', x0, x1, -20, COURT_S)
      lawnPanel(b, x0, x1, -64, -20)
    }

    // Either side of the moat, and the apron in front of it.
    field(b, 'gravel', -COURT_X, -MOAT_X, MOAT_N, MOAT_S)
    field(b, 'gravel', MOAT_X, COURT_X, MOAT_N, MOAT_S)
    field(b, 'gravel', -COURT_X, -46, MOAT_S, 32)
    field(b, 'gravel', 46, COURT_X, MOAT_S, 32)
    field(b, 'gravel', -46, 46, MOAT_S, 26)
    field(b, 'grass', -46, 46, 26, 32)
  }

  /* --- the dry moat ------------------------------------------------------- */

  function moat (b) {
    b.material('stoneOld')
    b.poly([
      [-MOAT_X, MOAT_Y, MOAT_S], [MOAT_X, MOAT_Y, MOAT_S],
      [MOAT_X, MOAT_Y, MOAT_N], [-MOAT_X, MOAT_Y, MOAT_N]
    ])

    // Revetment walls: north (against the château), south, and the two ends.
    b.push()
    b.translate(0, MOAT_Y, MOAT_N)
    b.box(MOAT_X * 2, -MOAT_Y, 0.9, { skip: 'B' })
    b.pop()
    b.push()
    b.translate(0, MOAT_Y, MOAT_S)
    b.box(MOAT_X * 2 + 1.8, -MOAT_Y, 0.9, { skip: 'B' })
    b.pop()
    for (const s of [-1, 1]) {
      b.push()
      b.translate(s * MOAT_X, MOAT_Y, (MOAT_N + MOAT_S) / 2)
      b.box(0.9, -MOAT_Y, MOAT_S - MOAT_N, { skip: 'B' })
      b.pop()
    }
    // Coping along the outer edge.
    b.material('stone')
    b.push()
    b.translate(0, -0.14, MOAT_S)
    b.box(MOAT_X * 2 + 2.0, 0.22, 1.3)
    b.pop()
  }

  /** A wall pierced by semicircular arches. Runs along X, faces ±Z. */
  function archWall (b, opts) {
    const { len, y0, y1, spring, t } = opts
    const arches = opts.arches
    const half = len / 2

    const top = x => {
      for (const a of arches) {
        const dx = x - a.x
        if (Math.abs(dx) < a.r) return spring + Math.sqrt(Math.max(0, a.r * a.r - dx * dx))
      }
      return y0
    }

    const N = 260
    for (let i = 0; i < N; i++) {
      const xa = -half + (len * i) / N
      const xb = -half + (len * (i + 1)) / N
      const ya = top(xa), yb = top(xb)
      if (ya >= y1 - 0.01 && yb >= y1 - 0.01) continue
      // Both faces.
      b.poly([[xa, ya, t / 2], [xb, yb, t / 2], [xb, y1, t / 2], [xa, y1, t / 2]])
      b.poly([[xa, y1, -t / 2], [xb, y1, -t / 2], [xb, yb, -t / 2], [xa, ya, -t / 2]])
      // Soffit of the arch.
      if (ya > y0 + 0.001 && yb > y0 + 0.001) {
        b.poly([[xa, ya, -t / 2], [xb, yb, -t / 2], [xb, yb, t / 2], [xa, ya, t / 2]])
      }
    }

    // Pier faces inside each opening, below the springing.
    for (const a of arches) {
      for (const s of [-1, 1]) {
        b.push()
        b.translate(a.x + s * a.r, y0, 0)
        b.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2)
        b.poly([[-t / 2, 0, 0], [t / 2, 0, 0], [t / 2, spring - y0, 0], [-t / 2, spring - y0, 0]])
        b.pop()
      }
    }

    // Cap and deck.
    b.push()
    b.translate(0, y1, 0)
    b.box(len, 0.28, t + 0.5)
    b.pop()
  }

  /** Green wrought-iron railing: a top rail, a bottom rail and uprights. */
  function railing (b, len, opts = {}) {
    const h = opts.h || 1.0
    b.material('iron')
    b.push()
    b.translate(0, h - 0.09, 0)
    b.box(len, 0.09, 0.09)
    b.pop()
    b.push()
    b.translate(0, 0.12, 0)
    b.box(len, 0.07, 0.07)
    b.pop()
    const n = Math.max(2, Math.round(len / 0.42))
    for (let i = 0; i <= n; i++) {
      b.push()
      b.translate(-len / 2 + (len * i) / n, 0, 0)
      b.box(0.05, h - 0.06, 0.05)
      b.pop()
    }
    // Panels of scrollwork, suggested by a lozenge in each bay.
    for (let i = 0; i < n; i++) {
      b.push()
      b.translate(-len / 2 + (len * (i + 0.5)) / n, h * 0.5, 0)
      b.rotateZ(Math.PI / 4)
      b.box(0.30, 0.30, 0.035)
      b.pop()
    }
  }

  /** The terrace along the garden front and the bridge that leaves it. */
  function bridge (b) {
    const deck = FLOOR
    b.material('stoneOld')

    // Terrace, carried on an arcade standing in the moat.
    const tw = 38.7
    const arches = []
    for (let i = -4; i <= 4; i++) arches.push({ x: i * 4.3, r: 1.85 })
    b.push()
    b.translate(0, 0, MOAT_N + 2.6)
    archWall(b, { len: tw, y0: MOAT_Y, y1: deck, spring: MOAT_Y + 1.7, t: 1.0, arches })
    b.pop()
    b.push()
    b.translate(0, MOAT_Y, (MOAT_N + MOAT_N + 2.6) / 2)
    b.box(tw, deck - MOAT_Y, 2.6, { skip: 'T' })
    b.pop()
    b.material('stone')
    b.push()
    b.translate(0, deck - 0.28, MOAT_N + 1.3)
    b.box(tw, 0.28, 2.6)
    b.pop()

    // The bridge proper, crossing the rest of the moat on three arches.
    const bw = 6.4
    for (const s of [-1, 1]) {
      b.material('stoneOld')
      b.push()
      b.translate(s * bw / 2, 0, MOAT_N + 4.2)
      b.rotateY(Math.PI / 2)
      archWall(b, {
        len: MOAT_S - MOAT_N - 3.0,
        y0: MOAT_Y,
        y1: deck,
        spring: MOAT_Y + 1.7,
        t: 0.8,
        arches: [{ x: -2.0, r: 1.35 }, { x: 2.0, r: 1.35 }]
      })
      b.pop()
    }
    b.material('stone')
    b.push()
    b.translate(0, deck - 0.28, MOAT_N + 4.2)
    b.box(bw, 0.28, MOAT_S - MOAT_N - 3.0)
    b.pop()

    // Steps down to the gravel at the far end of the bridge.
    b.push()
    b.translate(0, 0, MOAT_S + 0.1)
    b.stairs(bw, 4, deck / 4, 0.44, { back: 1.2 })
    b.pop()

    // Ironwork along both open edges of the terrace and the bridge.
    railing(b, tw, { h: 1.05 })
    b.push()
    b.translate(0, deck, MOAT_N + 2.6)
    railing(b, tw, { h: 1.05 })
    b.pop()
    for (const s of [-1, 1]) {
      b.push()
      b.translate(s * bw / 2, deck, MOAT_N + 4.2)
      b.rotateY(Math.PI / 2)
      railing(b, MOAT_S - MOAT_N - 3.0, { h: 1.05 })
      b.pop()
    }
  }

  /* --- planting ----------------------------------------------------------- */

  /** Cedar of Lebanon: a heavy trunk under wide, flat tiers of dark needles. */
  function cedar (b, h, rnd) {
    b.material('trunk')
    b.push()
    b.cyl(h * 0.045, h * 0.45, 8, { rTop: h * 0.028 })
    b.pop()
    b.material('cedar')
    const tiers = 5 + Math.floor(rnd() * 3)
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1)
      const y = h * (0.34 + t * 0.62)
      const r = h * (0.40 - t * 0.26) * (0.85 + rnd() * 0.3)
      b.push()
      b.translate((rnd() - 0.5) * h * 0.06, y, (rnd() - 0.5) * h * 0.06)
      b.scale(1, 0.34 + rnd() * 0.1, 1)
      b.sphere(r, 12, 7)
      b.pop()
    }
  }

  /** Round-headed park tree — lime, oak or plane. */
  function broadleaf (b, h, rnd) {
    b.material('trunk')
    b.push()
    b.cyl(h * 0.035, h * 0.42, 7, { rTop: h * 0.022 })
    b.pop()
    b.material('foliage')
    const blobs = 4 + Math.floor(rnd() * 3)
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * CH.TAU + rnd()
      const d = h * 0.16 * rnd()
      b.push()
      b.translate(Math.cos(a) * d, h * (0.52 + rnd() * 0.3), Math.sin(a) * d)
      b.scale(1, 0.85, 1)
      b.sphere(h * (0.20 + rnd() * 0.10), 12, 8)
      b.pop()
    }
  }

  /** Clipped orange tree in a Versailles planter, with geraniums at its foot. */
  function orangeTree (b) {
    const s = 1.05
    b.material('wood')
    b.push()
    b.box(s * 1.15, s * 1.05, s * 1.15)
    b.pop()
    b.material('planter')
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.push()
        b.translate(sx * s * 0.58, 0, sz * s * 0.58)
        b.box(s * 0.20, s * 1.28, s * 0.20)
        b.translate(0, s * 1.28, 0)
        b.sphere(s * 0.13, 8, 6)
        b.pop()
      }
    }
    b.material('flower')
    b.push()
    b.translate(0, s * 1.02, 0)
    b.scale(1, 0.45, 1)
    b.sphere(s * 0.62, 10, 6)
    b.pop()
    b.material('trunk')
    b.push()
    b.translate(0, s * 1.1, 0)
    b.cyl(0.09, 1.15, 7)
    b.pop()
    b.material('foliage')
    b.push()
    b.translate(0, s * 1.1 + 1.85, 0)
    b.sphere(0.88, 14, 9)
    b.pop()
  }

  function hedge (b, len, h, d) {
    b.material('hedge')
    b.push()
    b.box(len, h, d)
    b.pop()
  }

  function planting (b) {
    const rnd = CH.rng(20240612)

    // Orange trees flanking the walk up to the north door.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        b.push()
        b.translate(sx * 5.6, 0.02, -17 - i * 5.6)
        orangeTree(b)
        b.pop()
      }
    }

    // Cedars — the great one to the west is the landmark of the court.
    const cedars = [
      [-46, -20, 21], [-54, -44, 18], [50, -30, 19], [46, -58, 16],
      [-60, 24, 17], [64, 30, 18], [-46, 62, 15], [50, 66, 16]
    ]
    for (const [x, z, h] of cedars) {
      b.push()
      b.translate(x, 0, z)
      b.rotateY(rnd() * CH.TAU)
      cedar(b, h, rnd)
      b.pop()
    }

    // Limes down both sides of the court, and loose groups in the park.
    for (let i = 0; i < 7; i++) {
      for (const sx of [-1, 1]) {
        b.push()
        b.translate(sx * (38 + rnd() * 3), 0, -26 - i * 7.5)
        b.rotateY(rnd() * CH.TAU)
        broadleaf(b, 13 + rnd() * 4, rnd)
        b.pop()
      }
    }
    // Loose groups in the park. Nothing is allowed into the court, the
    // garden front, or the corridors the set viewpoints look down.
    const clear = (x, z) =>
      !(z < 40 && Math.abs(x) < 78) && !(Math.abs(x) < 130 && z > -30 && z < 150)
    for (let i = 0, tries = 0; i < 24 && tries < 400; tries++) {
      const a = rnd() * CH.TAU
      const r = 90 + rnd() * 90
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r * 0.9
      if (!clear(x, z)) continue
      i++
      b.push()
      b.translate(x, 0, z)
      b.rotateY(rnd() * CH.TAU)
      if (rnd() < 0.3) cedar(b, 14 + rnd() * 8, rnd)
      else broadleaf(b, 12 + rnd() * 8, rnd)
      b.pop()
    }

    // The wood that closes the horizon.
    b.material('foliageFar')
    for (let ring = 0; ring < 3; ring++) {
      const n = 150 + ring * 30
      for (let i = 0; i < n; i++) {
        const a = (i / n) * CH.TAU + rnd() * 0.06
        const r = 168 + ring * 34 + rnd() * 26
        const h = 15 + rnd() * 11
        b.push()
        b.translate(Math.cos(a) * r, ring * 1.5, Math.sin(a) * r)
        b.scale(1, 0.78, 1)
        b.sphere(h * 0.6, 7, 5)
        b.pop()
      }
    }

    // Clipped hedges: a low run along the garden front and one closing the
    // far end of the court.
    for (const sx of [-1, 1]) {
      b.push()
      b.translate(sx * 47, 0, 20)
      hedge(b, 2.2, 1.7, 22)
      b.pop()
    }
    b.push()
    b.translate(0, 0, -73)
    hedge(b, 88, 1.9, 2.2)
    b.pop()
  }

  CH.buildPark = function (b) {
    ground(b)
    moat(b)
    bridge(b)
    planting(b)
  }

  CH.PARK = { MOAT_N, MOAT_S, MOAT_Y }
})(window)
