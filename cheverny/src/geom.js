/* Mesh building.

   A transform stack plus the handful of solids a 17th-century château is made
   of: boxes, lofted surfaces (domes, cupolas, balusters), swept mouldings,
   hipped roofs, and walls with real window openings punched through them.

   Everything is emitted into per-material groups, so the finished model is a
   dozen or so draw calls no matter how many pieces went into it.

   Winding convention: polygons are counter-clockwise seen from the front, and
   rings passed to loft() run clockwise seen from above, so that lofting them
   upwards produces outward-facing normals. */
(function (global) {
  'use strict'

  const CH = global.CH
  const m4 = CH.m4
  const TAU = CH.TAU

  class Group {
    constructor (material) {
      this.material = material
      this.pos = []
      this.nrm = []
      this.uv = []
      this.idx = []
    }
  }

  class Builder {
    constructor () {
      this.groups = new Map()
      this.stack = [m4.identity()]
      this.material('stone')
    }

    /* --- transform stack --------------------------------------------------
       Note: a non-uniform scale() skews normals slightly, since no per-vertex
       inverse-transpose is done. That is only used on foliage blobs, where it
       does not show. */

    get top () { return this.stack[this.stack.length - 1] }
    push () { this.stack.push(m4.clone(this.top)); return this }
    pop () { this.stack.pop(); return this }
    translate (x, y, z) { m4.translate(this.top, x, y, z); return this }
    rotateX (a) { m4.rotateX(this.top, a); return this }
    rotateY (a) { m4.rotateY(this.top, a); return this }
    rotateZ (a) { m4.rotateZ(this.top, a); return this }
    scale (x, y = x, z = x) { m4.scale(this.top, x, y, z); return this }

    material (name) {
      let g = this.groups.get(name)
      if (!g) {
        g = new Group(name)
        this.groups.set(name, g)
      }
      this.g = g
      return this
    }

    /* --- low level --------------------------------------------------------- */

    /** Emit one vertex given in local space; returns its index. */
    vert (x, y, z, nx, ny, nz, u, v) {
      const m = this.top
      const g = this.g
      g.pos.push(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
      )
      const wx = m[0] * nx + m[4] * ny + m[8] * nz
      const wy = m[1] * nx + m[5] * ny + m[9] * nz
      const wz = m[2] * nx + m[6] * ny + m[10] * nz
      const l = Math.hypot(wx, wy, wz) || 1
      g.nrm.push(wx / l, wy / l, wz / l)
      g.uv.push(u, v)
      return g.pos.length / 3 - 1
    }

    tri (a, b, c) {
      this.g.idx.push(a, b, c)
      return this
    }

    /** Flat-shaded convex polygon. UVs come from a planar projection along the
        dominant axis, in metres, so procedural materials line up between
        neighbouring pieces. */
    poly (pts) {
      const n = polyNormal(pts)
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
      const [ui, vi] = ay >= ax && ay >= az ? [0, 2] : ax >= az ? [2, 1] : [0, 1]
      const base = []
      for (const p of pts) base.push(this.vert(p[0], p[1], p[2], n[0], n[1], n[2], p[ui], p[vi]))
      for (let i = 2; i < base.length; i++) this.tri(base[0], base[i - 1], base[i])
      return this
    }

    /** Loft a stack of equal-length rings into a surface.

        With `smooth` (the default) vertex normals are averaged, which is what
        domes and columns want; without it every quad is flat, which is what
        mouldings want. UVs are arc length in metres, along and across. */
    loft (sections, opts = {}) {
      const closed = opts.closed !== false
      const smooth = opts.smooth !== false
      const rows = sections.length
      const cols = sections[0].length
      const last = closed ? cols : cols - 1

      if (!smooth) {
        for (let r = 0; r < rows - 1; r++) {
          for (let c = 0; c < last; c++) {
            const c1 = (c + 1) % cols
            const a = sections[r][c], b = sections[r][c1]
            const d = sections[r + 1][c1], e = sections[r + 1][c]
            if (same(a, b) && same(e, d)) continue
            if (same(a, e)) this.poly([a, b, d])
            else if (same(b, d)) this.poly([a, b, e])
            else this.poly([a, b, d, e])
          }
        }
        return this
      }

      const nrm = []
      for (let r = 0; r < rows; r++) {
        const row = []
        for (let c = 0; c < cols; c++) row.push([0, 0, 0])
        nrm.push(row)
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < last; c++) {
          const c1 = (c + 1) % cols
          const n = polyNormal([sections[r][c], sections[r][c1], sections[r + 1][c1], sections[r + 1][c]])
          for (const [rr, cc] of [[r, c], [r, c1], [r + 1, c1], [r + 1, c]]) {
            nrm[rr][cc][0] += n[0]
            nrm[rr][cc][1] += n[1]
            nrm[rr][cc][2] += n[2]
          }
        }
      }

      const idx = []
      let v = 0
      for (let r = 0; r < rows; r++) {
        const row = []
        let u = 0
        for (let c = 0; c < cols; c++) {
          const p = sections[r][c]
          const n = nrm[r][c]
          const l = Math.hypot(n[0], n[1], n[2]) || 1
          row.push(this.vert(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, u, v))
          if (c < cols - 1) u += dist(p, sections[r][c + 1])
        }
        idx.push(row)
        if (r < rows - 1) v += dist(sections[r][0], sections[r + 1][0])
      }

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < last; c++) {
          const c1 = (c + 1) % cols
          this.tri(idx[r][c], idx[r][c1], idx[r + 1][c1])
          this.tri(idx[r][c], idx[r + 1][c1], idx[r + 1][c])
        }
      }
      return this
    }

    /* --- solids ------------------------------------------------------------ */

    /** Box standing on the local origin: centred in X and Z, y from 0 to h.
        `skip` drops faces known to be buried inside something else, by
        compass letter (N = -Z, S = +Z, W = -X, E = +X, T = top, B = bottom). */
    box (w, h, d, opts = {}) {
      const x = w / 2, z = d / 2
      const skip = opts.skip || ''
      const y0 = opts.y0 === undefined ? 0 : opts.y0
      const y1 = y0 + h
      if (!skip.includes('N')) this.poly([[-x, y1, -z], [x, y1, -z], [x, y0, -z], [-x, y0, -z]])
      if (!skip.includes('S')) this.poly([[-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z]])
      if (!skip.includes('W')) this.poly([[-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z]])
      if (!skip.includes('E')) this.poly([[x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z]])
      if (!skip.includes('T')) this.poly([[-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z]])
      if (!skip.includes('B')) this.poly([[-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z]])
      return this
    }

    /** Flat horizontal slab facing up (a terrace, a lawn, a gravel court). */
    slab (w, d, y = 0) {
      const x = w / 2, z = d / 2
      return this.poly([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]])
    }

    /** Surface of revolution about +Y. `profile` is [[radius, y], ...]. */
    revolve (profile, seg = 24, opts = {}) {
      const a0 = opts.from === undefined ? 0 : opts.from
      const a1 = opts.to === undefined ? TAU : opts.to
      const full = a1 - a0 >= TAU - 1e-6
      const n = full ? seg : seg + 1
      const sections = profile.map(([r, y]) => {
        const ring = []
        for (let i = 0; i < n; i++) {
          const a = a0 + (a1 - a0) * (i / seg)
          ring.push([Math.cos(a) * r, y, Math.sin(a) * r])
        }
        ring.reverse()
        return ring
      })
      return this.loft(sections, { closed: full, smooth: opts.smooth !== false })
    }

    cyl (r, h, seg = 16, opts = {}) {
      const rTop = opts.rTop === undefined ? r : opts.rTop
      this.revolve([[r, 0], [rTop, h]], seg, opts)
      if (opts.cap !== false) {
        const top = [], bot = []
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * TAU
          top.unshift([Math.cos(a) * rTop, h, Math.sin(a) * rTop])
          bot.push([Math.cos(a) * r, 0, Math.sin(a) * r])
        }
        if (rTop > 1e-4) this.poly(top)
        if (opts.capBottom !== false) this.poly(bot)
      }
      return this
    }

    sphere (r, seg = 18, rings = 10) {
      const profile = []
      for (let i = 0; i <= rings; i++) {
        const a = -Math.PI / 2 + (i / rings) * Math.PI
        profile.push([Math.cos(a) * r, Math.sin(a) * r])
      }
      return this.revolve(profile, seg)
    }

    /** Moulding swept around a rectangle and mitred at the corners. `profile`
        is [[outwardOffset, height], ...] measured from the face of the wall. */
    sweepRect (w, d, profile, opts = {}) {
      const sections = profile.map(([o, y]) =>
        roundRect(w / 2 + o, d / 2 + o, opts.corner || 0, opts.cornerSeg || 1, y))
      return this.loft(sections, { smooth: !!opts.smooth })
    }

    /** Bell roof on a square plan — the "dôme à l'impériale" that caps
        Cheverny's two end pavilions. `profile` is [[scale, y], ...] where the
        scale multiplies the half-width, half-depth and corner radius. */
    bell (halfW, halfD, corner, profile, seg = 6) {
      const sections = profile.map(([s, y]) =>
        roundRect(halfW * s, halfD * s, corner * s, seg, y))
      return this.loft(sections)
    }

    /** Hipped roof rising from a w × d footprint to a ridge at height h. The
        ridge runs along the longer axis; `inset` is the horizontal run of the
        hips at the two ends. */
    hipRoof (w, d, h, opts = {}) {
      const x = w / 2, z = d / 2
      const inset = opts.inset === undefined ? Math.min(x, z) : opts.inset
      const alongX = w >= d
      const rx = alongX ? Math.max(0, x - inset) : 0
      const rz = alongX ? 0 : Math.max(0, z - inset)
      this.poly([[-x, 0, -z], [-rx, h, -rz], [rx, h, -rz], [x, 0, -z]])
      this.poly([[x, 0, z], [rx, h, rz], [-rx, h, rz], [-x, 0, z]])
      this.poly([[x, 0, z], [x, 0, -z], [rx, h, -rz], [rx, h, rz]])
      this.poly([[-x, 0, -z], [-x, 0, z], [-rx, h, rz], [-rx, h, -rz]])
      return this
    }

    /** Flight of steps climbing towards -Z from the local origin, centred on
        X. Each tread is a solid block sitting on the one below, so the flight
        reads as cut stone. `back` extends the top landing further back. */
    stairs (w, steps, rise, run, opts = {}) {
      const back = opts.back === undefined ? 0 : opts.back
      const zBack = -steps * run - back
      for (let i = 0; i < steps; i++) {
        const zFront = -i * run
        this.push()
        this.translate(0, 0, (zFront + zBack) / 2)
        this.box(w, (i + 1) * rise, zFront - zBack, { skip: 'B' })
        this.pop()
      }
      return this
    }

    /** Wall panel in the XY plane (front face towards +Z at z = 0) with
        rectangular openings punched out of it. Openings are in panel space:
        x from the centre, y from the bottom. */
    wallPanel (w, h, openings, opts = {}) {
      const x0 = -w / 2, x1 = w / 2
      const z = opts.z || 0
      const ys = new Set([0, h])
      for (const o of openings) {
        ys.add(Math.max(0, o.y))
        ys.add(Math.min(h, o.y + o.h))
      }
      const rows = [...ys].filter(y => y >= -1e-6 && y <= h + 1e-6).sort((a, b) => a - b)
      for (let i = 0; i < rows.length - 1; i++) {
        const ya = rows[i], yb = rows[i + 1]
        if (yb - ya < 1e-5) continue
        const mid = (ya + yb) / 2
        const cuts = openings
          .filter(o => o.y < mid && o.y + o.h > mid)
          .sort((a, b) => a.x - b.x)
        let cursor = x0
        for (const o of cuts) {
          const left = o.x - o.w / 2
          if (left - cursor > 1e-5) this.poly([[cursor, ya, z], [left, ya, z], [left, yb, z], [cursor, yb, z]])
          cursor = Math.max(cursor, o.x + o.w / 2)
        }
        if (x1 - cursor > 1e-5) this.poly([[cursor, ya, z], [x1, ya, z], [x1, yb, z], [cursor, yb, z]])
      }
      return this
    }

    /** The reveal of an opening — jambs, head and sill returns — running back
        from z = 0 to z = -depth. Faces point inwards, into the opening. */
    reveal (w, h, depth, opts = {}) {
      const x = w / 2
      const y0 = opts.y0 || 0
      const y1 = y0 + h
      this.poly([[-x, y0, 0], [-x, y0, -depth], [-x, y1, -depth], [-x, y1, 0]])
      this.poly([[x, y0, -depth], [x, y0, 0], [x, y1, 0], [x, y1, -depth]])
      this.poly([[-x, y1, 0], [-x, y1, -depth], [x, y1, -depth], [x, y1, 0]])
      this.poly([[x, y0, 0], [x, y0, -depth], [-x, y0, -depth], [-x, y0, 0]])
      return this
    }
  }

  /* --- helpers ------------------------------------------------------------ */

  function same (a, b) {
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
  }

  function dist (a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }

  /** Newell's method — robust for near-degenerate polygons. */
  function polyNormal (pts) {
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    const l = Math.hypot(nx, ny, nz) || 1
    return [nx / l, ny / l, nz / l]
  }

  /** Ring around a rectangle with rounded corners, in the XZ plane at height
      y, wound clockwise seen from above. `seg` is segments per corner. */
  function roundRect (hw, hd, r, seg = 1, y = 0) {
    r = Math.max(0, Math.min(r, hw, hd))
    const pts = []
    // Counter-clockwise by quadrant, then reversed at the end.
    const corners = [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, -Math.PI / 2]]
    for (const [sx, sz, a0] of corners) {
      if (r <= 1e-6 || seg <= 1) {
        pts.push([hw * sx, y, hd * sz])
        continue
      }
      const cx = (hw - r) * sx, cz = (hd - r) * sz
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2)
        pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r])
      }
    }
    pts.reverse()
    return pts
  }

  CH.Builder = Builder
  CH.roundRect = roundRect

  /* --- moulding profiles, in metres --------------------------------------
     Each is [[outwardOffset, height], ...] read from bottom to top. */

  CH.PROFILES = {
    /** Main entablature: fillet, cyma, corona, fillet. */
    cornice: [
      [0, 0], [0.10, 0.06], [0.10, 0.20], [0.22, 0.32],
      [0.40, 0.44], [0.40, 0.60], [0.28, 0.68], [0.28, 0.76], [0.04, 0.86]
    ],
    /** Lighter cornice, for pavilion attics and dormers. */
    corniceSmall: [
      [0, 0], [0.07, 0.05], [0.07, 0.13], [0.17, 0.22], [0.17, 0.32], [0.04, 0.38]
    ],
    /** Storey band (bandeau) between floors. */
    band: [[0, 0], [0.08, 0.04], [0.08, 0.30], [0, 0.36]],
    /** Base plinth, splayed at the bottom. */
    plinth: [[0.26, 0], [0.26, 0.52], [0.12, 0.74], [0.12, 0.88], [0, 1.0]],
    /** Window sill. */
    sill: [[0, 0], [0.12, 0.06], [0.12, 0.15], [0.02, 0.21]],
    /** Balustrade rail. */
    rail: [[0, 0], [0.05, 0.03], [0.05, 0.11], [0, 0.15]]
  }

  /** Turned baluster profile, normalised to a unit height. */
  CH.BALUSTER = [
    [0.13, 0], [0.13, 0.06], [0.09, 0.10], [0.10, 0.16], [0.15, 0.26],
    [0.16, 0.38], [0.13, 0.50], [0.08, 0.62], [0.07, 0.72], [0.10, 0.80],
    [0.10, 0.86], [0.13, 0.92], [0.13, 1.0]
  ]
})(window)
