/* Shared constants, math helpers and the tiny global namespace. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  /** Logical screen resolution. Everything is authored in these units. */
  G.W = 240
  G.H = 400

  /** Height of the status bar; the dungeon viewport is everything below it. */
  G.HUD_H = 46
  G.VIEW_H = G.H - G.HUD_H

  /** Dungeon grid. One tile is TILE pixels square. */
  G.TILE = 16

  /** Nominal frame duration, in ms. All speeds are per-frame at 60fps. */
  G.STEP = 1000 / 60

  G.TAU = Math.PI * 2

  /* Tile kinds. Anything >= WALL blocks movement. */
  G.FLOOR = 0
  G.EXIT = 1
  G.WALL = 2
  G.DOOR = 3
  G.BREAKABLE = 4

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

  /** Centre-based axis-aligned overlap test. */
  G.hit = (ax, ay, ah, bx, by, bh) => {
    const h = (ah + bh) * 0.5
    return Math.abs(ax - bx) < h && Math.abs(ay - by) < h
  }

  G.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

  /** Snap an angle to one of the eight compass directions, as a unit vector.

      Gauntlet is an eight-way game: sprites face eight ways and shots travel
      along those eight headings, so free angles are quantised on the way in. */
  G.OCTANTS = [
    { x: 1, y: 0 }, { x: 0.7071, y: 0.7071 }, { x: 0, y: 1 }, { x: -0.7071, y: 0.7071 },
    { x: -1, y: 0 }, { x: -0.7071, y: -0.7071 }, { x: 0, y: -1 }, { x: 0.7071, y: -0.7071 }
  ]

  G.octantOf = (dx, dy) => {
    const a = Math.atan2(dy, dx)
    let i = Math.round(a / (Math.PI / 4))
    if (i < 0) i += 8
    return i % 8
  }

  /** Format a number with thousands separators, for the status bar. */
  G.commas = n => String(n | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
})(window)
