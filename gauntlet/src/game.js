/* The game: state machine, level population, collisions and rendering. */
(function (global) {
  'use strict'

  const G = global.G
  const TILE = G.TILE
  const Sfx = G.Sfx
  const Hud = G.Hud

  const HERO_ORDER = ['warrior', 'valkyrie', 'wizard', 'elf']

  /** Frames of grace between successive contact hits on the hero. */
  const TOUCH_COOLDOWN = 14

  /** Which monsters can appear, by level. The roster opens up gradually so the
      first couple of levels stay readable. */
  function rosterFor (level) {
    const r = ['ghost', 'grunt']
    if (level >= 2) r.push('demon')
    if (level >= 4) r.push('lobber')
    if (level >= 6) r.push('sorcerer')
    return r
  }

  function Game (ctx) {
    this.ctx = ctx
    this.state = 'select'
    this.stateT = 0
    this.tick = 0
    this.paused = false

    this.selected = 0
    this.level = 1
    this.player = null
    this.dungeon = null

    this.monsters = []
    this.generators = []
    this.shots = []
    this.items = []
    this.particles = []

    this.camX = 0
    this.camY = 0
    this.monsterCap = 40

    this.banner = null
    this.bannerT = 0
    this.nagT = 0
    this.warnT = 0

    this.highScore = loadHighScore()
  }

  function loadHighScore () {
    try {
      return Number(global.localStorage.getItem('gauntlet.highscore')) || 0
    } catch (e) {
      return 0
    }
  }

  function saveHighScore (v) {
    try {
      global.localStorage.setItem('gauntlet.highscore', String(v))
    } catch (e) {
      /* private mode: just keep it for this session */
    }
  }

  Game.prototype.setState = function (s) {
    this.state = s
    this.stateT = 0
  }

  Game.prototype.setBanner = function (lines, frames) {
    this.banner = Array.isArray(lines) ? lines : [lines]
    this.bannerT = frames
  }

  /* --- Lifecycle ----------------------------------------------------------- */

  Game.prototype.newGame = function () {
    this.player = new G.Player(HERO_ORDER[this.selected])
    this.level = 0
    this.nextLevel()
  }

  Game.prototype.nextLevel = function () {
    this.level += 1
    this.buildLevel()
    const name = G.Sprites.hero[this.player.kind].info.name
    this.setBanner([name, 'LEVEL ' + this.level], 110)
    Sfx.levelStart()
    Sfx.music.start(this.level)
    this.setState('playing')
  }

  /** Build a level, then prove it is actually finishable before handing it over.

      Vaults are carved into rooms after the corridors exist, so a vault can
      land on top of a corridor that merely passes through its room and cut the
      map in two. Rather than special-case that, generate and verify: on the
      rare bad roll, throw the level away and roll again. */
  Game.prototype.buildLevel = function () {
    for (let attempt = 0; attempt < 12; attempt++) {
      this.populate(false)
      if (this.validateLevel()) return
    }
    // Vaults are the only thing that can sever a map, so a vault-free level is
    // a guaranteed-good fallback.
    this.populate(true)
    this.validateLevel()
  }

  Game.prototype.populate = function (noVaults) {
    const d = new G.Dungeon(this.level)
    this.dungeon = d

    this.monsters.length = 0
    this.generators.length = 0
    this.shots.length = 0
    this.items.length = 0
    this.particles.length = 0

    // Spawn in the first room; the exit goes in whichever room is furthest away
    // so every level is a real traverse rather than a two-step walk.
    const spawn = d.rooms[0]
    const start = d.spotIn(spawn)
    this.player.x = start.x
    this.player.y = start.y

    let far = d.rooms[d.rooms.length - 1]
    let best = -1
    for (const room of d.rooms) {
      const dd = G.dist(room.cx * TILE, room.cy * TILE, start.x, start.y)
      if (dd > best) {
        best = dd
        far = room
      }
    }
    d.set(far.cx, far.cy, G.EXIT)
    this.exitRoom = far

    const roster = rosterFor(this.level)

    for (let i = 1; i < d.rooms.length; i++) {
      const room = d.rooms[i]

      // Generators: the level's real objective, and its real threat.
      if (room !== far && G.chance(0.75)) {
        const spot = d.spotIn(room)
        this.generators.push(new G.Generator(G.pick(roster), spot.x, spot.y, this.level))
      }

      // A few monsters already loose, so a room is never simply empty.
      const loose = G.randInt(0, Math.min(4, 1 + (this.level >> 1)))
      for (let j = 0; j < loose; j++) {
        const spot = d.spotIn(room)
        this.monsters.push(new G.Monster(G.pick(roster), spot.x, spot.y, this.level))
      }

      if (G.chance(0.5)) this.addItem('treasure', d.spotIn(room))
      if (G.chance(0.34)) this.addItem('food', d.spotIn(room))
      if (G.chance(0.22)) this.addItem('potion', d.spotIn(room))
    }

    // Guarantee a minimum of sustenance regardless of the dice.
    let food = this.items.filter(i => i.kind === 'food').length
    while (food < 2) {
      this.addItem('food', d.spotIn(G.pick(d.rooms)))
      food++
    }

    if (!noVaults) this.buildVaults(d)

    // Death stalks the later levels. It cannot be shot, only blasted.
    if (this.level >= 5 && G.chance(0.5)) {
      const room = G.pick(d.rooms)
      if (room !== spawn) {
        const spot = d.spotIn(room)
        this.monsters.push(new G.Monster('death', spot.x, spot.y, this.level))
      }
    }

    this.updateCamera(true)
  }

  /** Wall off a small vault inside a roomy room, lock it, and fill it with
      treasure. Building it inside a room (never across a corridor) is what
      keeps a locked door from ever cutting off the exit. */
  Game.prototype.buildVaults = function (d) {
    let placed = 0
    const want = this.level >= 3 ? 2 : 1

    for (const room of G.shuffle(d.rooms.slice())) {
      if (placed >= want) break
      if (room.w < 8 || room.h < 8) continue
      // Never vault the exit room: the vault is centred exactly where the exit
      // tile sits, so it would wall the level's goal away — or overwrite it
      // outright and leave the level unfinishable.
      if (room === this.exitRoom) continue

      const cx = room.x + ((room.w / 2) | 0)
      const cy = room.y + ((room.h / 2) | 0)
      // Needs a clear ring inside the room so players can always walk around it.
      if (cx - 2 <= room.x || cx + 2 >= room.x + room.w - 1) continue
      if (cy - 2 <= room.y || cy + 2 >= room.y + room.h - 1) continue

      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          const edge = x === cx - 2 || x === cx + 2 || y === cy - 2 || y === cy + 2
          d.set(x, y, edge ? G.WALL : G.FLOOR)
        }
      }
      d.set(cx, cy + 2, G.DOOR)

      // Anything that was scattered here before the walls went up would now be
      // sealed in, so evict spawners and monsters caught inside the ring.
      const inside = (e) => Math.abs(e.x - (cx * TILE + TILE / 2)) < TILE * 2.5 &&
        Math.abs(e.y - (cy * TILE + TILE / 2)) < TILE * 2.5
      this.generators = this.generators.filter(g => !inside(g))
      this.monsters = this.monsters.filter(m => !inside(m))
      this.items = this.items.filter(i => !inside(i))

      this.addItem('treasure', { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 })
      this.addItem('treasure', { x: (cx - 1) * TILE + TILE / 2, y: (cy - 1) * TILE + TILE / 2 })
      this.addItem('potion', { x: (cx + 1) * TILE + TILE / 2, y: (cy - 1) * TILE + TILE / 2 })

      // The key goes in a different room — dropping it inside its own vault
      // would lock it in with the treasure it opens.
      const others = d.rooms.filter(r => r !== room)
      if (others.length) this.addItem('key', d.spotIn(G.pick(others)))
      placed++
    }
  }

  Game.prototype.addItem = function (kind, spot) {
    this.items.push(new G.Item(kind, spot.x, spot.y))
  }

  /** Flood fill outward from the hero. Breakable blocks count as passable —
      they can be shot away — while `throughDoors` decides whether locked doors
      do. Returns a Set of tile indices. */
  Game.prototype.reachable = function (throughDoors) {
    const d = this.dungeon
    const seen = new Set()
    const stack = [[Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE)]]

    while (stack.length) {
      const [x, y] = stack.pop()
      if (!d.inBounds(x, y)) continue
      const key = y * d.w + x
      if (seen.has(key)) continue
      const t = d.at(x, y)
      if (t === G.WALL) continue
      if (t === G.DOOR && !throughDoors) continue
      seen.add(key)
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    return seen
  }

  /** Reject levels whose exit cannot be walked to, and move any key that ended
      up sealed behind the very door it opens. */
  Game.prototype.validateLevel = function () {
    const d = this.dungeon

    const withDoors = this.reachable(true)
    let exitIdx = -1
    for (let y = 0; y < d.h && exitIdx < 0; y++) {
      for (let x = 0; x < d.w; x++) {
        if (d.at(x, y) === G.EXIT) {
          exitIdx = y * d.w + x
          break
        }
      }
    }
    if (exitIdx < 0 || !withDoors.has(exitIdx)) return false

    const open = this.reachable(false)
    const spare = []
    for (const key of open) {
      const x = key % d.w
      const y = (key / d.w) | 0
      if (d.at(x, y) === G.FLOOR) spare.push({ x, y })
    }
    if (!spare.length) return false

    for (const it of this.items) {
      if (it.kind !== 'key') continue
      const idx = Math.floor(it.y / TILE) * d.w + Math.floor(it.x / TILE)
      if (open.has(idx)) continue
      const spot = G.pick(spare)
      it.x = spot.x * TILE + TILE / 2
      it.y = spot.y * TILE + TILE / 2
    }
    return true
  }

  Game.prototype.gameOver = function () {
    if (this.player.score > this.highScore) {
      this.highScore = this.player.score
      saveHighScore(this.highScore)
    }
    Sfx.music.stop()
    Sfx.gameOver()
    this.setBanner(['GAME OVER'], 240)
    this.setState('gameover')
  }

  /* --- Helpers ------------------------------------------------------------- */

  /** An open tile near (x, y) for a generator to spawn into. */
  Game.prototype.freeSpotNear = function (x, y) {
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    for (let i = 0; i < 12; i++) {
      const nx = tx + G.randInt(-2, 2)
      const ny = ty + G.randInt(-2, 2)
      if (this.dungeon.at(nx, ny) === G.FLOOR) {
        return { x: nx * TILE + TILE / 2, y: ny * TILE + TILE / 2 }
      }
    }
    return null
  }

  Game.prototype.burst = function (x, y, color, n) {
    for (let i = 0; i < n; i++) this.particles.push(new G.Particle(x, y, color))
  }

  Game.prototype.updateCamera = function (snap) {
    const d = this.dungeon
    const maxX = Math.max(0, d.w * TILE - G.W)
    const maxY = Math.max(0, d.h * TILE - G.VIEW_H)
    const tx = G.clamp(this.player.x - G.W / 2, 0, maxX)
    const ty = G.clamp(this.player.y - G.VIEW_H / 2, 0, maxY)
    if (snap) {
      this.camX = tx
      this.camY = ty
    } else {
      // Ease so the view does not jitter with every step.
      this.camX = G.lerp(this.camX, tx, 0.18)
      this.camY = G.lerp(this.camY, ty, 0.18)
    }
  }

  Game.prototype.fire = function (dir) {
    const p = this.player
    if (!p.canFire()) return
    p.fireCooldown = p.stats.fireRate
    this.shots.push(new G.Shot(p.x, p.y, dir, p.stats.shotSpeed, p.stats.shot, true, false))
    Sfx.shoot()
  }

  /** The screen-clearing blast: everything visible takes a hard hit, and even
      Death is driven off. */
  Game.prototype.useMagic = function () {
    const p = this.player
    if (p.potions <= 0 || p.dead) return
    p.potions -= 1
    Sfx.magic()

    const power = 40 * p.stats.magic
    for (const m of this.monsters) {
      if (!m.alive) continue
      if (!this.onScreen(m.x, m.y)) continue
      if (m.k.isDeath) {
        m.alive = false
        this.burst(m.x, m.y, '#e8e8f0', 26)
        continue
      }
      m.hp -= power
      if (m.hp <= 0) {
        m.alive = false
        p.score += m.k.score
        this.burst(m.x, m.y, '#b48ae8', 10)
      }
    }
    for (const g of this.generators) {
      if (!g.alive || !this.onScreen(g.x, g.y)) continue
      if (g.damage(power)) {
        p.score += 100
        this.burst(g.x, g.y, '#ffd83d', 18)
      }
    }
    this.burst(p.x, p.y, '#d8b8ff', 40)
  }

  Game.prototype.onScreen = function (x, y) {
    return x > this.camX - 8 && x < this.camX + G.W + 8 &&
      y > this.camY - 8 && y < this.camY + G.VIEW_H + 8
  }

  /* --- Update -------------------------------------------------------------- */

  Game.prototype.update = function (dt, input) {
    this.tick += dt
    this.stateT += dt
    if (this.bannerT > 0) this.bannerT -= dt

    switch (this.state) {
      case 'select':
        this.updateSelect(input)
        break
      case 'playing':
        this.updatePlaying(dt, input)
        break
      case 'levelclear':
        if (this.stateT > 90) this.nextLevel()
        break
      case 'dying':
        this.updateWorld(dt)
        if (this.stateT > 120) this.gameOver()
        break
      case 'gameover':
        if (this.stateT > 60 && (input.startPressed || input.firePressed)) this.setState('select')
        break
    }
  }

  Game.prototype.updateSelect = function (input) {
    if (input.selectPressed !== 0) {
      this.selected = (this.selected + input.selectPressed + HERO_ORDER.length) % HERO_ORDER.length
      Sfx.select()
    }
    if (input.startPressed || input.firePressed) this.newGame()
  }

  Game.prototype.updatePlaying = function (dt, input) {
    const p = this.player

    p.update(dt, this, input.move)

    // Firing: an explicit aim wins, otherwise shoot the way you are walking.
    if (input.aim) {
      if (input.fire || input.firePressed) this.fire(G.octantOf(input.aim.x, input.aim.y))
    } else if (input.fire || input.firePressed) {
      this.fire(p.dir)
    }

    if (input.magicPressed) this.useMagic()

    this.updateWorld(dt)
    this.collide()
    this.updateCamera(false)

    // The famous nag, on a timer so it does not become a drone.
    if (p.health < 250) {
      this.nagT -= dt
      if (this.nagT <= 0) {
        this.nagT = 260
        const name = G.Sprites.hero[p.kind].info.name
        this.setBanner([name + ' NEEDS', 'FOOD BADLY'], 130)
      }
      this.warnT -= dt
      if (this.warnT <= 0) {
        this.warnT = 46
        Sfx.lowHealth()
      }
    }

    if (p.dead) {
      Sfx.music.stop()
      Sfx.playerDie()
      this.burst(p.x, p.y, '#ff6a4a', 30)
      this.setBanner(['YOU DIED'], 160)
      this.setState('dying')
    }
  }

  /** Everything that keeps ticking whether or not the hero is in control. */
  Game.prototype.updateWorld = function (dt) {
    for (const m of this.monsters) if (m.alive) m.update(dt, this)
    for (const g of this.generators) if (g.alive) g.update(dt, this)
    for (const s of this.shots) if (s.alive) s.update(dt, this)
    for (const i of this.items) i.update(dt)
    for (const q of this.particles) q.update(dt)

    prune(this.monsters)
    prune(this.generators)
    prune(this.shots)
    prune(this.items)
    prune(this.particles)
  }

  function prune (arr) {
    let w = 0
    for (let i = 0; i < arr.length; i++) if (arr[i].alive) arr[w++] = arr[i]
    arr.length = w
  }

  /* --- Collisions ---------------------------------------------------------- */

  Game.prototype.collide = function () {
    const p = this.player

    for (const s of this.shots) {
      if (!s.alive) continue

      if (s.fromPlayer) {
        for (const m of this.monsters) {
          if (!m.alive || !G.hit(s.x, s.y, s.r, m.x, m.y, m.r * 2)) continue
          s.alive = false
          if (m.damage(s.power, this)) {
            p.score += m.k.score
            this.burst(m.x, m.y, '#ffb46a', 10)
            Sfx.monsterDie()
          }
          break
        }
        if (!s.alive) continue

        for (const g of this.generators) {
          if (!g.alive || !G.hit(s.x, s.y, s.r, g.x, g.y, g.r * 2)) continue
          s.alive = false
          if (g.damage(s.power)) {
            p.score += 100
            this.burst(g.x, g.y, '#ffd83d', 20)
            Sfx.generatorDie()
          } else {
            Sfx.monsterHit()
          }
          break
        }
      } else if (!p.dead && G.hit(s.x, s.y, s.r, p.x, p.y, p.r * 2)) {
        s.alive = false
        p.damage(s.power)
        Sfx.hurt()
      }
    }

    if (p.dead) return

    // Contact damage, rate-limited. Applying it every frame while a monster
    // leans on you would drain a full health bar in about a second and retrigger
    // the hurt sound sixty times a second.
    for (const m of this.monsters) {
      if (!m.alive || !G.hit(p.x, p.y, p.r * 2, m.x, m.y, m.r * 2)) continue

      // Ghosts burst on the hero the way they do in the arcade, cooldown or not.
      if (m.k.fragile) {
        m.alive = false
        this.burst(m.x, m.y, '#9fd8ff', 10)
        p.score += m.k.score
        p.damage(m.k.touch)
        Sfx.hurt()
        continue
      }

      if (p.touchCD > 0) continue
      p.touchCD = TOUCH_COOLDOWN

      if (m.k.isDeath) {
        // Death eats health in great bites until magic drives it off.
        p.health -= 90
        if (p.health <= 0) {
          p.health = 0
          p.dead = true
        }
        p.hurtFlash = 8
        Sfx.hurt()
        continue
      }

      p.damage(m.k.touch)
      Sfx.hurt()
    }

    // Pickups.
    for (const it of this.items) {
      if (!it.alive || !G.hit(p.x, p.y, p.r * 2, it.x, it.y, it.r * 2)) continue
      it.alive = false
      switch (it.kind) {
        case 'food':
          p.health = Math.min(Hud.MAX_HEALTH, p.health + 300)
          Sfx.food()
          break
        case 'potion':
          p.potions += 1
          Sfx.potionPickup()
          break
        case 'key':
          p.keys += 1
          Sfx.key()
          break
        case 'treasure':
          p.score += 100
          Sfx.treasure()
          break
      }
    }

    // Doors open by walking into them, spending a key.
    const tx = Math.floor(p.x / TILE)
    const ty = Math.floor(p.y / TILE)
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.dungeon.at(tx + ox, ty + oy) !== G.DOOR) continue
      if (p.keys <= 0) continue
      p.keys -= 1
      this.dungeon.set(tx + ox, ty + oy, G.FLOOR)
      this.burst((tx + ox) * TILE + 8, (ty + oy) * TILE + 8, '#ffd83d', 14)
      Sfx.door()
      break
    }

    if (this.dungeon.at(tx, ty) === G.EXIT) {
      p.score += 500 + this.level * 100
      Sfx.music.stop()
      Sfx.levelClear()
      this.setBanner(['LEVEL ' + this.level, 'COMPLETE'], 90)
      this.setState('levelclear')
    }
  }

  /* --- Draw ---------------------------------------------------------------- */

  Game.prototype.draw = function () {
    const ctx = this.ctx
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, G.W, G.H)

    if (this.state === 'select') {
      this.drawSelect(ctx)
      return
    }

    ctx.save()
    ctx.translate(0, G.HUD_H)
    ctx.beginPath()
    ctx.rect(0, 0, G.W, G.VIEW_H)
    ctx.clip()

    const cx = Math.round(this.camX)
    const cy = Math.round(this.camY)

    this.dungeon.draw(ctx, cx, cy)

    for (const g of this.generators) if (g.alive) g.draw(ctx, cx, cy)
    for (const it of this.items) if (it.alive) it.draw(ctx, cx, cy)
    for (const m of this.monsters) if (m.alive) m.draw(ctx, cx, cy)
    if (!this.player.dead) this.player.draw(ctx, cx, cy)
    for (const s of this.shots) if (s.alive) s.draw(ctx, cx, cy)
    for (const q of this.particles) q.draw(ctx, cx, cy)

    this.drawExitArrow(ctx, cx, cy)

    ctx.restore()

    Hud.drawStatus(ctx, this)
    this.drawBanner(ctx)

    if (this.state === 'gameover' && this.stateT > 60) {
      Hud.text(ctx, 'SCORE ' + G.commas(this.player.score), G.W / 2, G.H / 2 + 24, '#ffd83d', 'center')
      Hud.text(ctx, 'BEST ' + G.commas(this.highScore), G.W / 2, G.H / 2 + 36, '#7a7a9c', 'center')
      if (((this.tick / 30) | 0) & 1) {
        Hud.text(ctx, 'TAP TO PLAY AGAIN', G.W / 2, G.H - 40, '#c8c8e0', 'center')
      }
    }

    if (this.paused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(0, G.HUD_H, G.W, G.VIEW_H)
      Hud.text(ctx, 'PAUSED', G.W / 2, G.H / 2, '#ffffff', 'center')
    }
  }

  /** A chevron at the screen edge pointing at the exit, so a big level never
      becomes a search of every corridor. */
  Game.prototype.drawExitArrow = function (ctx, cx, cy) {
    const d = this.dungeon
    let ex = -1
    let ey = -1
    for (let y = 0; y < d.h && ex < 0; y++) {
      for (let x = 0; x < d.w; x++) {
        if (d.at(x, y) === G.EXIT) {
          ex = x * TILE + 8
          ey = y * TILE + 8
          break
        }
      }
    }
    if (ex < 0) return
    if (this.onScreen(ex, ey)) return

    // Already inside the translated world space, so no HUD offset here.
    const px = this.player.x - cx
    const py = this.player.y - cy
    const a = Math.atan2(ey - this.player.y, ex - this.player.x)
    const rx = G.clamp(px + Math.cos(a) * 60, 10, G.W - 10)
    const ry = G.clamp(py + Math.sin(a) * 60, 10, G.VIEW_H - 10)

    ctx.save()
    ctx.translate(Math.round(rx), Math.round(ry))
    ctx.rotate(a)
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.tick / 14)
    ctx.fillStyle = '#5fd8ff'
    ctx.fillRect(-4, -1, 7, 3)
    ctx.fillRect(2, -3, 2, 7)
    ctx.fillRect(4, -2, 2, 5)
    ctx.restore()
    ctx.globalAlpha = 1
  }

  Game.prototype.drawBanner = function (ctx) {
    if (this.bannerT <= 0 || !this.banner) return
    const y = G.HUD_H + 40
    ctx.fillStyle = 'rgba(5, 6, 10, 0.75)'
    ctx.fillRect(0, y - 8, G.W, this.banner.length * 12 + 12)
    this.banner.forEach((line, i) => {
      Hud.text(ctx, line, G.W / 2, y + i * 12, i === 0 ? '#ffd83d' : '#c8c8e0', 'center')
    })
  }

  /* --- Character select ---------------------------------------------------- */

  Game.prototype.drawSelect = function (ctx) {
    Hud.text(ctx, 'GAUNTLET', G.W / 2, 34, '#ffd83d', 'center')
    Hud.text(ctx, 'CHOOSE YOUR HERO', G.W / 2, 50, '#7a7a9c', 'center')

    HERO_ORDER.forEach((kind, i) => {
      const set = G.Sprites.hero[kind]
      const y = 84 + i * 58
      const on = i === this.selected

      ctx.fillStyle = on ? 'rgba(255, 216, 61, 0.10)' : 'rgba(255, 255, 255, 0.03)'
      ctx.fillRect(12, y - 20, G.W - 24, 50)
      if (on) {
        ctx.fillStyle = set.info.A
        ctx.fillRect(12, y - 20, 2, 50)
      }

      G.Sprites.draw(ctx, set.front, 36, y + 4, false)
      Hud.text(ctx, set.info.name, 58, y - 12, on ? '#ffffff' : '#9a9ab8')
      Hud.text(ctx, set.info.title, 58, y, set.info.A)

      // Three quick bars, so the trade-offs are visible before committing.
      const s = G.CLASSES[kind]
      const bars = [
        ['SPD', (s.speed - 1.0) / 0.6],
        ['SHOT', (s.shot - 2) / 4],
        ['ARMR', 1 - (s.armour - 0.5) / 0.55],
        ['MAGIC', (s.magic - 0.9) / 1.2]
      ]
      bars.forEach(([label, v], bi) => {
        const bx = 58 + bi * 44
        Hud.text(ctx, label, bx, y + 12, '#55556e')
        ctx.fillStyle = '#23233a'
        ctx.fillRect(bx, y + 21, 34, 3)
        ctx.fillStyle = set.info.A
        ctx.fillRect(bx, y + 21, Math.round(34 * G.clamp(v, 0.08, 1)), 3)
      })
    })

    if (((this.tick / 30) | 0) & 1) {
      Hud.text(ctx, 'TAP A HERO TO START', G.W / 2, G.H - 26, '#c8c8e0', 'center')
    }
    if (this.highScore > 0) {
      Hud.text(ctx, 'BEST ' + G.commas(this.highScore), G.W / 2, G.H - 12, '#7a7a9c', 'center')
    }
  }

  /** Hit-test the character-select rows, in logical screen coordinates. */
  Game.prototype.heroRowAt = function (x, y) {
    for (let i = 0; i < HERO_ORDER.length; i++) {
      const top = 84 + i * 58 - 20
      if (y >= top && y <= top + 50) return i
    }
    return -1
  }

  G.Game = Game
  G.HERO_ORDER = HERO_ORDER
})(window)
