/* The game: state machine, formation bookkeeping, attack scheduling,
   collisions and rendering. */
(function (global) {
  'use strict'

  const G = global.G
  const S = G.Sprites
  const HUD = G.HUD
  const Stages = G.Stages
  const Sfx = G.Sfx

  const FORM_TOP = 44
  const COL_SPACING = 16
  const ROW_SPACING = 15
  const FIRE_COOLDOWN = 7

  const HIGH_SCORE_KEY = 'galaga.highscore'

  function loadHighScore () {
    try {
      return parseInt(global.localStorage.getItem(HIGH_SCORE_KEY), 10) || 20000
    } catch (e) {
      return 20000
    }
  }

  function saveHighScore (v) {
    try {
      global.localStorage.setItem(HIGH_SCORE_KEY, String(v))
    } catch (e) { /* storage may be unavailable; scores just don't persist */ }
  }

  function Game (ctx) {
    this.ctx = ctx
    this.stars = new G.Starfield(90)
    this.player = new G.Player()

    this.enemies = []
    this.bullets = []
    this.bombs = []
    this.explosions = []
    this.freeFighters = []
    this.pending = []

    this.state = 'attract'
    this.stateT = 0
    this.clock = 0
    this.paused = false

    this.score = 0
    this.highScore = loadHighScore()
    this.lives = 2
    this.stage = 1
    this.stageShown = 0
    this.nextExtraLife = 20000

    this.formationT = 0
    this.diveTimer = 0
    this.fireCooldown = 0
    this.capturedBy = null
    this.challenge = null

    this.banner = null
    this.bannerT = 0
    this.tuning = Stages.tuning(1)
    this.difficulty = 0
  }

  Game.prototype.setState = function (s) {
    this.state = s
    this.stateT = 0
  }

  Game.prototype.setBanner = function (lines, frames) {
    this.banner = Array.isArray(lines) ? lines : [lines]
    this.bannerT = frames
  }

  /* --- Lifecycle --------------------------------------------------------- */

  Game.prototype.newGame = function () {
    this.enemies.length = 0
    this.bullets.length = 0
    this.bombs.length = 0
    this.explosions.length = 0
    this.freeFighters.length = 0
    this.pending.length = 0

    this.score = 0
    this.lives = 2
    this.stage = 0
    this.stageShown = 0
    this.nextExtraLife = 20000
    this.capturedBy = null
    this.player = new G.Player()
    this.player.invuln = 60

    Sfx.coin()
    this.setBanner(['PLAYER 1'], 90)
    this.setState('ready')
  }

  Game.prototype.beginStage = function () {
    this.stage += 1
    this.stageShown = this.stage
    this.tuning = Stages.tuning(this.stage)
    this.difficulty = this.tuning.difficulty
    this.stars.speed = 1 + this.difficulty * 0.6

    this.enemies.length = 0
    this.bullets.length = 0
    this.bombs.length = 0
    this.pending.length = 0
    this.freeFighters.length = 0
    this.capturedBy = null
    this.diveTimer = 150

    if (Stages.isChallenging(this.stage)) {
      this.challenge = { waves: Stages.challengeWaves(this.stage), i: 0, timer: 60, hits: 0, total: 40 }
      this.setBanner(['CHALLENGING STAGE'], 130)
      Sfx.challengeStart()
      this.setState('challenging')
    } else {
      this.challenge = null
      this.spawnFormation()
      this.setBanner(['STAGE ' + this.stage], 120)
      Sfx.stageStart()
      this.setState('playing')
    }
  }

  /** Create all forty enemies with their staggered entrance routes. */
  Game.prototype.spawnFormation = function () {
    const entrances = Stages.entrances(this.stage)
    entrances.forEach((group, gi) => {
      group.slots.forEach((slotIndex, si) => {
        const slot = Stages.LAYOUT[slotIndex]
        // Delays are in path arc-length, converted to frames by the travel speed.
        const delay = gi * 150 + si * 24
        const e = new G.Enemy(slot.kind, slot, group.path, delay)
        e.speed = 2.6 + this.difficulty * 0.5
        this.enemies.push(e)
      })
    })
  }

  Game.prototype.gameOver = function () {
    this.player.alive = false
    if (this.score > this.highScore) {
      this.highScore = this.score
      saveHighScore(this.highScore)
    }
    this.setBanner(['GAME OVER'], 210)
    Sfx.gameOver()
    this.setState('gameover')
  }

  /* --- Formation --------------------------------------------------------- */

  /** World position of a formation slot, including the breathing motion. */
  Game.prototype.formationPos = function (slot) {
    if (!slot) return { x: G.W / 2, y: FORM_TOP }
    const spread = 1 + 0.09 * Math.sin(this.formationT * 0.019)
    const sway = 11 * Math.sin(this.formationT * 0.0115)
    return {
      x: G.W / 2 + (slot.col - 4.5) * COL_SPACING * spread + sway,
      y: FORM_TOP + slot.row * ROW_SPACING
    }
  }

  Game.prototype.onEnemyReachedFormation = function () {
    // Hook kept for future flourishes (formation-arrival sounds, etc.).
  }

  Game.prototype.canEnemiesShoot = function () {
    return (this.state === 'playing') && this.player.alive && !this.player.captured
  }

  /* --- Scoring ----------------------------------------------------------- */

  Game.prototype.addScore = function (n) {
    this.score += n
    if (this.score >= this.nextExtraLife) {
      this.lives += 1
      this.nextExtraLife += 70000
      Sfx.extraLife()
    }
    if (this.score > this.highScore) this.highScore = this.score
  }

  /* --- Combat ------------------------------------------------------------ */

  Game.prototype.enemyFire = function (e) {
    if (this.bombs.length > 14) return
    const p = this.player
    const sp = 1.35 + this.difficulty * 0.65
    let vx = 0
    let vy = sp
    if (p.alive && !p.captured) {
      const dx = p.x - e.x
      const dy = Math.max(24, p.y - e.y)
      // Aimed, but never perfectly: standing still should be risky, not fatal.
      const spread = G.lerp(0.30, 0.14, this.difficulty)
      const ang = Math.atan2(dy, dx) + G.rand(-spread, spread)
      vx = Math.cos(ang) * sp
      vy = Math.sin(ang) * sp
    }
    this.bombs.push(new G.Bomb(e.x, e.y + 6, vx, vy))
  }

  Game.prototype.capturePlayer = function (boss) {
    this.player.captured = true
    this.player.captureTimer = 0
    this.capturedBy = boss
    Sfx.captured()
  }

  Game.prototype.killEnemy = function (e) {
    e.alive = false
    this.explosions.push(new G.Explosion(e.x, e.y, e.kind === 'boss'))
    Sfx.enemyKill()

    if (this.challenge) {
      this.challenge.hits += 1
      this.addScore(e.def.diveScore)
    } else {
      this.addScore(e.scoreValue())
    }

    if (e.hasCaptive) {
      e.hasCaptive = false
      this.freeFighters.push(new G.FreeFighter(e.x, e.y + 12))
      Sfx.rescue()
    }
    if (this.capturedBy === e) this.capturedBy = null
  }

  Game.prototype.playerHit = function () {
    const p = this.player
    if (!p.alive || p.invuln > 0 || p.captured) return
    p.alive = false
    p.dual = false
    this.explosions.push(new G.Explosion(p.x, p.y, true))
    Sfx.playerDeath()
    this.setState('dying')
  }

  Game.prototype.respawnOrEnd = function () {
    if (this.lives <= 0) {
      this.gameOver()
      return
    }
    this.lives -= 1
    this.player.reset(false)
    this.setState(this.challenge ? 'challenging' : 'playing')
  }

  /* --- Update ------------------------------------------------------------ */

  Game.prototype.update = function (dt, input) {
    this.clock += dt
    this.stateT += dt
    this.formationT += dt
    if (this.bannerT > 0) this.bannerT -= dt
    if (this.fireCooldown > 0) this.fireCooldown -= dt

    this.stars.update(dt)
    for (const x of this.explosions) x.update(dt)
    this.explosions = this.explosions.filter(x => x.alive)

    switch (this.state) {
      case 'attract':
        if (input.startPressed || input.firePressed) this.newGame()
        break

      case 'ready':
        if (this.stateT > 90) this.beginStage()
        break

      case 'playing':
        this.updatePlay(dt, input)
        break

      case 'challenging':
        this.updateChallenge(dt, input)
        break

      case 'dying':
        this.updateWorld(dt, false)
        if (this.stateT > 130) this.respawnOrEnd()
        break

      case 'stageClear':
        this.updateWorld(dt, false)
        if (this.stateT > 110) this.beginStage()
        break

      case 'gameover':
        this.updateWorld(dt, false)
        if (this.stateT > 210) {
          // Clear the field so the title screen isn't cluttered with leftovers.
          this.enemies.length = 0
          this.bullets.length = 0
          this.bombs.length = 0
          this.freeFighters.length = 0
          this.pending.length = 0
          this.challenge = null
          this.stageShown = 0
          this.setState('attract')
        }
        break
    }
  }

  /** Advance every non-player entity. Shared by the active and idle states. */
  Game.prototype.updateWorld = function (dt) {
    for (const e of this.enemies) e.update(dt, this)
    this.enemies = this.enemies.filter(e => e.alive)

    for (const b of this.bullets) b.update(dt)
    this.bullets = this.bullets.filter(b => b.alive)

    for (const b of this.bombs) b.update(dt)
    this.bombs = this.bombs.filter(b => b.alive)

    for (const f of this.freeFighters) f.update(dt)
    this.freeFighters = this.freeFighters.filter(f => f.alive)
  }

  Game.prototype.updatePlay = function (dt, input) {
    const p = this.player

    p.update(dt, input)
    this.handleFire(dt, input)
    this.updateCapture(dt)
    this.updateWorld(dt)
    this.scheduleAttacks(dt)
    this.collide()

    if (this.enemies.length === 0 && this.pending.length === 0 && this.explosions.length === 0) {
      this.setState('stageClear')
    }
  }

  Game.prototype.updateChallenge = function (dt, input) {
    const c = this.challenge
    this.player.update(dt, input)
    this.handleFire(dt, input)

    c.timer -= dt
    if (c.timer <= 0 && c.i < c.waves.length) {
      this.spawnChallengeWave(c.waves[c.i])
      c.i += 1
      c.timer = 132
    }

    this.updateWorld(dt)
    this.collide()

    if (c.i >= c.waves.length && this.enemies.length === 0 && this.explosions.length === 0) {
      const perfect = c.hits >= c.total
      const bonus = perfect ? 10000 : c.hits * 100
      this.addScore(bonus)
      if (perfect) Sfx.perfect()
      this.setBanner(
        perfect
          ? ['PERFECT!', 'SPECIAL BONUS 10000']
          : ['NUMBER OF HITS ' + c.hits, 'BONUS ' + bonus],
        170
      )
      this.challenge = null
      this.setState('stageClear')
      this.stateT = -60 // linger a little so the result stays readable
    }
  }

  Game.prototype.spawnChallengeWave = function (wave) {
    for (let j = 0; j < wave.count; j++) {
      const e = new G.Enemy(wave.kind, null, wave.path, j * 26)
      e.state = 'flyby'
      e.speed = 2.4 + this.difficulty * 0.4
      this.enemies.push(e)
    }
  }

  Game.prototype.handleFire = function (dt, input) {
    const p = this.player
    if (!p.alive || p.captured) return
    const limit = p.dual ? 4 : 2
    if ((input.fire || input.firePressed) && this.fireCooldown <= 0 && this.bullets.length < limit) {
      for (const mx of p.muzzles()) this.bullets.push(new G.Bullet(mx, p.y - 8))
      this.fireCooldown = FIRE_COOLDOWN
      Sfx.shoot()
    }
  }

  /** Drag the player ship up into its captor, then hand over a life. */
  Game.prototype.updateCapture = function (dt) {
    const p = this.player
    if (!p.captured) return
    const boss = this.capturedBy
    if (!boss || !boss.alive) {
      // Captor died mid-beam: the ship is dropped back into play.
      p.captured = false
      p.y = 250
      p.a = -Math.PI / 2
      p.invuln = 60
      return
    }
    const tx = boss.x
    const ty = boss.y + 15
    p.x = G.lerp(p.x, tx, 0.045 * dt)
    p.y = G.lerp(p.y, ty, 0.045 * dt)
    if (p.captureTimer > 100) {
      boss.hasCaptive = true
      p.alive = false
      p.captured = false
      this.capturedBy = null
      this.setBanner(['FIGHTER CAPTURED'], 90)
      this.setState('dying')
    }
  }

  /** Decide when the next sortie leaves the formation. */
  Game.prototype.scheduleAttacks = function (dt) {
    // Release queued escorts.
    for (const s of this.pending) s.delay -= dt
    const ready = this.pending.filter(s => s.delay <= 0)
    for (const s of ready) {
      if (s.enemy.alive && s.enemy.inFormation()) s.enemy.startDive(this, s.capture)
      s.enemy.pending = false
    }
    this.pending = this.pending.filter(s => s.delay > 0 && s.enemy.alive)

    if (!this.player.alive || this.player.captured) return

    // Hold fire until the formation has actually assembled.
    const stillArriving = this.enemies.some(e => e.state === 'enter' || e.state === 'toslot')
    this.diveTimer -= dt
    if (this.diveTimer > 0) return
    this.diveTimer = this.tuning.diveInterval
    if (stillArriving && this.stateT < 240) return

    const attacking = this.enemies.filter(e => e.isAttacking()).length
    if (attacking >= this.tuning.maxDivers) return

    this.launchSortie()
  }

  Game.prototype.launchSortie = function () {
    const inForm = this.enemies.filter(e => e.inFormation() && !e.pending)
    if (inForm.length === 0) return

    const beamActive = this.enemies.some(e => e.state === 'beam')
    const bosses = inForm.filter(e => e.kind === 'boss' && !e.hasCaptive)

    if (
      bosses.length && !beamActive && !this.player.dual && !this.player.captured &&
      G.chance(this.tuning.captureChance)
    ) {
      const boss = G.pick(bosses)
      boss.pending = true
      this.pending.push({ enemy: boss, delay: 0, capture: true })
      Sfx.dive()
      return
    }

    const leader = G.pick(inForm)
    leader.pending = true
    this.pending.push({ enemy: leader, delay: 0, capture: false })
    Sfx.dive()

    const escorts = leader.kind === 'boss' ? 2 : G.randInt(0, 2)
    if (escorts > 0) {
      const others = inForm
        .filter(e => e !== leader && !e.pending)
        .sort((a, b) => G.dist(a.x, a.y, leader.x, leader.y) - G.dist(b.x, b.y, leader.x, leader.y))
      for (let i = 0; i < escorts && i < others.length; i++) {
        others[i].pending = true
        this.pending.push({ enemy: others[i], delay: 13 + i * 12, capture: false })
      }
    }
  }

  /* --- Collisions -------------------------------------------------------- */

  Game.prototype.collide = function () {
    const p = this.player

    // Player shots against enemies.
    for (const b of this.bullets) {
      if (!b.alive) continue
      for (const e of this.enemies) {
        if (!e.alive || e.pathD < 0) continue
        if (!G.hit(b.x, b.y, 3, e.x, e.y, e.def.hitbox)) continue
        b.alive = false
        e.hp -= 1
        if (e.hp <= 0) {
          this.killEnemy(e)
        } else {
          e.flash = 6
          Sfx.bossHit()
        }
        break
      }
    }

    // Player shots against a drifting rescued fighter (yes, you can lose it).
    for (const b of this.bullets) {
      if (!b.alive) continue
      for (const f of this.freeFighters) {
        if (!f.alive) continue
        if (!G.hit(b.x, b.y, 3, f.x, f.y, 12)) continue
        b.alive = false
        f.alive = false
        this.explosions.push(new G.Explosion(f.x, f.y, false))
        Sfx.enemyKill()
        break
      }
    }

    if (!p.alive || p.captured) return

    const hw = p.halfWidth()

    // Reclaiming a rescued fighter works even during respawn invulnerability.
    for (const f of this.freeFighters) {
      if (!f.alive) continue
      if (G.hit(f.x, f.y, 14, p.x, p.y, hw * 2)) {
        f.alive = false
        p.dual = true
        this.addScore(1000)
        Sfx.rescue()
        this.setBanner(['DUAL FIGHTER!'], 80)
      }
    }

    if (p.invuln > 0) return

    const centres = p.dual ? [p.x - 8, p.x + 8] : [p.x]

    for (const b of this.bombs) {
      if (!b.alive) continue
      for (const cx of centres) {
        if (G.hit(b.x, b.y, 4, cx, p.y, G.PLAYER_HITBOX)) {
          b.alive = false
          this.playerHit()
          return
        }
      }
    }

    // Challenging stages are a free ride: enemies fly through harmlessly.
    if (!this.challenge) {
      for (const e of this.enemies) {
        if (!e.alive || e.pathD < 0 || e.state === 'formation') continue
        for (const cx of centres) {
          if (G.hit(e.x, e.y, e.def.hitbox - 2, cx, p.y, G.PLAYER_HITBOX)) {
            this.killEnemy(e)
            this.playerHit()
            return
          }
        }
      }
    }

  }

  /* --- Render ------------------------------------------------------------ */

  Game.prototype.bigText = function (str, y, color, scale) {
    const ctx = this.ctx
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.scale(scale, scale)
    HUD.text(ctx, str, (G.W / 2) / scale, y / scale, color, 'center')
    ctx.restore()
  }

  Game.prototype.draw = function () {
    const ctx = this.ctx
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, G.W, G.H)

    this.stars.draw(ctx)

    // Tractor beams render underneath their emitter.
    for (const e of this.enemies) {
      if (e.state === 'beam') e.drawBeam(ctx)
    }

    for (const e of this.enemies) e.draw(ctx)
    for (const f of this.freeFighters) f.draw(ctx)
    for (const b of this.bullets) b.draw(ctx)
    for (const b of this.bombs) b.draw(ctx)

    if (this.state !== 'attract') this.player.draw(ctx)
    for (const x of this.explosions) x.draw(ctx)

    HUD.draw(ctx, this)

    if (this.state === 'attract') this.drawAttract()
    if (this.bannerT > 0 && this.banner) this.drawBanner()
    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, G.W, G.H)
      this.bigText('PAUSED', 136, '#ffffff', 2)
    }
  }

  Game.prototype.drawBanner = function () {
    const color = this.state === 'gameover' ? '#ff3b30' : '#3dd6ff'
    const lines = this.banner
    const y0 = 132 - (lines.length - 1) * 7
    lines.forEach((line, i) => {
      HUD.text(this.ctx, line, G.W / 2, y0 + i * 14, color, 'center')
    })
  }

  const SCORE_TABLE = [
    ['bee', '50', '100'],
    ['butterfly', '80', '160'],
    ['boss', '150', '400']
  ]

  Game.prototype.drawAttract = function () {
    const ctx = this.ctx
    this.bigText('GALAGA', 54, '#ff3b30', 3)

    // Score chart, arcade style.
    let y = 130
    for (const [kind, formation, diving] of SCORE_TABLE) {
      S.draw(ctx, S[kind], 62, y + 3, Math.PI / 2)
      HUD.text(ctx, formation + ' PTS', 78, y, '#ffffff')
      HUD.text(ctx, diving + ' PTS', 78, y + 9, '#ffd83d')
      y += 26
    }
    HUD.text(ctx, 'FORMATION / DIVING', 112, 116, '#7a7a9c', 'center')

    if (((this.clock / 30) | 0) % 2 === 0) {
      HUD.text(ctx, 'PRESS ENTER TO START', 112, 216, '#3dd6ff', 'center')
    }
    HUD.text(ctx, 'ARROWS MOVE   SPACE FIRE', 112, 234, '#4a4a63', 'center')
  }

  G.Game = Game
})(window)
