/* Fighters — the player's, the wing's, and the enemy's — plus the turrets that
   sit on capital ships and trench walls.

   Everything that flies shares one update: steer the nose toward where you
   want to be, roll into the turn, then let the engines drag the velocity
   around to match. Enemy pilots differ from the player only in that a state
   machine holds the stick. */
(function (global) {
  'use strict'

  const G = global.G

  const REBEL = 0
  const IMPERIAL = 1

  /* Stats per hull type. Speeds are metres per second; turn rates radians per
     second. The player is quicker than everything except the interceptor,
     which is the point of the interceptor. */
  const KINDS = {
    vanguard: {
      model: 'vanguard', faction: REBEL,
      hull: 100, shield: 100, regen: 7, regenDelay: 3.5,
      speed: 190, boost: 340, turn: 1.85,
      fireRate: 0.13, damage: 17, boltSpeed: 1500,
      bolt: [1.0, 0.22, 0.14],
      guns: [[5.1, 1.75, -5.4], [-5.1, 1.75, -5.4], [5.1, -1.05, -5.4], [-5.1, -1.05, -5.4]],
      engines: [[1.5, 1.0, 4.4], [-1.5, 1.0, 4.4], [1.5, -0.3, 4.4], [-1.5, -0.3, 4.4]],
      engineCol: [0.42, 0.78, 1.0], engineSize: 3.4,
      radius: 7, score: 0
    },
    talon: {
      model: 'talon', faction: IMPERIAL,
      hull: 26, shield: 0, regen: 0, regenDelay: 0,
      speed: 172, boost: 250, turn: 1.55,
      fireRate: 0.42, damage: 9, boltSpeed: 1150,
      bolt: [0.22, 1.0, 0.2],
      guns: [[0.55, -1.05, -2.2], [-0.55, -1.05, -2.2]],
      engines: [[0, 0, 1.9]],
      engineCol: [1.0, 0.55, 0.22], engineSize: 3.2,
      radius: 4.6, score: 100
    },
    interceptor: {
      model: 'interceptor', faction: IMPERIAL,
      hull: 22, shield: 0, regen: 0, regenDelay: 0,
      speed: 208, boost: 300, turn: 2.05,
      fireRate: 0.3, damage: 9, boltSpeed: 1250,
      bolt: [0.22, 1.0, 0.2],
      guns: [[0.55, -1.05, -2.2], [-0.55, -1.05, -2.2]],
      engines: [[0, 0, 1.9]],
      engineCol: [1.0, 0.45, 0.18], engineSize: 3.2,
      radius: 4.8, score: 150
    },
    elite: {
      model: 'elite', faction: IMPERIAL,
      hull: 60, shield: 40, regen: 5, regenDelay: 5,
      speed: 195, boost: 300, turn: 1.9,
      fireRate: 0.26, damage: 12, boltSpeed: 1300,
      bolt: [0.22, 1.0, 0.2],
      guns: [[0.55, -1.05, -2.2], [-0.55, -1.05, -2.2]],
      engines: [[0, 0, 1.9]],
      engineCol: [1.0, 0.4, 0.5], engineSize: 3.4,
      radius: 4.8, score: 300
    },
    bomber: {
      model: 'bomber', faction: IMPERIAL,
      hull: 110, shield: 0, regen: 0, regenDelay: 0,
      speed: 128, boost: 160, turn: 0.85,
      fireRate: 0.6, damage: 20, boltSpeed: 1000,
      bolt: [0.24, 1.0, 0.18],
      guns: [[1.7, -1.4, -3.2], [-1.7, -1.4, -3.2]],
      engines: [[1.7, 0, 3.4], [-1.7, 0, 3.4]],
      engineCol: [1.0, 0.5, 0.2], engineSize: 3.6,
      radius: 6.4, score: 250
    },
    // The wing: allied fighters, same airframe as the player's, flown by AI.
    wingman: {
      model: 'vanguard', faction: REBEL,
      hull: 70, shield: 40, regen: 4, regenDelay: 5,
      speed: 180, boost: 300, turn: 1.6,
      fireRate: 0.3, damage: 14, boltSpeed: 1500,
      bolt: [1.0, 0.22, 0.14],
      guns: [[5.1, 1.75, -5.4], [-5.1, 1.75, -5.4]],
      engines: [[1.5, 1.0, 4.4], [-1.5, 1.0, 4.4], [1.5, -0.3, 4.4], [-1.5, -0.3, 4.4]],
      engineCol: [0.42, 0.78, 1.0], engineSize: 3.4,
      radius: 7, score: 0
    }
  }

  const ships = []
  const tmp = G.v3(), tmp2 = G.v3(), tmp3 = G.v3()
  const fwd = G.v3(), want = G.v3(), axis = G.v3()
  const shipUp = G.v3(), shipRight = G.v3()
  const WORLD_UP = G.v3(0, 1, 0)
  const qtmp = G.qid()

  // A stable up vector for a mount normal, so qlook never degenerates.
  const upGuess = G.v3()
  const UP_GUESS = n => {
    if (Math.abs(n.y) > 0.95) G.vset(upGuess, 0, 0, 1)
    else G.vset(upGuess, 0, 1, 0)
    return upGuess
  }

  const WHITE = new Float32Array([1, 1, 1])
  const RED_TINT = new Float32Array([1.25, 0.72, 0.62])

  /* ------------------------------------------------------------ spawning -- */

  const spawn = (kindName, pos, quat, opts) => {
    const k = KINDS[kindName]
    const o = opts || {}
    const s = {
      alive: true,
      kind: kindName,
      def: k,
      mesh: G.models[k.model],
      faction: o.faction === undefined ? k.faction : o.faction,
      player: !!o.player,
      pos: G.vcopy(pos),
      vel: G.v3(),
      quat: quat ? new Float32Array(quat) : G.qid(),
      radius: k.radius,
      hull: k.hull, maxHull: k.hull,
      shield: k.shield, maxShield: k.shield,
      shieldTimer: 0,
      throttle: 1, boosting: false,
      speed: k.speed,
      cooldown: 0, gunIndex: 0,
      flash: 0,
      skill: o.skill === undefined ? 0.5 : o.skill,
      mode: o.mode || 'dogfight',
      state: 'pursue', stateTimer: 0,
      target: null, evadeDir: G.v3(),
      screamTimer: G.rand(1, 6),
      lockedBy: 0,
      corridorTarget: G.v3(),
      dead: false,
      smokeTimer: 0
    }
    ships.push(s)
    return s
  }

  /* --------------------------------------------------------------- steer -- */

  /** Rotate a ship's nose toward a world-space point, banking into the turn.
      Returns the angle still to go, which the AI uses to decide about firing. */
  const steerToward = (s, targetPos, dt, rateScale) => {
    G.qforward(fwd, s.quat)
    G.vsub(want, targetPos, s.pos)
    const dist = G.vlen(want)
    if (dist < 0.001) return 0
    G.vscale(want, want, 1 / dist)

    const dot = G.clamp(G.vdot(fwd, want), -1, 1)
    const angle = Math.acos(dot)
    if (angle < 0.0005) return angle

    G.vcross(axis, fwd, want)
    const al = G.vlen(axis)
    if (al < 1e-6) {
      // Exactly behind: pick any axis and start the turn.
      G.qup(axis, s.quat)
    } else {
      G.vscale(axis, axis, 1 / al)
    }

    const rate = s.def.turn * (rateScale === undefined ? 1 : rateScale)
    const turn = Math.min(angle, rate * dt)
    G.qaxis(qtmp, axis.x, axis.y, axis.z, turn)
    G.qmul(s.quat, qtmp, s.quat)   // world-space rotation
    G.qnorm(s.quat)

    bankInto(s, G.vdot(axis, shipUpOf(s)) * (turn / Math.max(dt, 0.0001)), dt)
    return angle
  }

  const shipUpOf = s => { G.qup(shipUp, s.quat); return shipUp }

  /** Roll toward the bank angle a turn of this rate deserves, and level out
      when the turn stops. Nothing about it affects where the ship goes — it is
      just the single biggest thing that makes AI flying look flown. */
  const bankInto = (s, yawRate, dt, gain) => {
    G.qforward(fwd, s.quat)
    // Straight up or straight down there is no meaningful horizon to level
    // against, so leave the roll alone rather than snapping it.
    if (Math.abs(G.vdot(fwd, WORLD_UP)) > 0.9) return
    G.qright(shipRight, s.quat)
    G.qup(shipUp, s.quat)
    const bank = Math.atan2(G.vdot(shipRight, WORLD_UP), G.vdot(shipUp, WORLD_UP))
    const desired = G.clamp(yawRate * 0.6, -1.15, 1.15)
    const k = gain === undefined ? 2.6 : gain
    G.qrotateLocal(s.quat, 0, 0, 1, G.clamp((desired - bank) * k * dt, -3 * dt, 3 * dt))
  }

  /** Straight-line flight: velocity chases the nose instead of snapping to it,
      which gives a fighter some mass without a full physics model. */
  const applyThrust = (s, dt) => {
    G.qforward(fwd, s.quat)
    const target = s.speed * s.throttle * (s.boosting ? s.def.boost / s.def.speed : 1)
    tmp.x = fwd.x * target; tmp.y = fwd.y * target; tmp.z = fwd.z * target
    const k = 1 - Math.exp(-4.5 * dt)
    s.vel.x += (tmp.x - s.vel.x) * k
    s.vel.y += (tmp.y - s.vel.y) * k
    s.vel.z += (tmp.z - s.vel.z) * k
    G.vmad(s.pos, s.vel, dt)
  }

  /* --------------------------------------------------------------- guns -- */

  const gunWorld = (s, i, out) => {
    const g = s.def.guns[i % s.def.guns.length]
    tmp3.x = g[0]; tmp3.y = g[1]; tmp3.z = g[2]
    G.qvec(out, s.quat, tmp3)
    out.x += s.pos.x; out.y += s.pos.y; out.z += s.pos.z
    return out
  }

  /* Wing cannons sit five metres out from the centreline. Fired parallel they
     would straddle whatever is under the crosshair and miss it by inches, so
     every gun is harmonised on a point out in front — the same thing gunnery
     officers have done to aircraft since the 1930s. */
  const CONVERGE = 700
  const aimPoint = G.v3(), boltDir = G.v3()

  /** Fire one gun in the rotation, aimed down `dir`. */
  const shoot = (s, dir) => {
    const k = s.def
    gunWorld(s, s.gunIndex, tmp2)
    s.gunIndex = (s.gunIndex + 1) % k.guns.length
    aimPoint.x = s.pos.x + dir.x * CONVERGE
    aimPoint.y = s.pos.y + dir.y * CONVERGE
    aimPoint.z = s.pos.z + dir.z * CONVERGE
    G.vsub(boltDir, aimPoint, tmp2)
    G.vnorm(boltDir, boltDir)
    G.Fx.fire({
      pos: tmp2, dir: boltDir, speed: k.boltSpeed, life: 1.9,
      damage: k.damage, length: k.boltSpeed * 0.011, width: s.player ? 1.5 : 1.2,
      r: k.bolt[0] * 1.6, g: k.bolt[1] * 1.6, b: k.bolt[2] * 1.6,
      hostile: s.faction === IMPERIAL, owner: s
    })
    G.Fx.spawn({
      pos: tmp2, life: 0.09, size: 5.5, sizeEnd: 1,
      r: k.bolt[0] * 2, g: k.bolt[1] * 2, b: k.bolt[2] * 2, sprite: G.SPRITE.DOT
    })
    s.cooldown = k.fireRate
    if (s.faction === IMPERIAL) G.Sfx.enemyBlaster(s.pos)
    else if (!s.player) G.Sfx.blaster(s.pos)
  }

  /* ----------------------------------------------------------------- ai -- */

  const pickTarget = s => {
    let best = null
    let bestScore = Infinity
    for (let i = 0; i < ships.length; i++) {
      const o = ships[i]
      if (!o.alive || o.faction === s.faction) continue
      let d = G.vdist(s.pos, o.pos)
      // Everyone would rather be shooting at the player than at a wingman.
      if (o.player) d *= 0.55
      if (d < bestScore) { bestScore = d; best = o }
    }
    return best
  }

  const aiUpdate = (s, dt, world) => {
    s.stateTimer -= dt
    if (!s.target || !s.target.alive || s.stateTimer <= -6) {
      s.target = pickTarget(s)
      s.stateTimer = 0
    }
    const t = s.target
    if (!t) {
      // Nothing to fight: hold formation on the player, or cruise.
      if (world.player && world.player.alive && s.faction === REBEL) {
        G.qright(tmp, world.player.quat)
        tmp2.x = world.player.pos.x + tmp.x * 60
        tmp2.y = world.player.pos.y + 12
        tmp2.z = world.player.pos.z + 40
        steerToward(s, tmp2, dt)
      }
      applyThrust(s, dt)
      return
    }

    const dist = G.vdist(s.pos, t.pos)
    G.qforward(fwd, s.quat)

    if (s.state === 'pursue' && dist < 90 && s.mode !== 'corridor') {
      // Too close to shoot: break off, swing round and come back.
      s.state = 'break'
      s.stateTimer = G.rand(1.1, 2.0)
      G.vrandom(s.evadeDir)
      G.vmad(s.evadeDir, fwd, 1.2)
      G.vnorm(s.evadeDir, s.evadeDir)
    } else if (s.state === 'break' && s.stateTimer <= 0) {
      s.state = 'pursue'
    }

    if (s.state === 'break') {
      tmp2.x = s.pos.x + s.evadeDir.x * 400
      tmp2.y = s.pos.y + s.evadeDir.y * 400
      tmp2.z = s.pos.z + s.evadeDir.z * 400
      steerToward(s, tmp2, dt, 1.15)
      s.throttle = 1
      s.boosting = dist < 200
      applyThrust(s, dt)
      return
    }

    // Lead the target. Better pilots lead more accurately.
    G.leadPoint(tmp2, s.pos, t.pos, t.vel, s.def.boltSpeed)
    const wobble = (1 - s.skill) * 22
    if (wobble > 0.1) {
      tmp2.x += Math.sin(world.time * 1.7 + s.screamTimer) * wobble
      tmp2.y += Math.sin(world.time * 2.3 + s.screamTimer * 2) * wobble
      tmp2.z += Math.cos(world.time * 1.9 + s.screamTimer) * wobble
    }

    const angle = steerToward(s, tmp2, dt)
    s.throttle = 1
    s.boosting = dist > 700
    applyThrust(s, dt)

    // Fire when lined up and in range.
    s.cooldown -= dt
    const maxRange = 1100
    if (s.cooldown <= 0 && angle < 0.055 + (1 - s.skill) * 0.02 && dist < maxRange && dist > 40) {
      G.vsub(tmp, tmp2, s.pos)
      G.vnorm(tmp, tmp)
      shoot(s, tmp)
    }

    // Fly-by scream when an enemy fighter crosses close to the camera.
    if (s.faction === IMPERIAL) {
      s.screamTimer -= dt
      const dc = G.vdist(s.pos, world.camPos)
      if (s.screamTimer <= 0 && dc < 260) {
        G.Sfx.scream(s.pos)
        s.screamTimer = G.rand(2.5, 6)
      } else if (s.screamTimer <= 0) {
        s.screamTimer = G.rand(0.5, 2)
      }
    }
  }

  /** Trench mode: hold the corridor, weave, and shoot down the line. */
  const corridorUpdate = (s, dt, world) => {
    const T = G.TRENCH
    s.corridorTarget.x = Math.sin(world.time * 0.9 + s.screamTimer) * (T.HALF_W - 16)
    s.corridorTarget.y = -T.DEPTH + 26 + Math.sin(world.time * 0.7 + s.screamTimer * 2) * 12
    s.corridorTarget.z = s.pos.z - 300
    steerToward(s, s.corridorTarget, dt, 0.8)
    s.throttle = 1
    applyThrust(s, dt)

    s.cooldown -= dt
    const p = world.player
    if (p && p.alive && s.cooldown <= 0) {
      G.vsub(tmp, p.pos, s.pos)
      const d = G.vlen(tmp)
      G.qforward(fwd, s.quat)
      if (d < 900 && G.vdot(fwd, tmp) / d > 0.9) {
        G.vscale(tmp, tmp, 1 / d)
        shoot(s, tmp)
      }
    }
  }

  /* ------------------------------------------------------------- damage -- */

  const damage = (s, amount, at) => {
    if (!s.alive) return false
    s.flash = 1
    if (s.shield > 0) {
      s.shield -= amount
      s.shieldTimer = s.def.regenDelay
      G.Fx.shieldFlare(at || s.pos, 0.35, 0.7, 1.3)
      G.Sfx.shieldHit(s.pos)
      if (s.shield < 0) { s.hull += s.shield; s.shield = 0 }
    } else {
      s.hull -= amount
      G.Sfx.hullHit(s.pos)
    }
    if (s.hull <= 0) {
      s.hull = 0
      kill(s)
      return true
    }
    return false
  }

  const kill = s => {
    if (!s.alive) return
    s.alive = false
    s.dead = true
    G.Fx.explode(s.pos, s.vel, s.radius * 2.4, {
      tint: s.faction === IMPERIAL ? [0.42, 0.45, 0.5] : [0.7, 0.72, 0.76]
    })
  }

  /* ------------------------------------------------------------- update -- */

  const update = (dt, world) => {
    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i]
      if (!s.alive) {
        if (!s.player) ships.splice(i, 1)
        continue
      }
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 6)

      if (s.maxShield > 0) {
        s.shieldTimer -= dt
        if (s.shieldTimer <= 0 && s.shield < s.maxShield) {
          s.shield = Math.min(s.maxShield, s.shield + s.def.regen * dt)
        }
      }

      // Smoke trail once a hull is badly hurt.
      if (s.hull < s.maxHull * 0.35) {
        s.smokeTimer -= dt
        if (s.smokeTimer <= 0) {
          s.smokeTimer = 0.06
          G.Fx.spawn({
            pos: s.pos, vel: G.v3(s.vel.x * 0.3, s.vel.y * 0.3, s.vel.z * 0.3),
            life: G.rand(0.7, 1.6),
            size: s.radius * 0.7, sizeEnd: s.radius * 3.4,
            r: 0.28, g: 0.24, b: 0.23, a: 0.5,
            sprite: G.SPRITE.SMOKE, drag: 0.4,
            spin: Math.random() * G.TAU, spinRate: G.rand(-2, 2)
          })
        }
      }

      if (s.player) continue // the player is flown in game.js
      if (s.mode === 'corridor') corridorUpdate(s, dt, world)
      else aiUpdate(s, dt, world)
    }
  }

  /* --------------------------------------------------------------- draw -- */

  const drawShip = (R, s, hideSelf) => {
    if (hideSelf) return
    R.mesh(s.mesh, s.pos, s.quat, 1, {
      tint: s.flash > 0.02 ? RED_TINT : WHITE,
      flash: s.flash * 0.55
    })
  }

  /** Engine glow, drawn as additive sprites so it blooms. */
  const drawEngines = (R, s, throttleOverride) => {
    const k = s.def
    const th = throttleOverride === undefined
      ? (s.boosting ? 1.5 : s.throttle)
      : throttleOverride
    if (th <= 0.02) return
    for (let i = 0; i < k.engines.length; i++) {
      const e = k.engines[i]
      tmp3.x = e[0]; tmp3.y = e[1]; tmp3.z = e[2]
      G.qvec(tmp, s.quat, tmp3)
      tmp.x += s.pos.x; tmp.y += s.pos.y; tmp.z += s.pos.z
      const size = k.engineSize * (0.62 + th * 0.4)
      R.sprite(tmp, size, k.engineCol[0] * 1.3, k.engineCol[1] * 1.3, k.engineCol[2] * 1.3, 0.85, G.SPRITE.DOT, 0)
      R.sprite(tmp, size * 1.9, k.engineCol[0], k.engineCol[1], k.engineCol[2], 0.16, G.SPRITE.DOT, 0)
      // The exhaust plume: a short beam trailing straight back.
      G.qforward(fwd, s.quat)
      tmp2.x = tmp.x - fwd.x * size * (1.6 + th * 4)
      tmp2.y = tmp.y - fwd.y * size * (1.6 + th * 4)
      tmp2.z = tmp.z - fwd.z * size * (1.6 + th * 4)
      R.beam(tmp, tmp2, size * 0.7,
        k.engineCol[0] * 0.7, k.engineCol[1] * 0.7, k.engineCol[2] * 0.85, 0.3)
    }
  }

  const draw = (R, hidePlayer) => {
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive) continue
      drawShip(R, s, s.player && hidePlayer)
    }
  }

  const drawFx = (R, hidePlayer) => {
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive || (s.player && hidePlayer)) continue
      drawEngines(R, s)
      // Shield shimmer when it has just taken a hit.
      if (s.maxShield > 0 && s.shieldTimer > s.def.regenDelay - 0.4 && s.shield > 0) {
        R.sprite(s.pos, s.radius * 4.2, 0.3, 0.6, 1.4, 0.22, G.SPRITE.DOT, 0)
      }
    }
  }

  /* ------------------------------------------------------------ turrets -- */

  /* Turrets are simple: track the player, fire heavy slow bolts, and blow up
     when their hull runs out. They live on a parent (a capital ship or a
     trench wall) and are positioned in the parent's frame. */

  const makeTurret = (local, parent, opts) => {
    const o = opts || {}
    return {
      alive: true,
      local: G.vcopy(local),
      pos: G.vcopy(local),
      parent,
      normal: o.normal ? G.vcopy(o.normal) : G.v3(0, 1, 0),
      yaw: 0, pitch: 0,
      hull: o.hull === undefined ? 40 : o.hull,
      cooldown: G.rand(0, 2),
      fireRate: o.fireRate === undefined ? 2.2 : o.fireRate,
      damage: o.damage === undefined ? 14 : o.damage,
      range: o.range === undefined ? 1600 : o.range,
      radius: 12,
      flash: 0,
      score: o.score === undefined ? 150 : o.score,
      quat: G.qid(),
      headQuat: G.qid()
    }
  }

  const updateTurret = (t, dt, world) => {
    if (!t.alive) return
    if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 6)

    // Position in world space, following the parent if it moves.
    if (t.parent) {
      G.qvec(t.pos, t.parent.quat, t.local)
      t.pos.x += t.parent.pos.x; t.pos.y += t.parent.pos.y; t.pos.z += t.parent.pos.z
      G.qvec(tmp, t.parent.quat, t.normal)
    } else {
      G.vcopyTo(tmp, t.normal)
    }

    // Stand the base up along its mount normal. qlook points -Z at the normal,
    // so a quarter turn about X swings the model's +Y axis onto it instead.
    G.qlook(t.quat, tmp, UP_GUESS(tmp))
    G.qrotateLocal(t.quat, 1, 0, 0, -Math.PI / 2)
    const p = world.player
    if (!p || !p.alive) return

    G.vsub(tmp2, p.pos, t.pos)
    const dist = G.vlen(tmp2)
    if (dist > t.range) return
    // Turrets only fire at things on the outward side of their mount.
    if (G.vdot(tmp2, tmp) < 0) return

    G.leadPoint(tmp3, t.pos, p.pos, p.vel, 900)
    G.vsub(tmp2, tmp3, t.pos)
    G.vnorm(tmp2, tmp2)
    G.qlook(t.headQuat, tmp2, tmp)

    t.cooldown -= dt
    if (t.cooldown <= 0) {
      t.cooldown = t.fireRate * G.rand(0.8, 1.25)
      G.vcopyTo(tmp, t.pos)
      tmp.x += tmp2.x * 14; tmp.y += tmp2.y * 14; tmp.z += tmp2.z * 14
      G.Fx.fire({
        pos: tmp, dir: tmp2, speed: 900, life: 3,
        damage: t.damage, length: 22, width: 2.2,
        r: 0.5, g: 1.7, b: 0.4, hostile: true
      })
      G.Sfx.enemyBlaster(t.pos)
    }
  }

  const drawTurret = (R, t) => {
    if (!t.alive) return
    R.mesh(G.models.turretBase, t.pos, t.quat, 1, {
      tint: t.flash > 0.02 ? RED_TINT : WHITE, flash: t.flash * 0.5
    })
    R.mesh(G.models.turretHead, t.pos, t.headQuat, 1, {
      tint: t.flash > 0.02 ? RED_TINT : WHITE, flash: t.flash * 0.5
    })
  }

  const reset = () => { ships.length = 0 }

  G.Fleet = {
    REBEL, IMPERIAL, KINDS, ships,
    spawn, update, draw, drawFx, damage, kill, shoot, steerToward, applyThrust,
    gunWorld, drawEngines,
    makeTurret, updateTurret, drawTurret, bankInto,
    reset
  }
})(window)
