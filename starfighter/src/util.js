/* Constants, 3D maths and the tiny global namespace.

   Everything the game needs from a maths library, written out longhand: 4x4
   matrices for the camera, quaternions for anything that flies, and vectors as
   plain {x, y, z} objects so they stay readable in a debugger.

   The hot-path helpers all write into an output object instead of allocating,
   because at 60fps with a few thousand particles the garbage adds up fast. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  G.TAU = Math.PI * 2
  G.DEG = Math.PI / 180

  /** Nominal frame duration in seconds. Simulation is time-based, but tuning
      numbers read better as "per 60fps frame", so this is the conversion. */
  G.STEP = 1 / 60

  G.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  G.lerp = (a, b, t) => a + (b - a) * t
  G.rand = (lo, hi) => lo + Math.random() * (hi - lo)
  G.randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1))
  G.chance = p => Math.random() < p
  G.pick = arr => arr[(Math.random() * arr.length) | 0]
  G.smoothstep = (a, b, t) => {
    const x = G.clamp((t - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)
  }

  /** Frame-rate independent exponential approach: how much of the way from a
      to b to travel in dt seconds, given a per-second convergence rate. */
  G.damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt)

  G.commas = n => String(n | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  /* A seeded generator, so a trench looks the same for the whole run without
     having to store every greeble. Mulberry32. */
  G.seeded = seed => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /* ---------------------------------------------------------------- vec3 -- */

  G.v3 = (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 })
  G.vcopy = v => ({ x: v.x, y: v.y, z: v.z })

  G.vset = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o }
  G.vcopyTo = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o }
  G.vadd = (o, a, b) => { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o }
  G.vsub = (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o }
  G.vscale = (o, a, s) => { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o }

  /** o += a * s. The single most used operation in the whole game. */
  G.vmad = (o, a, s) => { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o }

  G.vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
  G.vlen = a => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  G.vlen2 = a => a.x * a.x + a.y * a.y + a.z * a.z

  G.vdist = (a, b) => {
    const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z
    return Math.sqrt(x * x + y * y + z * z)
  }
  G.vdist2 = (a, b) => {
    const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z
    return x * x + y * y + z * z
  }

  G.vnorm = (o, a) => {
    const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1
    o.x = a.x / l; o.y = a.y / l; o.z = a.z / l
    return o
  }

  G.vcross = (o, a, b) => {
    const x = a.y * b.z - a.z * b.y
    const y = a.z * b.x - a.x * b.z
    const z = a.x * b.y - a.y * b.x
    o.x = x; o.y = y; o.z = z
    return o
  }

  G.vlerpTo = (o, a, b, t) => {
    o.x = a.x + (b.x - a.x) * t
    o.y = a.y + (b.y - a.y) * t
    o.z = a.z + (b.z - a.z) * t
    return o
  }

  /** A random unit vector, uniformly distributed over the sphere. */
  G.vrandom = o => {
    const z = Math.random() * 2 - 1
    const a = Math.random() * G.TAU
    const r = Math.sqrt(1 - z * z)
    o.x = Math.cos(a) * r; o.y = Math.sin(a) * r; o.z = z
    return o
  }

  /* ---------------------------------------------------------------- quat -- */
  /* Quaternions are [x, y, z, w] arrays. Ships carry one instead of Euler
     angles so they can loop and roll without ever hitting gimbal lock. */

  G.qid = () => new Float32Array([0, 0, 0, 1])

  G.qmul = (o, a, b) => {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3]
    const bx = b[0], by = b[1], bz = b[2], bw = b[3]
    o[0] = aw * bx + ax * bw + ay * bz - az * by
    o[1] = aw * by - ax * bz + ay * bw + az * bx
    o[2] = aw * bz + ax * by - ay * bx + az * bw
    o[3] = aw * bw - ax * bx - ay * by - az * bz
    return o
  }

  G.qnorm = q => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
    q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l
    return q
  }

  /** Rotation of `angle` radians about a unit axis. */
  G.qaxis = (o, x, y, z, angle) => {
    const h = angle * 0.5
    const s = Math.sin(h)
    o[0] = x * s; o[1] = y * s; o[2] = z * s; o[3] = Math.cos(h)
    return o
  }

  const _tq = new Float32Array(4)

  /** Rotate `q` in its own local frame — the way a pilot's stick works: pitch
      is always "nose up from here", never "up in world space". */
  G.qrotateLocal = (q, x, y, z, angle) => {
    G.qaxis(_tq, x, y, z, angle)
    G.qmul(q, q, _tq)
    return G.qnorm(q)
  }

  /** Turn a vector by a quaternion: v' = q * v * q^-1, expanded. */
  G.qvec = (o, q, v) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    const ix = w * v.x + y * v.z - z * v.y
    const iy = w * v.y + z * v.x - x * v.z
    const iz = w * v.z + x * v.y - y * v.x
    const iw = -x * v.x - y * v.y - z * v.z
    o.x = ix * w + iw * -x + iy * -z - iz * -y
    o.y = iy * w + iw * -y + iz * -x - ix * -z
    o.z = iz * w + iw * -z + ix * -y - iy * -x
    return o
  }

  /* The three body axes, pulled straight out of the quaternion's matrix form.
     Cheaper than building a matrix when all you want is "which way is nose". */
  G.qforward = (o, q) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    o.x = -(2 * (x * z + w * y))
    o.y = -(2 * (y * z - w * x))
    o.z = -(1 - 2 * (x * x + y * y))
    return o
  }
  G.qright = (o, q) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    o.x = 1 - 2 * (y * y + z * z)
    o.y = 2 * (x * y + w * z)
    o.z = 2 * (x * z - w * y)
    return o
  }
  G.qup = (o, q) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    o.x = 2 * (x * y - w * z)
    o.y = 1 - 2 * (x * x + z * z)
    o.z = 2 * (y * z + w * x)
    return o
  }

  G.qslerp = (o, a, b, t) => {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    let bx = b[0], by = b[1], bz = b[2], bw = b[3]
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw }
    let sa = 1 - t, sb = t
    if (cos < 0.9995) {
      const omega = Math.acos(cos)
      const sin = Math.sin(omega)
      sa = Math.sin((1 - t) * omega) / sin
      sb = Math.sin(t * omega) / sin
    }
    o[0] = a[0] * sa + bx * sb
    o[1] = a[1] * sa + by * sb
    o[2] = a[2] * sa + bz * sb
    o[3] = a[3] * sa + bw * sb
    return G.qnorm(o)
  }

  /** The orientation whose -Z points along `fwd`, rolled upright against
      `up`. Used to point missiles, cameras and AI ships at things. */
  const _f = G.v3(), _r = G.v3(), _u = G.v3()
  G.qlook = (o, fwd, up) => {
    G.vnorm(_f, fwd)
    G.vcross(_r, up, _f)
    if (G.vlen2(_r) < 1e-6) { _r.x = 1; _r.y = 0; _r.z = 0 }
    G.vnorm(_r, _r)
    G.vcross(_u, _f, _r)

    // Build the rotation matrix (columns right, up, -forward) then convert.
    const m00 = _r.x, m01 = _u.x, m02 = -_f.x
    const m10 = _r.y, m11 = _u.y, m12 = -_f.y
    const m20 = _r.z, m21 = _u.z, m22 = -_f.z
    const tr = m00 + m11 + m22
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2
      o[3] = 0.25 * s; o[0] = (m21 - m12) / s; o[1] = (m02 - m20) / s; o[2] = (m10 - m01) / s
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2
      o[3] = (m21 - m12) / s; o[0] = 0.25 * s; o[1] = (m01 + m10) / s; o[2] = (m02 + m20) / s
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2
      o[3] = (m02 - m20) / s; o[0] = (m01 + m10) / s; o[1] = 0.25 * s; o[2] = (m12 + m21) / s
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2
      o[3] = (m10 - m01) / s; o[0] = (m02 + m20) / s; o[1] = (m12 + m21) / s; o[2] = 0.25 * s
    }
    return G.qnorm(o)
  }

  /* ---------------------------------------------------------------- mat4 -- */
  /* Column-major, like GL wants them. */

  G.m4 = () => new Float32Array(16)

  G.mident = m => {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1
    return m
  }

  G.mmul = (o, a, b) => {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3]
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33
    }
    return o
  }

  G.mperspective = (o, fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy * 0.5)
    const nf = 1 / (near - far)
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0
    return o
  }

  /** View matrix from a camera position and orientation — the inverse of the
      camera's own transform, which for a rigid body is just the transpose of
      the rotation plus a rotated translation. */
  G.mview = (o, pos, q) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    const r0 = 1 - 2 * (y * y + z * z), r1 = 2 * (x * y + w * z), r2 = 2 * (x * z - w * y)
    const u0 = 2 * (x * y - w * z), u1 = 1 - 2 * (x * x + z * z), u2 = 2 * (y * z + w * x)
    const b0 = 2 * (x * z + w * y), b1 = 2 * (y * z - w * x), b2 = 1 - 2 * (x * x + y * y)
    o[0] = r0; o[1] = u0; o[2] = b0; o[3] = 0
    o[4] = r1; o[5] = u1; o[6] = b1; o[7] = 0
    o[8] = r2; o[9] = u2; o[10] = b2; o[11] = 0
    o[12] = -(r0 * pos.x + r1 * pos.y + r2 * pos.z)
    o[13] = -(u0 * pos.x + u1 * pos.y + u2 * pos.z)
    o[14] = -(b0 * pos.x + b1 * pos.y + b2 * pos.z)
    o[15] = 1
    return o
  }

  /** Model matrix from position, orientation and a uniform scale. */
  G.mmodel = (o, pos, q, s) => {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    o[0] = (1 - 2 * (y * y + z * z)) * s
    o[1] = (2 * (x * y + w * z)) * s
    o[2] = (2 * (x * z - w * y)) * s
    o[3] = 0
    o[4] = (2 * (x * y - w * z)) * s
    o[5] = (1 - 2 * (x * x + z * z)) * s
    o[6] = (2 * (y * z + w * x)) * s
    o[7] = 0
    o[8] = (2 * (x * z + w * y)) * s
    o[9] = (2 * (y * z - w * x)) * s
    o[10] = (1 - 2 * (x * x + y * y)) * s
    o[11] = 0
    o[12] = pos.x; o[13] = pos.y; o[14] = pos.z; o[15] = 1
    return o
  }

  /** Model matrix with a per-axis scale, for the handful of things that are
      stretched boxes rather than models — trench barriers, mostly. */
  G.mmodel3 = (o, pos, q, sx, sy, sz) => {
    G.mmodel(o, pos, q, 1)
    o[0] *= sx; o[1] *= sx; o[2] *= sx
    o[4] *= sy; o[5] *= sy; o[6] *= sy
    o[8] *= sz; o[9] *= sz; o[10] *= sz
    return o
  }

  /** Normal matrix for a non-uniform scale: (M^-1)^T = R * S^-1, and each
      column of M is already R's column times its scale, so divide twice. */
  G.mnormal3 = (o, m, sx, sy, sz) => {
    const ix = 1 / (sx * sx), iy = 1 / (sy * sy), iz = 1 / (sz * sz)
    o[0] = m[0] * ix; o[1] = m[1] * ix; o[2] = m[2] * ix
    o[3] = m[4] * iy; o[4] = m[5] * iy; o[5] = m[6] * iy
    o[6] = m[8] * iz; o[7] = m[9] * iz; o[8] = m[10] * iz
    return o
  }

  /** Transform a point by a matrix, returning w for the perspective divide. */
  G.mpoint = (o, m, v) => {
    o.x = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]
    o.y = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]
    o.z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]
    return m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15]
  }

  /** The 3x3 inverse-transpose, for normals. Uniform scale only, so it is
      just the rotation part — which is what every model here uses. */
  G.mnormal = (o, m, invScale) => {
    o[0] = m[0] * invScale; o[1] = m[1] * invScale; o[2] = m[2] * invScale
    o[3] = m[4] * invScale; o[4] = m[5] * invScale; o[5] = m[6] * invScale
    o[6] = m[8] * invScale; o[7] = m[9] * invScale; o[8] = m[10] * invScale
    return o
  }

  /* ------------------------------------------------------------ geometry -- */

  /** Closest approach of a moving point to a sphere over one step.

      Bolts travel far enough per frame to skip straight through a fighter, so
      hits are tested as a swept segment rather than a point. Returns the
      fraction along the segment where it first touches, or -1. */
  G.segmentSphere = (from, dir, len, centre, radius) => {
    const mx = from.x - centre.x, my = from.y - centre.y, mz = from.z - centre.z
    const b = mx * dir.x + my * dir.y + mz * dir.z
    const c = mx * mx + my * my + mz * mz - radius * radius
    if (c > 0 && b > 0) return -1
    const disc = b * b - c
    if (disc < 0) return -1
    let t = -b - Math.sqrt(disc)
    if (t < 0) t = 0
    return t <= len ? t / len : -1
  }

  /** Where to aim to hit something that is moving: solve for the time at which
      a bolt at `speed` and the target's straight-line path meet. */
  G.leadPoint = (out, shooter, target, tvel, speed) => {
    const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = target.z - shooter.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const t = dist / speed
    out.x = target.x + tvel.x * t
    out.y = target.y + tvel.y * t
    out.z = target.z + tvel.z * t
    return t
  }
})(window)
