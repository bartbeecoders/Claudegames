/* Bolts, particles, debris and explosions.

   All four are fixed-size pools that never allocate after startup: at sixty
   frames a second with a couple of thousand live sparks, the difference
   between reusing objects and making new ones is the difference between a
   smooth frame and a visible hitch every few seconds.

   Collision lives in game.js, which is the only place that knows what is in
   the world; this file just integrates and draws. */
(function (global) {
  'use strict'

  const G = global.G

  const MAX_PARTICLES = 1400
  const MAX_BOLTS = 320
  const MAX_DEBRIS = 90

  const tmp = G.v3(), tmp2 = G.v3()

  /* ---------------------------------------------------------- particles -- */

  const particles = []
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      alive: false,
      pos: G.v3(), vel: G.v3(),
      life: 0, maxLife: 1,
      size: 1, sizeEnd: 1,
      r: 1, g: 1, b: 1, a: 1,
      sprite: 0, drag: 1, spin: 0, spinRate: 0,
      glow: 0 // extra brightness at birth, decays with life
    })
  }
  let particleCursor = 0

  /** Grab the next free particle, recycling the oldest if the pool is full.
      Dropping the oldest is the right failure mode: in a firefight the newest
      sparks are the ones the player is actually looking at. */
  const nextParticle = () => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[particleCursor]
      particleCursor = (particleCursor + 1) % MAX_PARTICLES
      if (!p.alive) return p
    }
    const p = particles[particleCursor]
    particleCursor = (particleCursor + 1) % MAX_PARTICLES
    return p
  }

  const spawnParticle = o => {
    const p = nextParticle()
    p.alive = true
    G.vcopyTo(p.pos, o.pos)
    if (o.vel) G.vcopyTo(p.vel, o.vel)
    else G.vset(p.vel, 0, 0, 0)
    p.life = p.maxLife = o.life
    p.size = o.size
    p.sizeEnd = o.sizeEnd === undefined ? o.size : o.sizeEnd
    p.r = o.r; p.g = o.g; p.b = o.b
    p.a = o.a === undefined ? 1 : o.a
    p.sprite = o.sprite === undefined ? G.SPRITE.DOT : o.sprite
    p.drag = o.drag === undefined ? 1 : o.drag
    p.spin = o.spin || 0
    p.spinRate = o.spinRate || 0
    p.glow = o.glow || 0
    return p
  }

  /* -------------------------------------------------------------- bolts -- */

  const bolts = []
  for (let i = 0; i < MAX_BOLTS; i++) {
    bolts.push({
      alive: false,
      pos: G.v3(), prev: G.v3(), dir: G.v3(),
      speed: 0, life: 0, damage: 0,
      length: 14, width: 1.2,
      r: 1, g: 0.2, b: 0.15,
      hostile: false,
      seeking: null,   // torpedoes track a target
      turn: 0,
      torpedo: false,
      owner: null
    })
  }

  const fireBolt = o => {
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i]
      if (b.alive) continue
      b.alive = true
      G.vcopyTo(b.pos, o.pos)
      G.vcopyTo(b.prev, o.pos)
      G.vnorm(b.dir, o.dir)
      b.speed = o.speed
      b.life = o.life
      b.damage = o.damage
      b.length = o.length === undefined ? 16 : o.length
      b.width = o.width === undefined ? 1.1 : o.width
      b.r = o.r; b.g = o.g; b.b = o.b
      b.hostile = !!o.hostile
      b.seeking = o.seeking || null
      b.turn = o.turn || 0
      b.torpedo = !!o.torpedo
      b.owner = o.owner || null
      return b
    }
    return null
  }

  /* ------------------------------------------------------------- debris -- */

  const debris = []
  for (let i = 0; i < MAX_DEBRIS; i++) {
    debris.push({
      alive: false,
      pos: G.v3(), vel: G.v3(),
      quat: G.qid(), spinAxis: G.v3(0, 1, 0), spinRate: 0,
      life: 0, maxLife: 1, scale: 1, mesh: null,
      tint: new Float32Array([1, 1, 1]),
      smoke: 0, burn: 0
    })
  }

  const spawnDebris = (pos, vel, scale, tint, burn) => {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = debris[i]
      if (d.alive) continue
      d.alive = true
      G.vcopyTo(d.pos, pos)
      G.vcopyTo(d.vel, vel)
      G.qaxis(d.quat, 0, 1, 0, Math.random() * G.TAU)
      G.vrandom(d.spinAxis)
      d.spinRate = G.rand(-5, 5)
      d.life = d.maxLife = G.rand(2.6, 5.5)
      d.scale = scale
      d.mesh = G.pick(G.models.debris)
      d.tint[0] = tint[0]; d.tint[1] = tint[1]; d.tint[2] = tint[2]
      d.smoke = 0
      d.burn = burn === undefined ? 1 : burn
      return d
    }
    return null
  }

  /* --------------------------------------------------------- explosions -- */

  const FIRE = [
    [1, 0.95, 0.75], [1, 0.72, 0.28], [1, 0.45, 0.12], [0.85, 0.22, 0.08]
  ]

  /** The full set: white flash, expanding shell, shockwave ring, sparks,
      smoke and tumbling wreckage. `size` is roughly the radius in metres. */
  const explode = (pos, vel, size, opts) => {
    const o = opts || {}
    const n = G.clamp(size * 1.6, 8, 60) | 0
    const baseVel = vel || tmp2
    if (!vel) G.vset(tmp2, 0, 0, 0)

    // Core flash: very bright, very short. This is what the bloom picks up.
    spawnParticle({
      pos, vel: baseVel, life: 0.16 + size * 0.01,
      size: size * 2.6, sizeEnd: size * 5.5,
      r: 3.2, g: 2.9, b: 2.2, sprite: G.SPRITE.DOT, drag: 0.02
    })
    spawnParticle({
      pos, vel: baseVel, life: 0.5 + size * 0.05,
      size: size * 1.4, sizeEnd: size * 4.2,
      r: 1.5, g: 0.72, b: 0.25, sprite: G.SPRITE.DOT, drag: 0.1
    })

    // Shockwave: a ring that snaps outward and fades.
    spawnParticle({
      pos, vel: baseVel, life: 0.42 + size * 0.02,
      size: size * 1.2, sizeEnd: size * 9,
      r: 1.3, g: 1.0, b: 0.8, sprite: G.SPRITE.RING, drag: 0.05,
      spin: Math.random() * G.TAU
    })

    // Sparks.
    for (let i = 0; i < n; i++) {
      G.vrandom(tmp)
      const sp = G.rand(size * 2, size * 11)
      const v = G.v3(baseVel.x + tmp.x * sp, baseVel.y + tmp.y * sp, baseVel.z + tmp.z * sp)
      const c = G.pick(FIRE)
      spawnParticle({
        pos, vel: v, life: G.rand(0.3, 1.1) + size * 0.02,
        size: size * G.rand(0.1, 0.32), sizeEnd: 0.2,
        r: c[0] * 1.6, g: c[1] * 1.5, b: c[2] * 1.4,
        sprite: G.SPRITE.DOT, drag: 0.55
      })
    }

    // Smoke, which lingers and gives the wreck some weight.
    for (let i = 0; i < (n >> 1); i++) {
      G.vrandom(tmp)
      const sp = G.rand(size * 0.5, size * 3)
      spawnParticle({
        pos,
        vel: G.v3(baseVel.x + tmp.x * sp, baseVel.y + tmp.y * sp, baseVel.z + tmp.z * sp),
        life: G.rand(1.1, 2.6),
        size: size * G.rand(0.5, 1.1), sizeEnd: size * G.rand(2, 4),
        r: 0.30, g: 0.24, b: 0.22, a: 0.5,
        sprite: G.SPRITE.SMOKE, drag: 0.35,
        spin: Math.random() * G.TAU, spinRate: G.rand(-1.4, 1.4)
      })
    }

    if (o.debris !== false) {
      const count = G.clamp(size * 0.6, 3, 10) | 0
      for (let i = 0; i < count; i++) {
        G.vrandom(tmp)
        const sp = G.rand(size * 1.5, size * 6)
        spawnDebris(pos,
          G.v3(baseVel.x + tmp.x * sp, baseVel.y + tmp.y * sp, baseVel.z + tmp.z * sp),
          size * G.rand(0.09, 0.22), o.tint || [0.62, 0.65, 0.7], 1)
      }
    }

    G.Sfx.explosion(size / 9, pos)
  }

  /** A small burst where a bolt lands: sparks plus a flash, no wreckage. */
  const impact = (pos, r, g, b, scale) => {
    const s = scale || 1
    spawnParticle({
      pos, life: 0.13, size: 5 * s, sizeEnd: 12 * s,
      r: r * 2.4, g: g * 2.4, b: b * 2.4, sprite: G.SPRITE.DOT, drag: 0.1
    })
    for (let i = 0; i < 7; i++) {
      G.vrandom(tmp)
      const sp = G.rand(9, 34) * s
      spawnParticle({
        pos, vel: G.v3(tmp.x * sp, tmp.y * sp, tmp.z * sp),
        life: G.rand(0.15, 0.45),
        size: G.rand(0.5, 1.3) * s, sizeEnd: 0.1,
        r: r * 1.8 + 0.4, g: g * 1.8 + 0.25, b: b * 1.6,
        sprite: G.SPRITE.DOT, drag: 0.5
      })
    }
  }

  /** Shield flare: a ring on the surface of the bubble, facing outward. */
  const shieldFlare = (pos, r, g, b) => {
    // Small on purpose: this goes off a few metres from a chase camera, and a
    // thirty-metre ring at that range is a wall of blue across the screen.
    spawnParticle({
      pos, life: 0.28, size: 5, sizeEnd: 15, a: 0.75,
      r: r * 1.4, g: g * 1.4, b: b * 1.8,
      sprite: G.SPRITE.RING, drag: 0.05, spin: Math.random() * G.TAU
    })
  }

  /* ------------------------------------------------------------- update -- */

  const update = dt => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i]
      if (!p.alive) continue
      p.life -= dt
      if (p.life <= 0) { p.alive = false; continue }
      G.vmad(p.pos, p.vel, dt)
      if (p.drag < 1) {
        const k = Math.exp(-p.drag * 4 * dt)
        p.vel.x *= k; p.vel.y *= k; p.vel.z *= k
      }
      p.spin += p.spinRate * dt
    }

    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i]
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) { b.alive = false; continue }
      G.vcopyTo(b.prev, b.pos)
      if (b.seeking && b.seeking.alive && b.turn > 0) {
        // Torpedoes bend toward the lock rather than snapping to it, so a
        // hard break can still throw them.
        G.vsub(tmp, b.seeking.pos, b.pos)
        G.vnorm(tmp, tmp)
        G.vlerpTo(b.dir, b.dir, tmp, G.clamp(b.turn * dt, 0, 1))
        G.vnorm(b.dir, b.dir)
      }
      G.vmad(b.pos, b.dir, b.speed * dt)
    }

    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = debris[i]
      if (!d.alive) continue
      d.life -= dt
      if (d.life <= 0) { d.alive = false; continue }
      G.vmad(d.pos, d.vel, dt)
      G.qrotateLocal(d.quat, d.spinAxis.x, d.spinAxis.y, d.spinAxis.z, d.spinRate * dt)
      d.smoke -= dt
      if (d.burn > 0 && d.smoke <= 0) {
        d.smoke = 0.05
        spawnParticle({
          pos: d.pos, vel: G.v3(d.vel.x * 0.2, d.vel.y * 0.2, d.vel.z * 0.2),
          life: G.rand(0.4, 1.0),
          size: d.scale * 3, sizeEnd: d.scale * 9,
          r: 0.5, g: 0.32, b: 0.22, a: 0.45,
          sprite: G.SPRITE.SMOKE, drag: 0.4,
          spin: Math.random() * G.TAU, spinRate: G.rand(-2, 2)
        })
      }
    }
  }

  /* --------------------------------------------------------------- draw -- */

  /* Wreckage cools as it tumbles: the tint drops toward soot over its life,
     which reads as burnt metal without needing a second material. */
  const debrisOpts = { tint: new Float32Array(3) }
  const DEBRIS_OPTS = d => {
    const k = 0.45 + 0.55 * G.clamp(d.life / d.maxLife, 0, 1)
    debrisOpts.tint[0] = d.tint[0] * k
    debrisOpts.tint[1] = d.tint[1] * k
    debrisOpts.tint[2] = d.tint[2] * k
    return debrisOpts
  }

  const drawMeshes = R => {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = debris[i]
      if (!d.alive) continue
      R.mesh(d.mesh, d.pos, d.quat, d.scale, DEBRIS_OPTS(d))
    }
  }

  const drawFx = R => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i]
      if (!p.alive) continue
      const t = 1 - p.life / p.maxLife
      const size = G.lerp(p.size, p.sizeEnd, t)
      // Fade in fast, out slow; sparks read as hot then dying.
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88
      R.sprite(p.pos, size, p.r, p.g, p.b, p.a * fade, p.sprite, p.spin)
    }

    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i]
      if (!b.alive) continue
      // The visible bolt is a segment trailing the leading edge, so it stays
      // the same length regardless of frame rate.
      tmp.x = b.pos.x - b.dir.x * b.length
      tmp.y = b.pos.y - b.dir.y * b.length
      tmp.z = b.pos.z - b.dir.z * b.length
      R.beam(tmp, b.pos, b.width * 2.4, b.r * 0.5, b.g * 0.5, b.b * 0.5, 0.55)
      R.beam(tmp, b.pos, b.width, b.r, b.g, b.b, 1)
      R.sprite(b.pos, b.width * 5, b.r * 0.8, b.g * 0.8, b.b * 0.8, 0.7, G.SPRITE.DOT, 0)
      if (b.torpedo) {
        // Motor glow, and a smoke trail laid down as it flies.
        R.sprite(tmp, b.width * 9, 0.9, 0.5, 1.3, 0.5, G.SPRITE.DOT, 0)
        if (Math.random() < 0.6) {
          spawnParticle({
            pos: tmp, life: G.rand(0.4, 0.9),
            size: 3, sizeEnd: 14,
            r: 0.34, g: 0.3, b: 0.4, a: 0.4,
            sprite: G.SPRITE.SMOKE, drag: 0.6,
            spin: Math.random() * G.TAU, spinRate: G.rand(-2, 2)
          })
        }
      }
    }
  }

  const reset = () => {
    for (let i = 0; i < MAX_PARTICLES; i++) particles[i].alive = false
    for (let i = 0; i < MAX_BOLTS; i++) bolts[i].alive = false
    for (let i = 0; i < MAX_DEBRIS; i++) debris[i].alive = false
  }

  G.Fx = {
    particles, bolts, debris,
    spawn: spawnParticle,
    fire: fireBolt,
    debrisChunk: spawnDebris,
    explode,
    impact,
    shieldFlare,
    update,
    drawMeshes,
    drawFx,
    reset,
    FIRE
  }
})(window)
