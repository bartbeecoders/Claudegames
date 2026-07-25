/* Flight paths.

   Galaga's enemies never travel in straight lines: they sweep in along smooth
   loops. Rather than hand-placing control points we drive a "turtle" that can
   only go forward or turn along an arc of a given radius. That guarantees the
   resulting polyline is tangent-continuous, so an entity following it never
   snaps direction. */
(function (global) {
  'use strict'

  const G = global.G
  const D2R = Math.PI / 180
  const SAMPLE = 2.5 // polyline resolution, in pixels

  function Turtle (x, y, headingDeg) {
    this.x = x
    this.y = y
    this.a = headingDeg * D2R
    this.pts = [{ x: x, y: y }]
  }

  Turtle.prototype.forward = function (d) {
    const n = Math.max(1, Math.ceil(d / SAMPLE))
    const dx = Math.cos(this.a) * (d / n)
    const dy = Math.sin(this.a) * (d / n)
    for (let i = 0; i < n; i++) {
      this.x += dx
      this.y += dy
      this.pts.push({ x: this.x, y: this.y })
    }
    return this
  }

  /** Arc through `deg` degrees. Positive turns clockwise on screen (y grows down). */
  Turtle.prototype.turn = function (deg, radius) {
    const rad = deg * D2R
    const sign = Math.sign(rad) || 1
    const cx = this.x + Math.cos(this.a + sign * Math.PI / 2) * radius
    const cy = this.y + Math.sin(this.a + sign * Math.PI / 2) * radius
    const a0 = Math.atan2(this.y - cy, this.x - cx)
    const n = Math.max(2, Math.ceil(Math.abs(rad) * radius / SAMPLE))
    for (let i = 1; i <= n; i++) {
      const a = a0 + rad * (i / n)
      this.x = cx + Math.cos(a) * radius
      this.y = cy + Math.sin(a) * radius
      this.pts.push({ x: this.x, y: this.y })
    }
    this.a += rad
    return this
  }

  /** Move to an absolute point without emitting samples (used to seed a path). */
  Turtle.prototype.done = function () {
    return makePath(this.pts)
  }

  /** Wrap a polyline so it can be sampled by arc length. */
  function makePath (pts) {
    const cum = [0]
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    }
    const length = cum[cum.length - 1]

    return {
      pts: pts,
      length: length,
      /** Position and heading at arc-length `d`. Clamped at both ends. */
      at (d) {
        if (d <= 0) {
          const p = pts[0]
          const q = pts[Math.min(1, pts.length - 1)]
          return { x: p.x, y: p.y, a: Math.atan2(q.y - p.y, q.x - p.x) }
        }
        if (d >= length) {
          const p = pts[pts.length - 1]
          const q = pts[Math.max(0, pts.length - 2)]
          return { x: p.x, y: p.y, a: Math.atan2(p.y - q.y, p.x - q.x) }
        }
        // Binary search the cumulative table.
        let lo = 0
        let hi = cum.length - 1
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1
          if (cum[mid] <= d) lo = mid
          else hi = mid
        }
        const seg = cum[hi] - cum[lo] || 1
        const t = (d - cum[lo]) / seg
        const p = pts[lo]
        const q = pts[hi]
        return {
          x: G.lerp(p.x, q.x, t),
          y: G.lerp(p.y, q.y, t),
          a: Math.atan2(q.y - p.y, q.x - p.x)
        }
      }
    }
  }

  /* --- Entrance paths ---------------------------------------------------- */
  /* `side` is -1 for left, +1 for right. All of these end high on the screen
     with the enemy pointing roughly upward; the caller then peels off into the
     "fly to my formation slot" steering behaviour. */

  /** Rises from below the screen, performs a full loop, continues upward. */
  function entranceBottom (side) {
    const x = G.W / 2 + side * 30
    return new Turtle(x, G.H + 24, -90)
      .forward(110)
      .turn(side * 360, 26)
      .forward(70)
      .turn(-side * 30, 60)
      .done()
  }

  /** Drops in from a top corner, hooks inward, and climbs back up. */
  function entranceTopSide (side) {
    const x = G.W / 2 + side * 96
    return new Turtle(x, -24, 90)
      .forward(70)
      .turn(-side * 90, 38)
      .forward(70)
      .turn(-side * 90, 38)
      .forward(40)
      .turn(side * 40, 50)
      .done()
  }

  /** Dives down the centre, splits sideways into a wide loop. */
  function entranceTopCenter (side) {
    const x = G.W / 2 - side * 10
    return new Turtle(x, -24, 90)
      .forward(120)
      .turn(side * 300, 30)
      .forward(60)
      .done()
  }

  /** Comes in low from one edge, sweeps up and across. */
  function entranceSideSweep (side) {
    const y = 150
    return new Turtle(G.W / 2 + side * 150, y, side > 0 ? 180 : 0)
      .forward(60)
      .turn(-side * 180, 34)
      .forward(70)
      .turn(side * 240, 30)
      .forward(50)
      .done()
  }

  const ENTRANCES = [entranceTopCenter, entranceBottom, entranceTopSide, entranceSideSweep]

  /* --- Attack paths ------------------------------------------------------ */

  /** Peel out of formation, swoop across the player, and exit off the bottom. */
  function diveBee (x, y, side) {
    return new Turtle(x, y, 90)
      .turn(-side * 150, 22)
      .forward(40)
      .turn(side * 170, 30)
      .forward(60)
      .turn(-side * 45, 70)
      .forward(220)
      .done()
  }

  /** Tighter, more aggressive S-curve. */
  function diveButterfly (x, y, side) {
    return new Turtle(x, y, 90)
      .turn(side * 120, 26)
      .forward(30)
      .turn(-side * 200, 34)
      .forward(50)
      .turn(side * 110, 40)
      .forward(240)
      .done()
  }

  /** Wide, slow arc — the boss brings escorts along this one. */
  function diveBoss (x, y, side) {
    return new Turtle(x, y, 90)
      .turn(-side * 90, 40)
      .forward(50)
      .turn(side * 180, 46)
      .forward(70)
      .turn(-side * 90, 55)
      .forward(220)
      .done()
  }

  /** Straight-ish approach used when a boss is going for a capture. */
  function diveCapture (x, y, targetX) {
    const side = targetX > x ? 1 : -1
    return new Turtle(x, y, 90)
      .turn(-side * 60, 34)
      .forward(30)
      .turn(side * 120, 40)
      .forward(Math.max(20, Math.abs(targetX - x)))
      .turn(-side * 60, 34)
      .done()
  }

  /** Re-entry from the top of the screen after exiting the bottom. */
  function reentry (x) {
    return new Turtle(x, -20, 90).forward(60).done()
  }

  G.Paths = {
    Turtle,
    makePath,
    ENTRANCES,
    entranceBottom,
    entranceTopSide,
    entranceTopCenter,
    entranceSideSweep,
    diveBee,
    diveButterfly,
    diveBoss,
    diveCapture,
    reentry
  }
})(window)
