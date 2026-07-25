/* Dungeon generation and tile rendering.

   Levels are generated rather than authored: rooms are scattered, connected
   with L-shaped corridors, then furnished with generators, treasure and an
   exit. The arcade had 100+ hand-drawn mazes; generating them keeps the game
   endless and the repository free of level data. */
(function (global) {
  'use strict'

  const G = global.G
  const TILE = G.TILE

  /** Palettes cycle so consecutive levels do not look identical. */
  const THEMES = [
    { wall: '#4a4a68', wallTop: '#6a6a90', wallDark: '#2a2a3e', floor: '#151520', grit: '#1e1e2c' },
    { wall: '#5a4038', wallTop: '#7d5a4c', wallDark: '#331f1c', floor: '#1a1412', grit: '#241a17' },
    { wall: '#2f5a4a', wallTop: '#427d68', wallDark: '#1a3329', floor: '#101a16', grit: '#17241f' },
    { wall: '#4a3a68', wallTop: '#68538f', wallDark: '#281f3a', floor: '#16121f', grit: '#1f1a2b' }
  ]

  function Dungeon (level) {
    this.level = level
    this.theme = THEMES[(level - 1) % THEMES.length]

    // Grow the maze with the level, but stop before it becomes a chore to
    // cross. The floor is set high enough that even level 1 has room for a
    // handful of proper rooms rather than three closets.
    this.w = Math.min(54, 36 + level * 2)
    this.h = Math.min(54, 36 + level * 2)

    this.tiles = new Uint8Array(this.w * this.h).fill(G.WALL)
    this.rooms = []

    this.generate()
  }

  Dungeon.prototype.idx = function (tx, ty) {
    return ty * this.w + tx
  }

  Dungeon.prototype.inBounds = function (tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h
  }

  Dungeon.prototype.at = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return G.WALL
    return this.tiles[this.idx(tx, ty)]
  }

  Dungeon.prototype.set = function (tx, ty, v) {
    if (this.inBounds(tx, ty)) this.tiles[this.idx(tx, ty)] = v
  }

  /** Blocking test in tile space. Doors block until they are opened. */
  Dungeon.prototype.solid = function (tx, ty) {
    return this.at(tx, ty) >= G.WALL
  }

  /** Blocking test in pixel space. */
  Dungeon.prototype.solidAt = function (px, py) {
    return this.solid(Math.floor(px / TILE), Math.floor(py / TILE))
  }

  Dungeon.prototype.carveRoom = function (r) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) this.set(x, y, G.FLOOR)
    }
  }

  Dungeon.prototype.carveCorridor = function (ax, ay, bx, by) {
    // L-shaped, two tiles wide: Gauntlet corridors need room to dodge in.
    const stepX = ax < bx ? 1 : -1
    for (let x = ax; x !== bx + stepX; x += stepX) {
      this.set(x, ay, G.FLOOR)
      this.set(x, ay + 1, G.FLOOR)
    }
    const stepY = ay < by ? 1 : -1
    for (let y = ay; y !== by + stepY; y += stepY) {
      this.set(bx, y, G.FLOOR)
      this.set(bx + 1, y, G.FLOOR)
    }
  }

  Dungeon.prototype.generate = function () {
    const target = Math.min(14, 6 + this.level)
    let guard = 0

    while (this.rooms.length < target && guard++ < 400) {
      const w = G.randInt(5, 10)
      const h = G.randInt(5, 10)
      const x = G.randInt(2, this.w - w - 3)
      const y = G.randInt(2, this.h - h - 3)
      const room = { x, y, w, h, cx: (x + w / 2) | 0, cy: (y + h / 2) | 0 }

      // Leave a wall between rooms so the map reads as rooms, not one blob.
      const clash = this.rooms.some(o =>
        x < o.x + o.w + 2 && x + w + 2 > o.x && y < o.y + o.h + 2 && y + h + 2 > o.y)
      if (clash) continue

      this.carveRoom(room)
      this.rooms.push(room)
    }

    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1]
      const b = this.rooms[i]
      this.carveCorridor(a.cx, a.cy, b.cx, b.cy)
    }
    // One extra loop so the map is not a pure tree — dead ends are no fun to
    // back out of when a horde is chasing you.
    if (this.rooms.length > 3) {
      const a = this.rooms[0]
      const b = this.rooms[this.rooms.length - 1]
      this.carveCorridor(a.cx, a.cy, b.cx, b.cy)
    }

    this.addBreakableWalls()
    this.seal()
  }

  /** Scatter destructible blocks in the open, as cover and as shot practice. */
  Dungeon.prototype.addBreakableWalls = function () {
    for (const room of this.rooms) {
      const n = G.randInt(0, 4)
      for (let i = 0; i < n; i++) {
        const x = G.randInt(room.x + 1, room.x + room.w - 2)
        const y = G.randInt(room.y + 1, room.y + room.h - 2)
        if (this.at(x, y) === G.FLOOR) this.set(x, y, G.BREAKABLE)
      }
    }
  }

  /** Force a solid border so nothing can wander off the edge of the world. */
  Dungeon.prototype.seal = function () {
    for (let x = 0; x < this.w; x++) {
      this.set(x, 0, G.WALL)
      this.set(x, this.h - 1, G.WALL)
    }
    for (let y = 0; y < this.h; y++) {
      this.set(0, y, G.WALL)
      this.set(this.w - 1, y, G.WALL)
    }
  }

  /** A random floor tile inside a room, as pixel centre coordinates. */
  Dungeon.prototype.spotIn = function (room) {
    for (let i = 0; i < 40; i++) {
      const x = G.randInt(room.x, room.x + room.w - 1)
      const y = G.randInt(room.y, room.y + room.h - 1)
      if (this.at(x, y) === G.FLOOR) return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }
    }
    return { x: room.cx * TILE + TILE / 2, y: room.cy * TILE + TILE / 2 }
  }

  /* --- Rendering ---------------------------------------------------------- */

  /** Draw only the tiles inside the camera window. */
  Dungeon.prototype.draw = function (ctx, camX, camY) {
    const t = this.theme
    const x0 = Math.max(0, Math.floor(camX / TILE))
    const y0 = Math.max(0, Math.floor(camY / TILE))
    const x1 = Math.min(this.w - 1, Math.ceil((camX + G.W) / TILE))
    const y1 = Math.min(this.h - 1, Math.ceil((camY + G.VIEW_H) / TILE))

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const kind = this.at(tx, ty)
        const px = tx * TILE - camX
        const py = ty * TILE - camY

        if (kind === G.WALL) {
          // Only walls with an exposed top edge get a highlight, which is
          // enough to read as height without a real lighting pass.
          ctx.fillStyle = t.wall
          ctx.fillRect(px, py, TILE, TILE)
          ctx.fillStyle = this.solid(tx, ty - 1) ? t.wall : t.wallTop
          ctx.fillRect(px, py, TILE, 4)
          ctx.fillStyle = t.wallDark
          ctx.fillRect(px, py + TILE - 2, TILE, 2)
          ctx.fillRect(px + TILE - 2, py + 4, 2, TILE - 6)
          continue
        }

        ctx.fillStyle = t.floor
        ctx.fillRect(px, py, TILE, TILE)

        if (kind === G.BREAKABLE) {
          ctx.fillStyle = t.wallTop
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4)
          ctx.fillStyle = t.wallDark
          ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8)
        } else if (kind === G.DOOR) {
          ctx.fillStyle = '#8a6a1f'
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2)
          ctx.fillStyle = '#ffd83d'
          ctx.fillRect(px + 3, py + 6, TILE - 6, 4)
        } else if (kind === G.EXIT) {
          // Pulsing portal, so it is findable from across a dark room.
          const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 220)
          ctx.fillStyle = '#1b3a6a'
          ctx.fillRect(px, py, TILE, TILE)
          ctx.globalAlpha = pulse
          ctx.fillStyle = '#5fd8ff'
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4)
          ctx.globalAlpha = 1
          ctx.fillStyle = '#eaffff'
          ctx.fillRect(px + 6, py + 4, 4, TILE - 8)
        } else if (((tx * 7 + ty * 13) & 7) === 0) {
          // Cheap deterministic grit so big floors are not flat colour.
          ctx.fillStyle = t.grit
          ctx.fillRect(px + 5, py + 6, 3, 2)
        }
      }
    }
  }

  G.Dungeon = Dungeon
})(window)
