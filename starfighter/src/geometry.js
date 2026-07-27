/* Procedural geometry: a small mesh builder, and every model in the game
   assembled out of it.

   There is not a single vertex in this repository — the fighters, the
   dreadnought, the asteroids and the battle station trench are all built from
   boxes, lofts and lathes when the page loads, which takes a couple of
   milliseconds and keeps the whole game a text file.

   Convention: -Z is forward, +Y is up, +X is right, one unit is one metre. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  /** #rrggbb to a linear-ish [r, g, b] triple. */
  G.rgb = hex => {
    const n = parseInt(hex.slice(1), 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }

  const VERT_FLOATS = 10 // pos3 nor3 col3 emit1
  G.VERT_FLOATS = VERT_FLOATS

  /* ------------------------------------------------------------ builder -- */

  /** A mesh under construction, with a transform stack.

      Models read top-down: push a transform, drop a primitive, pop. Faces are
      flat shaded from their own winding, which suits hard-surface hulls and
      costs nothing to compute. */
  G.mesh = () => {
    const out = []
    let m = G.mident(G.m4())
    const stack = []
    const tmp = G.m4()
    const tmp2 = G.m4()
    let det = 1 // sign of the transform, so mirrored parts keep facing out
    let jitter = 0

    const applyPoint = (x, y, z, o) => {
      o.x = m[0] * x + m[4] * y + m[8] * z + m[12]
      o.y = m[1] * x + m[5] * y + m[9] * z + m[13]
      o.z = m[2] * x + m[6] * y + m[10] * z + m[14]
      return o
    }

    const pa = G.v3(), pb = G.v3(), pc = G.v3()
    const e1 = G.v3(), e2 = G.v3(), nrm = G.v3()
    let curCol = [1, 1, 1]
    let curEmit = 0

    const emitVert = (p, n) => {
      out.push(p.x, p.y, p.z, n.x, n.y, n.z, curCol[0], curCol[1], curCol[2], curEmit)
    }

    const api = {
      /* -- transform stack -- */
      save () { stack.push(m.slice()); return api },
      restore () { m = stack.pop(); det = api._det(); return api },
      _det () {
        // 3x3 determinant; negative means the part is mirrored.
        const d = m[0] * (m[5] * m[10] - m[6] * m[9]) -
          m[4] * (m[1] * m[10] - m[2] * m[9]) +
          m[8] * (m[1] * m[6] - m[2] * m[5])
        return d < 0 ? -1 : 1
      },
      translate (x, y, z) {
        G.mident(tmp); tmp[12] = x; tmp[13] = y; tmp[14] = z
        G.mmul(tmp2, m, tmp); m.set(tmp2)
        return api
      },
      scale (x, y, z) {
        G.mident(tmp); tmp[0] = x; tmp[5] = y === undefined ? x : y; tmp[10] = z === undefined ? x : z
        G.mmul(tmp2, m, tmp); m.set(tmp2)
        det = api._det()
        return api
      },
      rotX (a) {
        const c = Math.cos(a), s = Math.sin(a)
        G.mident(tmp); tmp[5] = c; tmp[6] = s; tmp[9] = -s; tmp[10] = c
        G.mmul(tmp2, m, tmp); m.set(tmp2)
        return api
      },
      rotY (a) {
        const c = Math.cos(a), s = Math.sin(a)
        G.mident(tmp); tmp[0] = c; tmp[2] = -s; tmp[8] = s; tmp[10] = c
        G.mmul(tmp2, m, tmp); m.set(tmp2)
        return api
      },
      rotZ (a) {
        const c = Math.cos(a), s = Math.sin(a)
        G.mident(tmp); tmp[0] = c; tmp[1] = s; tmp[4] = -s; tmp[5] = c
        G.mmul(tmp2, m, tmp); m.set(tmp2)
        return api
      },

      /* -- material -- */
      color (c, emit) {
        curCol = c
        curEmit = emit || 0
        return api
      },
      /** Random per-face brightness variation, which reads as panelling. */
      panelled (amount) { jitter = amount === undefined ? 0.07 : amount; return api },

      /* -- primitives -- */

      /** One flat-shaded triangle in local space. */
      tri (ax, ay, az, bx, by, bz, cx, cy, cz) {
        applyPoint(ax, ay, az, pa)
        if (det < 0) {
          applyPoint(cx, cy, cz, pb)
          applyPoint(bx, by, bz, pc)
        } else {
          applyPoint(bx, by, bz, pb)
          applyPoint(cx, cy, cz, pc)
        }
        G.vsub(e1, pb, pa)
        G.vsub(e2, pc, pa)
        G.vcross(nrm, e1, e2)
        G.vnorm(nrm, nrm)
        emitVert(pa, nrm); emitVert(pb, nrm); emitVert(pc, nrm)
        return api
      },

      /** A quad from four local-space corners, wound counter-clockwise. */
      quad (a, b, c, d) {
        const base = curCol
        if (jitter > 0) {
          const j = 1 + (Math.random() * 2 - 1) * jitter
          curCol = [base[0] * j, base[1] * j, base[2] * j]
        }
        api.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
        api.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2])
        curCol = base
        return api
      },

      /** Axis-aligned box centred on the origin. */
      box (sx, sy, sz) {
        const x = sx * 0.5, y = sy * 0.5, z = sz * 0.5
        api.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z])     // +Z
        api.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]) // -Z
        api.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z])     // +X
        api.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]) // -X
        api.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z])     // +Y
        api.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]) // -Y
        return api
      },

      /** A box that tapers along Z: `back` size at +Z, `front` size at -Z.
          Fuselages, wings and nose cones are all this shape. */
      taper (bw, bh, fw, fh, len, offY) {
        const z = len * 0.5
        const oy = offY || 0
        const b0 = [-bw / 2, -bh / 2, z], b1 = [bw / 2, -bh / 2, z]
        const b2 = [bw / 2, bh / 2, z], b3 = [-bw / 2, bh / 2, z]
        const f0 = [-fw / 2, -fh / 2 + oy, -z], f1 = [fw / 2, -fh / 2 + oy, -z]
        const f2 = [fw / 2, fh / 2 + oy, -z], f3 = [-fw / 2, fh / 2 + oy, -z]
        api.quad(f0, f3, f2, f1)                 // front
        api.quad(b0, b1, b2, b3)                 // back
        api.quad(b1, f1, f2, b2)                 // right
        api.quad(f0, b0, b3, f3)                 // left
        api.quad(b3, b2, f2, f3)                 // top
        api.quad(f0, f1, b1, b0)                 // bottom
        return api
      },

      /** Lathe along Z. r0 at +Z, r1 at -Z. Flat shaded, so a low segment
          count reads as machined facets rather than a smooth tube. */
      cyl (r0, r1, len, seg, capBack, capFront) {
        const z = len * 0.5
        for (let i = 0; i < seg; i++) {
          const a0 = i / seg * G.TAU, a1 = (i + 1) / seg * G.TAU
          const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1)
          api.quad(
            [c0 * r1, s0 * r1, -z], [c1 * r1, s1 * r1, -z],
            [c1 * r0, s1 * r0, z], [c0 * r0, s0 * r0, z])
          if (capBack !== false && r0 > 0) api.tri(0, 0, z, c0 * r0, s0 * r0, z, c1 * r0, s1 * r0, z)
          if (capFront !== false && r1 > 0) api.tri(0, 0, -z, c1 * r1, s1 * r1, -z, c0 * r1, s0 * r1, -z)
        }
        return api
      },

      /** A flat disc in the XY plane, facing +Z. Engine bells and glow plates. */
      disc (r, seg) {
        for (let i = 0; i < seg; i++) {
          const a0 = i / seg * G.TAU, a1 = (i + 1) / seg * G.TAU
          api.tri(0, 0, 0, Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0)
        }
        return api
      },

      /** UV sphere. Smooth normals — the only curved thing in the game that
          should not look faceted is a planet or a cockpit ball. */
      sphere (r, seg, rings) {
        for (let j = 0; j < rings; j++) {
          const p0 = j / rings * Math.PI, p1 = (j + 1) / rings * Math.PI
          const y0 = Math.cos(p0), y1 = Math.cos(p1)
          const r0 = Math.sin(p0), r1 = Math.sin(p1)
          for (let i = 0; i < seg; i++) {
            const t0 = i / seg * G.TAU, t1 = (i + 1) / seg * G.TAU
            const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1)
            const n = [
              [c0 * r0, y0, s0 * r0], [c1 * r0, y0, s1 * r0],
              [c1 * r1, y1, s1 * r1], [c0 * r1, y1, s0 * r1]
            ]
            const push = k => {
              applyPoint(n[k][0] * r, n[k][1] * r, n[k][2] * r, pa)
              // Normals are the unit sphere positions, rotated by the current
              // transform (models only ever scale spheres uniformly).
              nrm.x = m[0] * n[k][0] + m[4] * n[k][1] + m[8] * n[k][2]
              nrm.y = m[1] * n[k][0] + m[5] * n[k][1] + m[9] * n[k][2]
              nrm.z = m[2] * n[k][0] + m[6] * n[k][1] + m[10] * n[k][2]
              G.vnorm(nrm, nrm)
              emitVert(pa, nrm)
            }
            if (j > 0) { push(0); push(1); push(2) }
            if (j < rings - 1) { push(0); push(2); push(3) }
          }
        }
        return api
      },

      /** Extrude a closed 2D polygon (XY) along Z. Hexagonal solar panels,
          hull plates, trench ribs. */
      extrude (pts, depth) {
        const z = depth * 0.5
        const n = pts.length
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n]
          api.quad([a[0], a[1], -z], [b[0], b[1], -z], [b[0], b[1], z], [a[0], a[1], z])
        }
        for (let i = 1; i < n - 1; i++) {
          api.tri(pts[0][0], pts[0][1], z, pts[i][0], pts[i][1], z, pts[i + 1][0], pts[i + 1][1], z)
          api.tri(pts[0][0], pts[0][1], -z, pts[i + 1][0], pts[i + 1][1], -z, pts[i][0], pts[i][1], -z)
        }
        return api
      },

      /** Loft a chain of trapezoid cross-sections along Z. This is what makes
          a capital ship look like a capital ship: a wedge whose sides slope
          in, drawn as four long strips. Sections run nose (-Z) to tail (+Z).
          Each is {z, tw, bw, ty, by} — half widths and heights. */
      loft (sections) {
        const S = sections
        const corners = s => [
          [-s.tw, s.ty, s.z], [s.tw, s.ty, s.z], [s.bw, s.by, s.z], [-s.bw, s.by, s.z]
        ]
        for (let i = 0; i < S.length - 1; i++) {
          const a = corners(S[i]), b = corners(S[i + 1])
          api.quad(b[0], b[1], a[1], a[0]) // top
          api.quad(b[1], b[2], a[2], a[1]) // right
          api.quad(b[2], b[3], a[3], a[2]) // bottom
          api.quad(b[3], b[0], a[0], a[3]) // left
        }
        const first = corners(S[0]), last = corners(S[S.length - 1])
        api.quad(first[0], first[1], first[2], first[3]) // nose cap, facing -Z
        api.quad(last[3], last[2], last[1], last[0])     // tail cap, facing +Z
        return api
      },

      /** Scatter small boxes over a rectangle in the XZ plane, all facing +Y.
          Cheap surface detail — the difference between a slab and a hull. */
      greebles (count, w, d, maxH, rnd) {
        const r = rnd || Math.random
        for (let i = 0; i < count; i++) {
          const sx = 0.6 + r() * 3.4
          const sz = 0.6 + r() * 4
          const sy = 0.2 + r() * maxH
          api.save()
          api.translate((r() - 0.5) * w, sy * 0.5, (r() - 0.5) * d)
          if (r() < 0.4) api.rotY(r() * G.TAU)
          api.box(sx, sy, sz)
          api.restore()
        }
        return api
      },

      /* -- finish -- */

      /** Upload and return a drawable. Also reports the bounding radius, which
          the game reuses as the collision radius. */
      done (gl) {
        const data = new Float32Array(out)
        let r2 = 0
        for (let i = 0; i < data.length; i += VERT_FLOATS) {
          const d = data[i] * data[i] + data[i + 1] * data[i + 1] + data[i + 2] * data[i + 2]
          if (d > r2) r2 = d
        }
        return {
          vbo: G.buffer(gl, data),
          count: data.length / VERT_FLOATS,
          radius: Math.sqrt(r2),
          tris: data.length / VERT_FLOATS / 3
        }
      }
    }

    return api
  }

  /* ------------------------------------------------------------- models -- */

  const HULL = G.rgb('#b9bec7')
  const HULL_DARK = G.rgb('#767d89')
  const HULL_SHADOW = G.rgb('#454b56')
  const ACCENT = G.rgb('#c4362c')
  const GLASS = G.rgb('#101a26')
  const ENGINE_BLUE = G.rgb('#8fe4ff')
  const IMP_GREY = G.rgb('#5d626b')
  const IMP_DARK = G.rgb('#2b2f36')
  const IMP_PANEL = G.rgb('#3b414c')

  G.models = {}

  /** The player's fighter: four cannons on an X of wings, cockpit forward,
      four engines. Twelve metres nose to tail. */
  const buildVanguard = gl => {
    const b = G.mesh().panelled(0.05)

    // Fuselage: a long tapered spine with a sharp nose.
    b.color(HULL).save().translate(0, 0, 1.2).taper(1.5, 1.5, 1.15, 1.2, 7.5).restore()
    b.color(HULL_DARK).save().translate(0, 0.05, -3.6).taper(1.15, 1.2, 0.35, 0.4, 2.6).restore()
    b.color(ACCENT).save().translate(0, 0, -4.95).taper(0.35, 0.4, 0.1, 0.12, 0.5).restore()

    // Red flashes down the nose.
    b.color(ACCENT).save().translate(0.62, 0.1, -2.6).box(0.06, 0.5, 2.2).restore()
    b.color(ACCENT).save().translate(-0.62, 0.1, -2.6).box(0.06, 0.5, 2.2).restore()

    // Canopy and the droid socket behind it.
    b.color(HULL_DARK).save().translate(0, 0.78, -1.1).taper(1.1, 0.55, 0.75, 0.35, 2.4).restore()
    b.color(GLASS, 0.12).save().translate(0, 0.95, -1.4).taper(0.86, 0.34, 0.6, 0.22, 1.7).restore()
    b.color(HULL_SHADOW).save().translate(0, 0.85, 0.9).rotX(Math.PI / 2).cyl(0.42, 0.42, 0.5, 10).restore()
    b.color(ACCENT).save().translate(0, 1.06, 0.9).sphere(0.3, 10, 6).restore()

    // Wings. Four of them, swept back into the classic X, each with a long
    // cannon overhanging the leading edge.
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1
      const sy = i & 2 ? 1 : -1
      b.save()
      b.translate(sx * 0.7, sy * 0.35, 1.9)
      b.rotZ(sx * sy * 0.28) // dihedral: the open-S formation
      b.color(HULL)
      b.save().translate(sx * 2.6, 0, 0.35).scale(sx, sy, 1)
        .rotY(-Math.PI / 2).taper(3.2, 0.36, 2.4, 0.3, 5).restore()
      // Wing tip block and the cannon barrel.
      b.color(HULL_SHADOW).save().translate(sx * 5.1, 0, 0.3).box(0.7, 0.62, 2.6).restore()
      b.color(HULL_DARK).save().translate(sx * 5.1, 0, -2.4).cyl(0.19, 0.14, 5.4, 8).restore()
      b.color(ACCENT).save().translate(sx * 5.1, 0, -4.9).cyl(0.2, 0.2, 0.35, 8).restore()
      // Stripe on the upper surface of each wing.
      b.color(ACCENT).save().translate(sx * 3.2, sy * 0.2, 0.4).box(1.6, 0.02, 1.1).restore()

      // Engine nacelle at the wing root.
      b.color(HULL_DARK).save().translate(sx * 1.5, 0, 1.4).cyl(0.62, 0.7, 3.6, 12).restore()
      b.color(HULL_SHADOW).save().translate(sx * 1.5, 0, 3.05).cyl(0.5, 0.5, 0.5, 12).restore()
      b.color(ENGINE_BLUE, 1).save().translate(sx * 1.5, 0, 3.34).disc(0.44, 12).restore()
      b.restore()
    }

    G.models.vanguard = b.done(gl)
  }

  /** Enemy standard fighter: a cockpit ball hung between two flat panels.
      Cheap, numerous, and it screams. */
  const buildTalon = (gl, variant) => {
    const b = G.mesh().panelled(0.06)
    const panelColor = variant === 'elite' ? G.rgb('#4a5560') : IMP_PANEL

    // Cockpit ball with a recessed viewport.
    b.color(IMP_GREY).save().sphere(1.55, 14, 9).restore()
    b.color(IMP_DARK).save().translate(0, 0, -1.28).cyl(1.05, 0.95, 0.5, 8).restore()
    b.color(GLASS, 0.06).save().translate(0, 0, -1.56).rotY(Math.PI).disc(0.9, 8).restore()
    b.color(IMP_DARK).save().translate(0, 0, -1.5).rotZ(Math.PI / 8).box(0.12, 1.9, 0.14).restore()
    b.color(IMP_DARK).save().translate(0, 0, -1.5).rotZ(-Math.PI / 8).box(1.9, 0.12, 0.14).restore()

    // Chin cannons.
    for (let s = -1; s <= 1; s += 2) {
      b.color(IMP_DARK).save().translate(s * 0.55, -1.05, -1).cyl(0.13, 0.1, 2.4, 6).restore()
      b.color(G.rgb('#7a2020'), 0.5).save().translate(s * 0.55, -1.05, -2.1).cyl(0.12, 0.12, 0.2, 6).restore()
    }

    // Rear thruster.
    b.color(IMP_DARK).save().translate(0, 0, 1.4).cyl(0.7, 0.6, 0.8, 10).restore()
    b.color(G.rgb('#ff8b3a'), 0.85).save().translate(0, 0, 1.82).disc(0.5, 10).restore()

    // Wing struts and the two panels.
    for (let s = -1; s <= 1; s += 2) {
      b.color(IMP_GREY).save().translate(s * 1.9, 0, 0).rotY(Math.PI / 2).cyl(0.42, 0.34, 1.6, 8).restore()

      const R = 3.1
      const hex = []
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * G.TAU + Math.PI / 6
        // The interceptor variant pinches its panels into a dagger.
        const stretch = variant === 'interceptor' ? (Math.abs(Math.cos(a)) > 0.5 ? 1.35 : 0.78) : 1
        hex.push([Math.cos(a) * R * 0.86 * stretch, Math.sin(a) * R])
      }
      b.save().translate(s * 2.9, 0, 0).rotY(Math.PI / 2)
      if (variant === 'interceptor') b.rotZ(s * 0.22)
      b.color(panelColor).extrude(hex, 0.16)
      // Frame and spokes.
      b.color(IMP_DARK)
      for (let i = 0; i < 6; i++) {
        const a0 = i / 6 * G.TAU + Math.PI / 6, a1 = (i + 1) / 6 * G.TAU + Math.PI / 6
        const stretch0 = variant === 'interceptor' ? (Math.abs(Math.cos(a0)) > 0.5 ? 1.35 : 0.78) : 1
        const stretch1 = variant === 'interceptor' ? (Math.abs(Math.cos(a1)) > 0.5 ? 1.35 : 0.78) : 1
        const x0 = Math.cos(a0) * R * 0.86 * stretch0, y0 = Math.sin(a0) * R
        const x1 = Math.cos(a1) * R * 0.86 * stretch1, y1 = Math.sin(a1) * R
        const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5
        const len = Math.hypot(x1 - x0, y1 - y0)
        b.save().translate(mx, my, 0).rotZ(Math.atan2(y1 - y0, x1 - x0)).box(len, 0.3, 0.34).restore()
        b.save().translate(mx * 0.5, my * 0.5, 0).rotZ(Math.atan2(my, mx)).box(Math.hypot(mx, my), 0.18, 0.26).restore()
      }
      b.restore()
    }

    G.models[variant === 'interceptor' ? 'interceptor' : variant === 'elite' ? 'elite' : 'talon'] = b.done(gl)
  }

  /** Enemy bomber: two heavy pods, slow, and it hits hard. */
  const buildBomber = gl => {
    const b = G.mesh().panelled(0.05)
    b.color(IMP_GREY)
    for (let s = -1; s <= 1; s += 2) {
      b.save().translate(s * 1.7, 0, 0)
      b.color(IMP_GREY).cyl(1.25, 1.05, 6.4, 12)
      b.color(IMP_DARK).save().translate(0, 0, -3.4).cyl(1.05, 0.6, 1.2, 12).restore()
      b.color(G.rgb('#ff7a2a'), 0.9).save().translate(0, 0, 3.3).disc(0.85, 12).restore()
      b.restore()
    }
    b.color(IMP_PANEL).save().box(3.4, 1.1, 3.2).restore()
    b.color(IMP_DARK).save().translate(0, -1.1, -0.4).box(2.2, 1.2, 2.6).restore()
    b.color(G.rgb('#8a2222'), 0.4).save().translate(0, -1.75, -0.5).box(1.4, 0.16, 1.8).restore()
    for (let s = -1; s <= 1; s += 2) {
      b.color(IMP_PANEL).save().translate(s * 3.6, 0, 0.6).rotY(Math.PI / 2)
        .extrude([[-2.4, -0.9], [1.6, -1.5], [2.4, 0], [1.6, 1.5], [-2.4, 0.9]], 0.3).restore()
    }
    G.models.bomber = b.done(gl)
  }

  /** The dreadnought: a two-kilometre wedge with a command tower, engine bank
      and a shield dome on each shoulder. Its turrets are separate models so
      they can rotate and be shot off one at a time. */
  const buildDreadnought = gl => {
    const b = G.mesh().panelled(0.045)
    const L = 900 // half-length; the ship is 1.8km nose to tail

    b.color(G.rgb('#9aa1ab'))
    b.loft([
      { z: -L, tw: 6, bw: 8, ty: 3, by: -6 },
      { z: -L * 0.72, tw: 42, bw: 52, ty: 10, by: -22 },
      { z: -L * 0.35, tw: 96, bw: 116, ty: 22, by: -44 },
      { z: L * 0.1, tw: 150, bw: 176, ty: 32, by: -62 },
      { z: L * 0.62, tw: 205, bw: 232, ty: 40, by: -74 },
      { z: L, tw: 215, bw: 236, ty: 44, by: -76 }
    ])

    // Raised spine down the middle of the dorsal surface.
    b.color(G.rgb('#8d949e'))
    b.save().translate(0, 40, L * 0.45).loft([
      { z: -L * 0.9, tw: 10, bw: 14, ty: 2, by: -6 },
      { z: -L * 0.2, tw: 34, bw: 42, ty: 10, by: -8 },
      { z: L * 0.25, tw: 52, bw: 60, ty: 16, by: -10 }
    ]).restore()

    // Command tower: a stepped block, a bridge, and two sensor globes.
    b.color(G.rgb('#7f868f'))
    b.save().translate(0, 60, L * 0.74).box(96, 42, 120).restore()
    b.save().translate(0, 86, L * 0.74).box(74, 22, 92).restore()
    b.color(G.rgb('#6c737c'))
    b.save().translate(0, 108, L * 0.74).box(56, 26, 62).restore()
    b.color(GLASS, 0.35)
    b.save().translate(0, 110, L * 0.74 - 32).box(50, 10, 2).restore()
    b.color(G.rgb('#7f868f'))
    for (let s = -1; s <= 1; s += 2) {
      b.save().translate(s * 40, 128, L * 0.74).rotX(Math.PI / 2).cyl(7, 7, 26, 8).restore()
      b.save().translate(s * 40, 146, L * 0.74).sphere(17, 14, 9).restore()
    }
    b.color(G.rgb('#5d646d'))
    b.save().translate(0, 132, L * 0.74 + 4).box(14, 30, 14).restore()

    // Engine bank: eight thruster bells across the stern.
    b.color(G.rgb('#5d646d'))
    b.save().translate(0, -10, L + 4).box(400, 96, 24).restore()
    const bells = [
      [-150, 8, 46], [-72, 6, 54], [72, 6, 54], [150, 8, 46],
      [-116, -46, 30], [116, -46, 30], [0, -44, 34]
    ]
    for (const [x, y, r] of bells) {
      b.color(G.rgb('#4c525b')).save().translate(x, y, L + 10).cyl(r, r * 0.9, 34, 14).restore()
      b.color(G.rgb('#9adcff'), 1).save().translate(x, y, L + 29).disc(r * 0.82, 14).restore()
    }

    // Hull detail: ventral trenches and scattered greebles, seeded so the ship
    // looks the same every run.
    const rnd = G.seeded(0x5741)
    b.color(G.rgb('#7b828c')).panelled(0.09)
    b.save().translate(0, 45, L * 0.1).greebles(160, 300, L * 1.4, 9, rnd).restore()
    b.color(G.rgb('#6f7680'))
    b.save().translate(0, -78, L * 0.1).greebles(120, 340, L * 1.3, 7, rnd).restore()
    b.color(G.rgb('#3f444c'))
    for (let i = 0; i < 5; i++) {
      b.save().translate(0, 44.5, -L * 0.4 + i * 210).box(260 - i * 20, 3, 26).restore()
    }
    // Running lights along the flanks.
    b.color(G.rgb('#ffd9a0'), 0.9)
    for (let i = 0; i < 26; i++) {
      const z = -L * 0.6 + i * (L * 1.5 / 26)
      const t = (z + L) / (2 * L)
      const w = G.lerp(20, 220, t)
      b.save().translate(w, G.lerp(6, 40, t), z).box(3, 2.5, 10).restore()
      b.save().translate(-w, G.lerp(6, 40, t), z).box(3, 2.5, 10).restore()
    }

    G.models.dreadnought = b.done(gl)
  }

  /** A shield dome. Three of these keep the dreadnought's hull invulnerable;
      they are the first thing a strike has to take out. */
  const buildDome = gl => {
    const b = G.mesh().panelled(0.05)
    b.color(G.rgb('#6a717b')).save().translate(0, -6, 0).rotX(Math.PI / 2).cyl(22, 26, 14, 12).restore()
    b.color(G.rgb('#8b939e')).save().sphere(20, 16, 10).restore()
    b.color(G.rgb('#4fd8ff'), 0.8).save().translate(0, 14, 0).sphere(7, 12, 8).restore()
    b.color(G.rgb('#3a4049'))
    for (let i = 0; i < 6; i++) {
      b.save().rotY(i / 6 * G.TAU).translate(0, 6, 19).box(3, 22, 3).restore()
    }
    G.models.dome = b.done(gl)
  }

  /** Turret: a base and a rotating twin-barrel head, built as two meshes so
      the head can track. */
  const buildTurret = gl => {
    const base = G.mesh().panelled(0.05)
    base.color(G.rgb('#606771')).save().rotX(Math.PI / 2).cyl(7, 9, 6, 10).restore()
    base.color(G.rgb('#474d56')).save().translate(0, 3, 0).rotX(Math.PI / 2).cyl(5.5, 6.5, 4, 10).restore()
    G.models.turretBase = base.done(gl)

    const head = G.mesh().panelled(0.05)
    head.color(G.rgb('#767d88')).save().translate(0, 2.5, 0).box(9, 5.5, 11).restore()
    head.color(G.rgb('#575d67')).save().translate(0, 5.4, 1.5).box(6, 3, 6).restore()
    for (let s = -1; s <= 1; s += 2) {
      head.color(G.rgb('#3f444c')).save().translate(s * 2.6, 2.5, -8).cyl(1, 0.85, 12, 8).restore()
      head.color(G.rgb('#7a2822'), 0.5).save().translate(s * 2.6, 2.5, -14).cyl(0.9, 0.9, 0.7, 8).restore()
    }
    G.models.turretHead = head.done(gl)
  }

  /** A handful of asteroid shapes: an icosphere pushed around by noise, so
      each one is lumpy in its own way but still cheap. */
  const buildAsteroids = gl => {
    G.models.asteroids = []
    for (let v = 0; v < 4; v++) {
      const rnd = G.seeded(1000 + v * 77)
      const b = G.mesh().panelled(0.12)
      const seg = 12, rings = 8
      const warp = []
      for (let i = 0; i < 24; i++) {
        warp.push({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: rnd() * 2 - 1, a: 0.12 + rnd() * 0.5 })
      }
      const radiusAt = (x, y, z) => {
        let r = 1
        for (const w of warp) r += (x * w.x + y * w.y + z * w.z) * 0.09 * w.a
        return Math.max(0.45, r)
      }
      const grey = 0.34 + rnd() * 0.2
      b.color([grey, grey * 0.94, grey * 0.86])
      for (let j = 0; j < rings; j++) {
        const p0 = j / rings * Math.PI, p1 = (j + 1) / rings * Math.PI
        for (let i = 0; i < seg; i++) {
          const t0 = i / seg * G.TAU, t1 = (i + 1) / seg * G.TAU
          const pt = (p, t) => {
            const x = Math.sin(p) * Math.cos(t), y = Math.cos(p), z = Math.sin(p) * Math.sin(t)
            const r = radiusAt(x, y, z)
            return [x * r, y * r, z * r]
          }
          const a = pt(p0, t0), c = pt(p0, t1), d = pt(p1, t1), e = pt(p1, t0)
          b.quad(a, c, d, e)
        }
      }
      G.models.asteroids.push(b.done(gl))
    }
  }

  /** Debris chunk, thrown out of anything that explodes. */
  const buildDebris = gl => {
    G.models.debris = []
    for (let v = 0; v < 3; v++) {
      const rnd = G.seeded(500 + v * 31)
      const b = G.mesh().panelled(0.15)
      b.color(G.rgb('#8a9099'))
      for (let i = 0; i < 4; i++) {
        b.save()
        b.translate((rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.2)
        b.rotY(rnd() * G.TAU).rotX(rnd() * G.TAU)
        b.box(0.3 + rnd(), 0.2 + rnd() * 0.6, 0.4 + rnd() * 1.4)
        b.restore()
      }
      G.models.debris.push(b.done(gl))
    }
  }

  /** A unit sphere used for planets, explosion shells and shield bubbles. */
  const buildUnitSphere = gl => {
    // Planets, explosion shells and the atmosphere shell all reuse this. The
    // atmosphere is the same mesh with front faces culled instead of back.
    const b = G.mesh()
    b.color([1, 1, 1], 1).sphere(1, 32, 20)
    G.models.unitSphere = b.done(gl)
  }

  /* -------------------------------------------------------- the trench -- */

  /* The battle station run. The corridor is generated once as a chain of
     chunks; the renderer only draws the few either side of the player, so the
     whole 14km course costs about as much as one capital ship. */

  G.TRENCH = {
    HALF_W: 46,   // half the corridor width
    DEPTH: 62,    // floor to lip
    CHUNK: 400,   // metres per chunk
    CHUNKS: 34
  }

  G.buildTrench = (gl, seed) => {
    const T = G.TRENCH
    const rnd = G.seeded(seed)
    const chunks = []
    const barriers = []
    const turrets = []

    for (let c = 0; c < T.CHUNKS; c++) {
      const z0 = -c * T.CHUNK
      const b = G.mesh().panelled(0.08)

      // Floor.
      b.color(G.rgb('#4b5058'))
      b.save().translate(0, -T.DEPTH, z0 - T.CHUNK / 2).box(T.HALF_W * 2, 6, T.CHUNK).restore()
      b.color(G.rgb('#3d424a')).panelled(0.14)
      b.save().translate(0, -T.DEPTH + 3, z0 - T.CHUNK / 2).greebles(26, T.HALF_W * 1.8, T.CHUNK * 0.94, 4, rnd).restore()

      // Walls, built as stacked bands of plating with pipes and vents.
      for (let s = -1; s <= 1; s += 2) {
        b.color(G.rgb('#585e67')).panelled(0.07)
        b.save().translate(s * (T.HALF_W + 5), -T.DEPTH / 2 + 3, z0 - T.CHUNK / 2)
          .box(10, T.DEPTH + 8, T.CHUNK).restore()

        b.color(G.rgb('#464c55')).panelled(0.11)
        for (let i = 0; i < 9; i++) {
          const zz = z0 - rnd() * T.CHUNK
          const h = 3 + rnd() * 9
          b.save().translate(s * (T.HALF_W - 1.5), -T.DEPTH + 6 + rnd() * (T.DEPTH - 14), zz)
            .box(4, h, 6 + rnd() * 26).restore()
        }
        b.color(G.rgb('#33383f'))
        for (let i = 0; i < 5; i++) {
          b.save().translate(s * (T.HALF_W - 1), -T.DEPTH + 10 + rnd() * 34, z0 - rnd() * T.CHUNK)
            .rotY(Math.PI / 2).cyl(1.6, 1.6, 40 + rnd() * 90, 6).restore()
        }
        // Lit strip windows: the only warm colour down here.
        b.color(G.rgb('#ffca6a'), 0.9)
        for (let i = 0; i < 7; i++) {
          if (rnd() < 0.4) continue
          b.save().translate(s * (T.HALF_W - 0.4), -T.DEPTH + 12 + rnd() * 34, z0 - rnd() * T.CHUNK)
            .box(1, 1.4, 5 + rnd() * 12).restore()
        }
        // The lip, and the station surface running away above it.
        b.color(G.rgb('#666d76')).panelled(0.06)
        b.save().translate(s * (T.HALF_W + 40), 4, z0 - T.CHUNK / 2).box(80, 8, T.CHUNK).restore()
        b.color(G.rgb('#565c65')).panelled(0.12)
        b.save().translate(s * (T.HALF_W + 40), 8, z0 - T.CHUNK / 2)
          .greebles(22, 70, T.CHUNK * 0.9, 8, rnd).restore()
      }

      // Ribs across the corridor, and the occasional gantry to duck under.
      if (c > 1) {
        for (let i = 0; i < 2; i++) {
          const zz = z0 - rnd() * T.CHUNK
          b.color(G.rgb('#3f444c'))
          b.save().translate(0, -T.DEPTH + 2, zz).box(T.HALF_W * 2, 3, 5).restore()
        }
      }

      chunks.push(b.done(gl))

      // Obstacles are placed here but built as separate meshes so they can be
      // destroyed, and so collision stays a handful of boxes rather than a
      // scan of the whole chunk.
      if (c >= 3 && c < T.CHUNKS - 3) {
        if (rnd() < 0.8) {
          const zz = z0 - 60 - rnd() * (T.CHUNK - 120)
          const kind = rnd()
          if (kind < 0.4) {
            // A gantry spanning the trench at some height.
            const y = -T.DEPTH + 18 + rnd() * 26
            barriers.push({ x: 0, y, z: zz, hw: T.HALF_W, hh: 5, hd: 4, kind: 'span' })
          } else if (kind < 0.75) {
            // A pillar hugging one wall.
            const s = rnd() < 0.5 ? -1 : 1
            barriers.push({
              x: s * (T.HALF_W - 14), y: -T.DEPTH / 2, z: zz,
              hw: 14, hh: T.DEPTH / 2 + 4, hd: 5, kind: 'block'
            })
          } else {
            // A low block on the floor.
            barriers.push({
              x: (rnd() - 0.5) * T.HALF_W, y: -T.DEPTH + 12, z: zz,
              hw: 10 + rnd() * 12, hh: 12, hd: 5, kind: 'block'
            })
          }
        }
        if (rnd() < 0.75) {
          const s = rnd() < 0.5 ? -1 : 1
          turrets.push({
            x: s * (T.HALF_W - 3),
            y: -T.DEPTH + 14 + rnd() * 30,
            z: z0 - rnd() * T.CHUNK,
            side: s
          })
        }
      }
    }

    // The barrier mesh: one box, drawn per obstacle.
    const bm = G.mesh().panelled(0.08)
    bm.color(G.rgb('#6a7078')).box(2, 2, 2)
    bm.color(G.rgb('#c2762a'), 0.35)
    bm.save().translate(0, 0, -1.02).box(1.6, 0.3, 0.06).restore()
    bm.save().translate(0, 0, 1.02).box(1.6, 0.3, 0.06).restore()
    const barrierMesh = bm.done(gl)

    // The exhaust port at the end of the run.
    const pm = G.mesh().panelled(0.05)
    pm.color(G.rgb('#5a616a')).save().rotX(Math.PI / 2).cyl(14, 11, 6, 16).restore()
    pm.color(G.rgb('#2a2e34')).save().translate(0, -2, 0).rotX(Math.PI / 2).cyl(8.5, 8.5, 8, 16).restore()
    pm.color(G.rgb('#ff5a2a'), 0.9).save().translate(0, -3.4, 0).rotX(-Math.PI / 2).disc(7.6, 16).restore()
    pm.color(G.rgb('#3f444c'))
    for (let i = 0; i < 8; i++) {
      pm.save().rotY(i / 8 * G.TAU).translate(0, 1, 15).box(4, 4, 8).restore()
    }
    const portMesh = pm.done(gl)

    return { chunks, barriers, turrets, barrierMesh, portMesh, length: T.CHUNK * T.CHUNKS }
  }

  /** Build everything. Called once, after the GL context exists. */
  G.buildModels = gl => {
    buildVanguard(gl)
    buildTalon(gl, 'standard')
    buildTalon(gl, 'interceptor')
    buildTalon(gl, 'elite')
    buildBomber(gl)
    buildDreadnought(gl)
    buildDome(gl)
    buildTurret(gl)
    buildAsteroids(gl)
    buildDebris(gl)
    buildUnitSphere(gl)
  }
})(window)
