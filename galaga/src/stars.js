/* Scrolling starfield. Galaga's stars blink in and out in colour groups and
   scroll at a few different speeds, so we mimic that rather than using plain
   white dots. */
(function (global) {
  'use strict'

  const G = global.G

  const COLORS = ['#ffffff', '#8fd0ff', '#ffd0d0', '#d0ffd8', '#ffe9a0', '#c9c0ff']

  function Starfield (count) {
    this.stars = []
    this.speed = 1
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * G.W,
        y: Math.random() * G.H,
        z: G.rand(0.35, 1.4),
        color: G.pick(COLORS),
        // Blink cycle, in frames.
        phase: Math.random() * 260,
        period: G.rand(150, 320)
      })
    }
  }

  Starfield.prototype.update = function (dt) {
    for (const s of this.stars) {
      s.y += s.z * this.speed * dt
      s.phase += dt
      if (s.phase > s.period) s.phase -= s.period
      if (s.y > G.H) {
        s.y -= G.H
        s.x = Math.random() * G.W
      } else if (s.y < 0) {
        s.y += G.H
        s.x = Math.random() * G.W
      }
    }
  }

  Starfield.prototype.draw = function (ctx) {
    for (const s of this.stars) {
      // Stars are lit for roughly two thirds of their cycle.
      if (s.phase > s.period * 0.66) continue
      ctx.fillStyle = s.color
      ctx.globalAlpha = s.z > 1 ? 1 : 0.55 + s.z * 0.3
      ctx.fillRect(s.x | 0, s.y | 0, 1, 1)
    }
    ctx.globalAlpha = 1
  }

  G.Starfield = Starfield
})(window)
