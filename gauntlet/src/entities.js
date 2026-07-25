/* Heroes, monsters, generators, shots and pickups.

   Movement is resolved one axis at a time against the tile grid, which is what
   lets everything slide along a wall instead of sticking to it — essential when
   monsters are herding you down a corridor. */
(function (global) {
  'use strict'

  const G = global.G
  const TILE = G.TILE

  /* --- Shared movement ----------------------------------------------------- */

  /** Move a circle-ish body by (dx, dy), stopping against solid tiles.
      Returns true if either axis was blocked. */
  function moveBody (body, dungeon, dx, dy) {
    let blocked = false
    const r = body.r

    if (dx) {
      const nx = body.x + dx
      const edge = nx + Math.sign(dx) * r
      if (dungeon.solidAt(edge, body.y - r + 1) || dungeon.solidAt(edge, body.y + r - 1)) blocked = true
      else body.x = nx
    }

    if (dy) {
      const ny = body.y + dy
      const edge = ny + Math.sign(dy) * r
      if (dungeon.solidAt(body.x - r + 1, edge) || dungeon.solidAt(body.x + r - 1, edge)) blocked = true
      else body.y = ny
    }

    return blocked
  }

  /* --- Player -------------------------------------------------------------- */

  /** Per-character stats. The arcade traded speed against armour and magic;
      these keep that shape without making any of the four unplayable. */
  const CLASSES = {
    warrior: { speed: 1.15, shot: 5, fireRate: 22, shotSpeed: 3.2, armour: 0.70, magic: 1.0 },
    valkyrie: { speed: 1.20, shot: 4, fireRate: 20, shotSpeed: 3.3, armour: 0.55, magic: 1.1 },
    wizard: { speed: 1.10, shot: 3, fireRate: 18, shotSpeed: 3.6, armour: 1.00, magic: 2.0 },
    elf: { speed: 1.55, shot: 3, fireRate: 15, shotSpeed: 4.0, armour: 1.00, magic: 1.0 }
  }

  function Player (kind) {
    const c = CLASSES[kind]
    this.kind = kind
    this.stats = c
    this.x = 0
    this.y = 0
    this.r = 5
    this.dir = 2 // facing down
    this.health = 1000
    this.keys = 0
    this.potions = 1
    this.score = 0
    this.fireCooldown = 0
    this.touchCD = 0
    this.hurtFlash = 0
    this.dead = false
    this.bob = 0
    this.moving = false
  }

  Player.prototype.update = function (dt, game, move) {
    if (this.dead) return

    const sp = this.stats.speed * dt
    this.moving = move.x !== 0 || move.y !== 0

    if (this.moving) {
      // Normalise so diagonals are not faster than the cardinals.
      const len = Math.hypot(move.x, move.y) || 1
      moveBody(this, game.dungeon, (move.x / len) * sp, (move.y / len) * sp)
      this.dir = G.octantOf(move.x, move.y)
      this.bob += dt * 0.25
    }

    if (this.fireCooldown > 0) this.fireCooldown -= dt
    if (this.touchCD > 0) this.touchCD -= dt
    if (this.hurtFlash > 0) this.hurtFlash -= dt

    // Health bleeds away constantly; food is the only thing that buys time.
    this.health -= 0.42 * dt
    if (this.health <= 0) {
      this.health = 0
      this.dead = true
    }
  }

  Player.prototype.damage = function (amount) {
    this.health -= amount * this.stats.armour
    this.hurtFlash = 8
    if (this.health <= 0) {
      this.health = 0
      this.dead = true
    }
  }

  Player.prototype.canFire = function () {
    return !this.dead && this.fireCooldown <= 0
  }

  Player.prototype.draw = function (ctx, camX, camY) {
    const S = G.Sprites
    const set = S.hero[this.kind]
    // Facing up shows the character's back; every other heading uses the front
    // sprite, mirrored when heading left. Eight-way art for four heroes was
    // never worth the pixels.
    const up = this.dir === 6 || this.dir === 5 || this.dir === 7
    const img = up ? set.back : set.front
    const flip = this.dir === 4 || this.dir === 3 || this.dir === 5

    const bobY = this.moving ? Math.round(Math.sin(this.bob) * 0.9) : 0
    const x = Math.round(this.x - camX)
    const y = Math.round(this.y - camY) + bobY

    if (this.hurtFlash > 0 && ((this.hurtFlash | 0) & 1)) ctx.globalAlpha = 0.45
    S.draw(ctx, img, x, y, flip)
    ctx.globalAlpha = 1
  }

  /* --- Shots --------------------------------------------------------------- */

  function Shot (x, y, dir, speed, power, fromPlayer, overWalls) {
    const v = G.OCTANTS[dir]
    this.x = x
    this.y = y
    this.vx = v.x * speed
    this.vy = v.y * speed
    this.dir = dir
    this.power = power
    this.fromPlayer = fromPlayer
    this.overWalls = !!overWalls
    this.r = 3
    this.alive = true
    this.life = 200
  }

  Shot.prototype.update = function (dt, game) {
    this.life -= dt
    if (this.life <= 0) {
      this.alive = false
      return
    }

    this.x += this.vx * dt
    this.y += this.vy * dt

    if (this.overWalls) return // lobbed shots arc over the scenery

    const tx = Math.floor(this.x / TILE)
    const ty = Math.floor(this.y / TILE)
    const tile = game.dungeon.at(tx, ty)

    if (tile === G.BREAKABLE && this.fromPlayer) {
      game.dungeon.set(tx, ty, G.FLOOR)
      game.burst(this.x, this.y, '#9a9ab0', 8)
      G.Sfx.wallBreak()
      this.alive = false
    } else if (tile >= G.WALL) {
      game.burst(this.x, this.y, this.fromPlayer ? '#ffd83d' : '#ff6a4a', 4)
      this.alive = false
    }
  }

  Shot.prototype.draw = function (ctx, camX, camY) {
    const x = Math.round(this.x - camX)
    const y = Math.round(this.y - camY)
    ctx.fillStyle = this.fromPlayer ? '#ffe98a' : '#ff7a5a'
    ctx.fillRect(x - 2, y - 2, 4, 4)
    ctx.fillStyle = this.fromPlayer ? '#fff8d8' : '#ffd0c0'
    ctx.fillRect(x - 1, y - 1, 2, 2)
  }

  /* --- Monsters ------------------------------------------------------------ */

  /** Behaviour table. `touch` is contact damage; `fragile` monsters die on
      contact with the hero the way the arcade's ghosts do. */
  const MONSTER_KINDS = {
    ghost: { speed: 0.62, hp: 1, touch: 12, score: 10, fragile: true },
    grunt: { speed: 0.52, hp: 2, touch: 18, score: 10 },
    demon: { speed: 0.44, hp: 3, touch: 22, score: 30, shoots: true, range: 130, cooldown: 90 },
    lobber: { speed: 0.40, hp: 3, touch: 20, score: 30, shoots: true, range: 160, cooldown: 110, lobs: true, keepAway: 70 },
    sorcerer: { speed: 0.55, hp: 3, touch: 24, score: 50, fades: true },
    death: { speed: 0.42, hp: 9999, touch: 0, score: 0, isDeath: true }
  }

  function Monster (kind, x, y, level) {
    const k = MONSTER_KINDS[kind]
    this.kind = kind
    this.k = k
    this.x = x
    this.y = y
    this.r = 5
    // Later levels make everything tougher and a shade quicker.
    this.hp = k.hp + Math.floor((level - 1) / 3)
    this.speed = k.speed + Math.min(0.25, (level - 1) * 0.02)
    this.cooldown = G.randInt(30, k.cooldown || 60)
    this.alive = true
    this.hurtFlash = 0
    this.phase = Math.random() * G.TAU
    this.jitter = 0
  }

  Monster.prototype.update = function (dt, game) {
    const p = game.player
    if (!p || p.dead) return

    let dx = p.x - this.x
    let dy = p.y - this.y
    const d = Math.hypot(dx, dy) || 1
    this.phase += dt * 0.08
    if (this.hurtFlash > 0) this.hurtFlash -= dt

    // Lobbers try to hold their distance and shoot over the walls.
    let dir = 1
    if (this.k.keepAway && d < this.k.keepAway) dir = -1

    // A little sideways drift breaks the conga line that pure greedy chasing
    // produces, and shakes monsters loose when they jam on a corner.
    const nx = (dx / d) * dir
    const ny = (dy / d) * dir
    let mx = nx
    let my = ny
    if (this.jitter > 0) {
      this.jitter -= dt
      mx = -ny
      my = nx
    }

    const blocked = moveBody(this, game.dungeon, mx * this.speed * dt, my * this.speed * dt)
    if (blocked && this.jitter <= 0) this.jitter = G.randInt(12, 30)

    if (this.k.shoots) {
      this.cooldown -= dt
      if (this.cooldown <= 0 && d < this.k.range) {
        this.cooldown = this.k.cooldown
        const sdir = G.octantOf(dx, dy)
        game.shots.push(new Shot(this.x, this.y, sdir, 1.9, 20, false, this.k.lobs))
        G.Sfx.shoot()
      }
    }
  }

  Monster.prototype.damage = function (n, game) {
    if (this.k.isDeath) return false // only magic removes Death
    this.hp -= n
    this.hurtFlash = 6
    if (this.hp <= 0) {
      this.alive = false
      return true
    }
    G.Sfx.monsterHit()
    return false
  }

  Monster.prototype.draw = function (ctx, camX, camY) {
    const img = G.Sprites.monster[this.kind]
    const x = Math.round(this.x - camX)
    const y = Math.round(this.y - camY) + Math.round(Math.sin(this.phase * 2) * 0.8)

    // Sorcerers phase in and out; they are still solid while faint.
    if (this.k.fades) ctx.globalAlpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(this.phase * 1.6))
    if (this.hurtFlash > 0 && ((this.hurtFlash | 0) & 1)) ctx.globalAlpha = 0.5
    G.Sprites.draw(ctx, img, x, y, false)
    ctx.globalAlpha = 1
  }

  /* --- Generators ---------------------------------------------------------- */

  function Generator (kind, x, y, level) {
    this.kind = kind
    this.x = x
    this.y = y
    this.r = 7
    this.hp = 3 + Math.floor(level / 2)
    this.alive = true
    this.timer = G.randInt(60, 180)
    this.hurtFlash = 0
    this.pulse = Math.random() * G.TAU
  }

  Generator.prototype.update = function (dt, game) {
    this.pulse += dt * 0.06
    if (this.hurtFlash > 0) this.hurtFlash -= dt
    this.timer -= dt
    if (this.timer > 0) return

    // Spawn rate climbs with the level, but the global monster cap keeps the
    // frame rate (and the player's chances) intact.
    this.timer = Math.max(50, 190 - game.level * 8) + G.randInt(0, 60)
    if (game.monsters.length >= game.monsterCap) return

    const spot = game.freeSpotNear(this.x, this.y)
    if (!spot) return
    game.monsters.push(new Monster(this.kind, spot.x, spot.y, game.level))
  }

  Generator.prototype.damage = function (n) {
    this.hp -= n
    this.hurtFlash = 6
    if (this.hp <= 0) {
      this.alive = false
      return true
    }
    return false
  }

  Generator.prototype.draw = function (ctx, camX, camY) {
    const img = G.Sprites.generator[this.kind]
    const x = Math.round(this.x - camX)
    const y = Math.round(this.y - camY)
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.pulse * 2)
    if (this.hurtFlash > 0 && ((this.hurtFlash | 0) & 1)) ctx.globalAlpha = 0.4
    G.Sprites.draw(ctx, img, x, y, false)
    ctx.globalAlpha = 1
  }

  /* --- Pickups ------------------------------------------------------------- */

  function Item (kind, x, y) {
    this.kind = kind
    this.x = x
    this.y = y
    this.r = 6
    this.alive = true
    this.phase = Math.random() * G.TAU
  }

  Item.prototype.update = function (dt) {
    this.phase += dt * 0.06
  }

  Item.prototype.draw = function (ctx, camX, camY) {
    const img = G.Sprites.item[this.kind]
    const x = Math.round(this.x - camX)
    const y = Math.round(this.y - camY) + Math.round(Math.sin(this.phase) * 1.2)
    G.Sprites.draw(ctx, img, x, y, false)
  }

  /* --- Particles ----------------------------------------------------------- */

  function Particle (x, y, color) {
    const a = Math.random() * G.TAU
    const s = G.rand(0.4, 1.9)
    this.x = x
    this.y = y
    this.vx = Math.cos(a) * s
    this.vy = Math.sin(a) * s
    this.life = G.randInt(12, 26)
    this.color = color
    this.alive = true
  }

  Particle.prototype.update = function (dt) {
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.vx *= 0.92
    this.vy *= 0.92
    this.life -= dt
    if (this.life <= 0) this.alive = false
  }

  Particle.prototype.draw = function (ctx, camX, camY) {
    ctx.globalAlpha = Math.min(1, this.life / 14)
    ctx.fillStyle = this.color
    ctx.fillRect(Math.round(this.x - camX) - 1, Math.round(this.y - camY) - 1, 2, 2)
    ctx.globalAlpha = 1
  }

  G.Player = Player
  G.Monster = Monster
  G.Generator = Generator
  G.Shot = Shot
  G.Item = Item
  G.Particle = Particle
  G.CLASSES = CLASSES
  G.MONSTER_KINDS = MONSTER_KINDS
  G.moveBody = moveBody
})(window)
