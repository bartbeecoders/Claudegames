/* Shared constants, math helpers and the tiny global namespace. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  /** Logical playfield resolution. Everything is authored in these units. */
  G.W = 224
  G.H = 288

  /** Vertical extents of the playable area (the rest is HUD). */
  G.TOP = 18
  G.BOTTOM = 272

  /** Nominal frame duration, in ms. All speeds are expressed per-frame at 60fps. */
  G.STEP = 1000 / 60

  G.TAU = Math.PI * 2

  G.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  G.lerp = (a, b, t) => a + (b - a) * t
  G.rand = (lo, hi) => lo + Math.random() * (hi - lo)
  G.randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1))
  G.chance = p => Math.random() < p
  G.pick = arr => arr[(Math.random() * arr.length) | 0]

  /** Fisher-Yates, in place. */
  G.shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }

  /** Signed shortest difference between two angles, in (-PI, PI]. */
  G.angleDelta = (from, to) => {
    let d = (to - from) % G.TAU
    if (d > Math.PI) d -= G.TAU
    if (d < -Math.PI) d += G.TAU
    return d
  }

  /** Rotate `from` towards `to` by at most `max` radians. */
  G.turnTowards = (from, to, max) => {
    const d = G.angleDelta(from, to)
    return from + G.clamp(d, -max, max)
  }

  /** Centre-based axis-aligned overlap test. */
  G.hit = (ax, ay, ah, bx, by, bh) => {
    const h = (ah + bh) * 0.5
    return Math.abs(ax - bx) < h && Math.abs(ay - by) < h
  }

  G.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)
})(window)
