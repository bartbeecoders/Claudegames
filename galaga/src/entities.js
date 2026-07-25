/* Game objects: the player fighter, projectiles, enemies and explosions. */
(function (global) {
  'use strict'

  const G = global.G
  const P = G.Paths
  const S = G.Sprites

  const HALF_PI = Math.PI / 2

  /* --- Player ------------------------------------------------------------ */

  const PLAYER_Y = 250
  const PLAYER_SPEED = 1.55
  const PLAYER_HITBOX = 10

  function Player () {
    this.x = G.W / 2
    this.y = PLAYER_Y
    this.a = -HALF_PI
    this.dual = false
    this.alive = true
    this.dying = 0
    this.invuln = 0
    this.captured = false
    this.captureTimer = 0
  }

  Player.prototype.reset = function (keepDual) {
    this.x = G.W / 2
    this.y = PLAYER_Y
    this.alive = true
    this.dying = 0
    this.captured = false
    this.captureTimer = 0
    this.invuln = 90
    if (!keepDual) this.dual = false
  }

  /** Horizontal extent of the ship, wider when flying as a dual fighter. */
  Player.prototype.halfWidth = function () {
    return this.dual ? 16 : 8
  }

  Player.prototype.update = function (dt, input) {
    if (this.invuln > 0) this.invuln -= dt
    if (!this.alive) return

    if (this.captured) {
      // Being tractored upward: spin and rise until absorbed.
      this.captureTimer += dt
      this.a += 0.16 * dt
      return
    }

    let vx = 0
    if (input.left) vx -= 1
    if (input.right) vx += 1
    this.x += vx * PLAYER_SPEED * dt

    // Touch dragging supplies an absolute displacement in game pixels, already
    // scaled from screen space, so it is applied independently of `dt`.
    if (input.dragDX) this.x += input.dragDX

    const margin = this.halfWidth() + 2
    this.x = G.clamp(this.x, margin, G.W - margin)
  }

  /** Muzzle positions — one for a solo fighter, two when doubled up. */
  Player.prototype.muzzles = function () {
    if (this.dual) return [this.x - 8, this.x + 8]
    return [this.x]
  }

  Player.prototype.draw = function (ctx) {
    if (!this.alive) return
    // Blink while briefly invulnerable after respawning.
    if (this.invuln > 0 && ((this.invuln / 4) | 0) % 2 === 0) return
    if (this.dual) {
      S.draw(ctx, S.ship, this.x - 8, this.y, this.a)
      S.draw(ctx, S.ship, this.x + 8, this.y, this.a)
    } else {
      S.draw(ctx, S.ship, this.x, this.y, this.a)
    }
  }

  /* --- Projectiles ------------------------------------------------------- */

  function Bullet (x, y) {
    this.x = x
    this.y = y
    this.vy = -5.2
    this.alive = true
  }

  Bullet.prototype.update = function (dt) {
    this.y += this.vy * dt
    if (this.y < -8) this.alive = false
  }

  Bullet.prototype.draw = function (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(this.x - 0.5, this.y - 4, 1, 6)
    ctx.fillStyle = '#9fd4ff'
    ctx.fillRect(this.x - 0.5, this.y - 5, 1, 2)
  }

  function Bomb (x, y, vx, vy) {
    this.x = x
    this.y = y
    this.vx = vx
    this.vy = vy
    this.alive = true
    this.t = 0
  }

  Bomb.prototype.update = function (dt) {
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.t += dt
    if (this.y > G.H + 8 || this.x < -8 || this.x > G.W + 8) this.alive = false
  }

  Bomb.prototype.draw = function (ctx) {
    ctx.save()
    ctx.translate(this.x, this.y)
    ctx.rotate(this.t * 0.3)
    ctx.fillStyle = ((this.t / 5) | 0) % 2 ? '#4dd2ff' : '#ffffff'
    ctx.fillRect(-1, -3, 2, 6)
    ctx.fillRect(-3, -1, 6, 2)
    ctx.restore()
  }

  /* --- Explosions -------------------------------------------------------- */

  function Explosion (x, y, big) {
    this.x = x
    this.y = y
    this.big = !!big
    this.t = 0
    this.life = big ? 56 : 30
    this.alive = true
    this.bits = []
    const n = big ? 10 : 7
    for (let i = 0; i < n; i++) {
      const a = (i / n) * G.TAU + Math.random() * 0.4
      const sp = G.rand(0.35, 1.1) * (big ? 1.5 : 1)
      this.bits.push({ a: a, sp: sp, r: G.rand(1, big ? 3 : 2) })
    }
  }

  Explosion.prototype.update = function (dt) {
    this.t += dt
    if (this.t >= this.life) this.alive = false
  }

  Explosion.prototype.draw = function (ctx) {
    const k = this.t / this.life
    // A brief shock ring, gone well before the debris is.
    const ring = (this.big ? 17 : 10) * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5)
    if (k < 0.5) {
      ctx.globalAlpha = Math.max(0, 0.75 - k * 1.5)
      ctx.strokeStyle = this.big ? '#ffd83d' : '#ffffff'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(this.x, this.y, Math.max(0.5, ring), 0, G.TAU)
      ctx.stroke()
    }

    ctx.globalAlpha = Math.max(0, 1 - k * k)
    for (const b of this.bits) {
      const d = b.sp * this.t
      const px = this.x + Math.cos(b.a) * d
      const py = this.y + Math.sin(b.a) * d
      ctx.fillStyle = k < 0.35 ? '#ffffff' : k < 0.7 ? '#ffd83d' : '#ff6b2b'
      const r = Math.max(0.6, b.r * (1 - k))
      ctx.fillRect(px - r, py - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 1
  }

  /* --- Enemy ------------------------------------------------------------- */

  const KINDS = {
    bee: { sprite: 'bee', hp: 1, formationScore: 50, diveScore: 100, hitbox: 11 },
    butterfly: { sprite: 'butterfly', hp: 1, formationScore: 80, diveScore: 160, hitbox: 12 },
    boss: { sprite: 'boss', hp: 2, formationScore: 150, diveScore: 400, hitbox: 14 }
  }

  /* The beam has to physically reach the player's row, so its length and the
     height the boss settles at are tied together: BEAM_TOP + BEAM_LENGTH must
     comfortably clear PLAYER_Y. */
  const BEAM_TOP = 148
  const BEAM_LENGTH = 122
  const BEAM_HALF_WIDTH = 30

  function Enemy (kind, slot, path, delay) {
    const def = KINDS[kind]
    this.kind = kind
    this.def = def
    this.slot = slot
    this.hp = def.hp
    this.alive = true

    this.path = path
    this.pathD = -(delay || 0)
    this.speed = 2.5

    const p = path.at(0)
    this.x = p.x
    this.y = p.y
    this.a = p.a

    this.state = 'enter'
    this.timer = 0
    this.hasCaptive = false
    this.beamPhase = ''
    this.beamT = 0
    this.diveSide = 1
    this.flash = 0
    this.escaped = false
  }

  Enemy.prototype.sprite = function () {
    if (this.kind === 'boss' && this.hp < this.def.hp) return S.bossHurt
    return S[this.def.sprite]
  }

  Enemy.prototype.inFormation = function () {
    return this.state === 'formation'
  }

  Enemy.prototype.isAttacking = function () {
    return this.state === 'dive' || this.state === 'beam' || this.state === 'return'
  }

  Enemy.prototype.scoreValue = function () {
    return this.inFormation() ? this.def.formationScore : this.def.diveScore
  }

  /** Begin an attack run out of the formation. */
  Enemy.prototype.startDive = function (game, capture) {
    this.diveSide = this.x < G.W / 2 ? 1 : -1
    this.timer = 0
    this.pathD = 0
    if (capture && this.kind === 'boss' && !this.hasCaptive) {
      this.state = 'beam'
      this.beamPhase = 'approach'
      this.beamT = 0
      this.path = P.diveCapture(this.x, this.y, game.player.x)
    } else {
      this.state = 'dive'
      const maker = this.kind === 'boss' ? P.diveBoss : this.kind === 'butterfly' ? P.diveButterfly : P.diveBee
      this.path = maker(this.x, this.y, this.diveSide)
    }
    this.speed = 1.9 + game.difficulty * 0.35
  }

  /** Send the enemy back around to the top of the screen. */
  Enemy.prototype.recycle = function () {
    this.x = G.rand(30, G.W - 30)
    this.y = -18
    this.a = HALF_PI
    this.state = 'toslot'
  }

  Enemy.prototype.update = function (dt, game) {
    if (this.flash > 0) this.flash -= dt
    this.timer += dt

    switch (this.state) {
      case 'enter':
      case 'flyby': {
        this.pathD += this.speed * dt
        if (this.pathD < 0) return // still waiting for its staggered start
        const p = this.path.at(this.pathD)
        this.x = p.x
        this.y = p.y
        this.a = p.a
        const offscreen = this.x < -40 || this.x > G.W + 40 || this.y < -40 || this.y > G.H + 40
        if (this.pathD >= this.path.length || (this.state === 'flyby' && this.pathD > 40 && offscreen)) {
          if (this.state === 'flyby') {
            this.alive = false
            this.escaped = true
          } else {
            this.state = 'toslot'
          }
        } else if (this.state === 'enter' && game.canEnemiesShoot() && G.chance(0.0005 * game.tuning.bombScale * dt)) {
          game.enemyFire(this)
        }
        break
      }

      case 'toslot': {
        const t = game.formationPos(this.slot)
        const d = G.dist(this.x, this.y, t.x, t.y)
        const want = Math.atan2(t.y - this.y, t.x - this.x)
        this.a = G.turnTowards(this.a, want, 0.13 * dt)
        const sp = Math.min(this.speed, 1.4 + d * 0.05)
        this.x += Math.cos(this.a) * sp * dt
        this.y += Math.sin(this.a) * sp * dt
        // Close in on the slot directly once nearby, so we always converge.
        if (d < 26) {
          this.x = G.lerp(this.x, t.x, 0.14 * dt)
          this.y = G.lerp(this.y, t.y, 0.14 * dt)
          this.a = G.turnTowards(this.a, HALF_PI, 0.16 * dt)
        }
        if (d < 3.5) {
          this.state = 'formation'
          this.a = HALF_PI
          game.onEnemyReachedFormation(this)
        }
        break
      }

      case 'formation': {
        const t = game.formationPos(this.slot)
        this.x = t.x
        this.y = t.y
        this.a = HALF_PI
        break
      }

      case 'dive': {
        this.pathD += this.speed * dt
        const p = this.path.at(this.pathD)
        this.x = p.x
        this.y = p.y
        this.a = p.a
        if (game.canEnemiesShoot() && this.y < game.player.y - 24 && G.chance(0.0075 * game.tuning.bombScale * dt)) {
          game.enemyFire(this)
        }
        if (this.y > G.H + 18 || this.pathD >= this.path.length) this.recycle()
        break
      }

      case 'beam':
        this.updateBeam(dt, game)
        break
    }
  }

  /** Boss Galaga tractor-beam sequence. */
  Enemy.prototype.updateBeam = function (dt, game) {
    this.beamT += dt

    switch (this.beamPhase) {
      case 'approach': {
        this.pathD += this.speed * dt
        const p = this.path.at(this.pathD)
        this.x = p.x
        this.y = p.y
        this.a = p.a
        if (this.pathD >= this.path.length) {
          // Settle above the playfield and flip to face the player.
          this.beamPhase = 'settle'
          this.beamT = 0
        }
        break
      }

      case 'settle': {
        const ty = BEAM_TOP
        this.y = G.lerp(this.y, ty, 0.06 * dt)
        this.a = G.turnTowards(this.a, HALF_PI, 0.08 * dt)
        if (Math.abs(this.y - ty) < 2 && Math.abs(G.angleDelta(this.a, HALF_PI)) < 0.05) {
          this.beamPhase = 'open'
          this.beamT = 0
          G.Sfx.beam()
        }
        break
      }

      case 'open':
        if (this.beamT > 40) {
          this.beamPhase = 'hold'
          this.beamT = 0
        }
        break

      case 'hold': {
        const pl = game.player
        if (pl.alive && !pl.captured && this.beamCovers(pl.x, pl.y)) {
          game.capturePlayer(this)
          this.beamPhase = 'pull'
          this.beamT = 0
        } else if (this.beamT > 150) {
          this.beamPhase = 'close'
          this.beamT = 0
        }
        break
      }

      case 'pull':
        if (this.beamT > 110) {
          this.beamPhase = 'close'
          this.beamT = 0
        }
        break

      case 'close':
        if (this.beamT > 40) {
          this.beamPhase = ''
          this.state = 'toslot'
          this.speed = 2.2
        }
        break
    }
  }

  /** Current beam length, 0 while closed. */
  Enemy.prototype.beamExtent = function () {
    switch (this.beamPhase) {
      case 'open': return BEAM_LENGTH * (this.beamT / 40)
      case 'hold':
      case 'pull': return BEAM_LENGTH
      case 'close': return BEAM_LENGTH * (1 - this.beamT / 40)
      default: return 0
    }
  }

  Enemy.prototype.beamCovers = function (px, py) {
    const len = this.beamExtent()
    if (len < BEAM_LENGTH * 0.9) return false
    const top = this.y + 8
    if (py < top || py > top + len) return false
    const k = (py - top) / len
    return Math.abs(px - this.x) < BEAM_HALF_WIDTH * k
  }

  Enemy.prototype.drawBeam = function (ctx) {
    const len = this.beamExtent()
    if (len <= 0) return
    const top = this.y + 7
    const half = BEAM_HALF_WIDTH * (len / BEAM_LENGTH)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // Concentric wedges that scroll downward for a shimmering look.
    const bands = 7
    for (let i = 0; i < bands; i++) {
      const phase = ((this.beamT * 0.02 + i / bands) % 1)
      const y0 = top + len * phase
      const h = len / bands * 0.55
      if (y0 + h > top + len) continue
      const k0 = (y0 - top) / len
      const k1 = (y0 + h - top) / len
      ctx.fillStyle = i % 2 ? 'rgba(130, 200, 255, 0.42)' : 'rgba(210, 130, 255, 0.34)'
      ctx.beginPath()
      ctx.moveTo(this.x - half * k0, y0)
      ctx.lineTo(this.x + half * k0, y0)
      ctx.lineTo(this.x + half * k1, y0 + h)
      ctx.lineTo(this.x - half * k1, y0 + h)
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(this.x - 2, top)
    ctx.lineTo(this.x - half, top + len)
    ctx.moveTo(this.x + 2, top)
    ctx.lineTo(this.x + half, top + len)
    ctx.stroke()
    ctx.restore()
  }

  Enemy.prototype.draw = function (ctx) {
    if (this.pathD < 0 && (this.state === 'enter' || this.state === 'flyby')) return
    const spr = this.flash > 0 ? S.bossHurt : this.sprite()
    S.draw(ctx, spr, this.x, this.y, this.a)
    if (this.hasCaptive) {
      // The stolen fighter is towed just below its captor.
      const ox = Math.cos(this.a + HALF_PI) * 0
      const oy = 15
      S.draw(ctx, S.captive, this.x + ox, this.y + oy, this.a + Math.PI)
    }
  }

  /* --- Rescued fighter --------------------------------------------------- */

  /** Drifts down after its captor is destroyed; fly into it to go dual. */
  function FreeFighter (x, y) {
    this.x = x
    this.y = y
    this.a = -HALF_PI
    this.vy = 0.55
    this.alive = true
  }

  FreeFighter.prototype.update = function (dt) {
    this.y += this.vy * dt
    if (this.y > G.H + 10) this.alive = false
  }

  FreeFighter.prototype.draw = function (ctx) {
    S.draw(ctx, S.ship, this.x, this.y, this.a)
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.y * 0.2)
    ctx.strokeStyle = '#ffd83d'
    ctx.strokeRect(this.x - 9, this.y - 9, 18, 18)
    ctx.globalAlpha = 1
  }

  G.Player = Player
  G.Bullet = Bullet
  G.Bomb = Bomb
  G.Explosion = Explosion
  G.Enemy = Enemy
  G.FreeFighter = FreeFighter
  G.KINDS = KINDS
  G.PLAYER_HITBOX = PLAYER_HITBOX
})(window)
