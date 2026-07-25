/* Shared math and the tiny global namespace.

   Everything in this project is authored in metres, +Y up, with the château's
   main (north) facade looking down -Z. */
(function (global) {
  'use strict'

  const CH = global.CH || (global.CH = {})

  CH.TAU = Math.PI * 2
  CH.DEG = Math.PI / 180

  CH.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  CH.lerp = (a, b, t) => a + (b - a) * t
  CH.smoothstep = (e0, e1, x) => {
    const t = CH.clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  /** Deterministic PRNG (mulberry32) so the park looks identical on every
      load — the trees are scattered randomly, but always the same way. */
  CH.rng = seed => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /* --- vec3, as plain 3-element arrays ----------------------------------- */

  const v3 = CH.v3 = {}
  v3.add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  v3.sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  v3.scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
  v3.dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  v3.cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
  v3.len = a => Math.hypot(a[0], a[1], a[2])
  v3.norm = a => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  }
  v3.lerp = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]

  /* --- mat4, column-major Float32Arrays (what WebGL wants) --------------- */

  const m4 = CH.m4 = {}

  m4.create = () => new Float32Array(16)

  m4.identity = (o = m4.create()) => {
    o.fill(0)
    o[0] = o[5] = o[10] = o[15] = 1
    return o
  }

  m4.clone = m => new Float32Array(m)

  m4.copy = (src, o) => {
    o.set(src)
    return o
  }

  /** o = a * b (b is applied first). Safe to alias with a or b. */
  m4.multiply = (a, b, o = m4.create()) => {
    const r = o === a || o === b ? m4.create() : o
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
      r[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
      r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
      r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
      r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
    }
    if (r !== o) o.set(r)
    return o
  }

  /* The in-place variants below post-multiply, i.e. `m = m * T`, which is what
     a transform stack wants: the newest transform applies in local space. */

  m4.translate = (m, x, y, z) => {
    m[12] += m[0] * x + m[4] * y + m[8] * z
    m[13] += m[1] * x + m[5] * y + m[9] * z
    m[14] += m[2] * x + m[6] * y + m[10] * z
    m[15] += m[3] * x + m[7] * y + m[11] * z
    return m
  }

  m4.rotateX = (m, a) => {
    const c = Math.cos(a), s = Math.sin(a)
    for (let i = 0; i < 4; i++) {
      const c1 = m[4 + i], c2 = m[8 + i]
      m[4 + i] = c1 * c + c2 * s
      m[8 + i] = c2 * c - c1 * s
    }
    return m
  }

  m4.rotateY = (m, a) => {
    const c = Math.cos(a), s = Math.sin(a)
    for (let i = 0; i < 4; i++) {
      const c0 = m[i], c2 = m[8 + i]
      m[i] = c0 * c - c2 * s
      m[8 + i] = c0 * s + c2 * c
    }
    return m
  }

  m4.rotateZ = (m, a) => {
    const c = Math.cos(a), s = Math.sin(a)
    for (let i = 0; i < 4; i++) {
      const c0 = m[i], c1 = m[4 + i]
      m[i] = c0 * c + c1 * s
      m[4 + i] = c1 * c - c0 * s
    }
    return m
  }

  m4.scale = (m, x, y, z) => {
    for (let i = 0; i < 4; i++) {
      m[i] *= x
      m[4 + i] *= y
      m[8 + i] *= z
    }
    return m
  }

  m4.perspective = (fovy, aspect, near, far, o = m4.create()) => {
    const f = 1 / Math.tan(fovy * 0.5)
    o.fill(0)
    o[0] = f / aspect
    o[5] = f
    o[10] = (far + near) / (near - far)
    o[11] = -1
    o[14] = (2 * far * near) / (near - far)
    return o
  }

  m4.ortho = (l, r, b, t, n, f, o = m4.create()) => {
    o.fill(0)
    o[0] = 2 / (r - l)
    o[5] = 2 / (t - b)
    o[10] = -2 / (f - n)
    o[12] = -(r + l) / (r - l)
    o[13] = -(t + b) / (t - b)
    o[14] = -(f + n) / (f - n)
    o[15] = 1
    return o
  }

  m4.lookAt = (eye, target, up, o = m4.create()) => {
    const z = v3.norm(v3.sub(eye, target))
    let x = v3.cross(up, z)
    if (v3.len(x) < 1e-6) x = v3.cross([up[1], up[2], up[0]], z)
    x = v3.norm(x)
    const y = v3.cross(z, x)
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0
    o[12] = -v3.dot(x, eye); o[13] = -v3.dot(y, eye); o[14] = -v3.dot(z, eye); o[15] = 1
    return o
  }

  m4.invert = (m, o = m4.create()) => {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3]
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7]
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11]
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15]

    const b00 = a00 * a11 - a01 * a10
    const b01 = a00 * a12 - a02 * a10
    const b02 = a00 * a13 - a03 * a10
    const b03 = a01 * a12 - a02 * a11
    const b04 = a01 * a13 - a03 * a11
    const b05 = a02 * a13 - a03 * a12
    const b06 = a20 * a31 - a21 * a30
    const b07 = a20 * a32 - a22 * a30
    const b08 = a20 * a33 - a23 * a30
    const b09 = a21 * a32 - a22 * a31
    const b10 = a21 * a33 - a23 * a31
    const b11 = a22 * a33 - a23 * a32

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
    if (!det) return m4.identity(o)
    det = 1 / det

    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
    return o
  }

  m4.transformPoint = (m, p) => {
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1
    return [
      (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
      (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
      (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w
    ]
  }
})(window)
