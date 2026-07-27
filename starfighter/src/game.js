/* The game: the player's flight model, the camera, the world, and the three
   stages a run moves through.

     1. patrol      waves of enemy fighters over an asteroid drift
     2. dreadnought a capital ship arrives — drop its shield domes, then gut it
     3. trench      the battle station run, ending at the exhaust port

   Clear all three and the whole thing repeats a notch harder, forever. */
(function (global) {
  'use strict'

  const G = global.G

  const NEAR = 1.2
  const FAR = 14000

  const T = G.TRENCH

  /* ---------------------------------------------------------------- sky -- */

  const sky = (haze, lobes) => {
    const dir = new Float32Array(12)
    const col = new Float32Array(12)
    const pow = new Float32Array(8)
    for (let i = 0; i < 4; i++) {
      const l = lobes[i]
      const d = G.vnorm(G.v3(), G.v3(l.d[0], l.d[1], l.d[2]))
      dir[i * 3] = d.x; dir[i * 3 + 1] = d.y; dir[i * 3 + 2] = d.z
      col[i * 3] = l.c[0]; col[i * 3 + 1] = l.c[1]; col[i * 3 + 2] = l.c[2]
      pow[i * 2] = l.tight; pow[i * 2 + 1] = l.strength
    }
    return { haze: new Float32Array(haze), lobeDir: dir, lobeCol: col, lobePow: pow, time: 0 }
  }

  const SKIES = {
    patrol: sky([0.016, 0.020, 0.036], [
      { d: [-0.4, 0.3, -0.8], c: [0.22, 0.10, 0.34], tight: 3.2, strength: 0.55 },
      { d: [0.8, -0.2, 0.5], c: [0.06, 0.16, 0.30], tight: 4.5, strength: 0.5 },
      { d: [0.1, 0.9, 0.3], c: [0.16, 0.06, 0.16], tight: 6, strength: 0.35 },
      { d: [-0.7, -0.5, 0.4], c: [0.20, 0.11, 0.06], tight: 8, strength: 0.3 }
    ]),
    station: sky([0.012, 0.014, 0.024], [
      { d: [0.3, 0.2, -0.9], c: [0.10, 0.13, 0.26], tight: 4, strength: 0.45 },
      { d: [-0.9, 0.1, 0.3], c: [0.20, 0.08, 0.12], tight: 5, strength: 0.4 },
      { d: [0.2, -0.8, 0.5], c: [0.06, 0.12, 0.20], tight: 7, strength: 0.3 },
      { d: [0.6, 0.7, 0.3], c: [0.14, 0.10, 0.22], tight: 9, strength: 0.25 }
    ])
  }

  /* -------------------------------------------------------------- world -- */

  const world = {
    time: 0,
    stage: 'patrol',
    phase: '',
    phaseTimer: 0,
    wave: 0,
    waves: 3,
    difficulty: 0,
    score: 0,
    best: 0,
    kills: 0,
    player: null,
    asteroids: [],
    capital: null,
    trench: null,
    turrets: [],
    port: null,
    messages: [],
    camPos: G.v3(),
    camQuat: G.qid(),
    shake: 0,
    hitFlash: 0,
    sky: SKIES.patrol,
    over: false,
    overReason: '',
    won: false,
    demo: false,
    lockTarget: null,
    lockProgress: 0,
    locked: false,
    spawnTimer: 0,
    exposedTimer: 0,
    escapeTimer: 0,
    missed: false,
    jumped: false,
    view: 0,        // 0 chase, 1 cockpit
    warpEffect: 0,
    stageName: '',
    objective: ''
  }

  const cam = { pos: G.v3(), quat: G.qid(), fov: 1.12, near: NEAR, far: FAR }
  const camTarget = G.v3()
  const camQuatTarget = G.qid()

  const tmp = G.v3(), tmp2 = G.v3(), tmp3 = G.v3()
  const fwd = G.v3(), up = G.v3(), right = G.v3()
  const sunPos = G.v3()

  const say = (text, sub, dur) => {
    world.messages.push({ text, sub: sub || '', life: dur || 3.4, max: dur || 3.4 })
    if (world.messages.length > 3) world.messages.shift()
  }

  /* -------------------------------------------------------- world setup -- */

  const PLANET = {
    dir: G.vnorm(G.v3(), G.v3(-0.35, -0.12, -0.92)),
    apparent: 0.34,
    colA: new Float32Array([0.20, 0.30, 0.44]),
    colB: new Float32Array([0.44, 0.36, 0.30]),
    atmos: new Float32Array([0.25, 0.45, 0.85]),
    bands: 9
  }

  const spawnAsteroids = (count, spread) => {
    world.asteroids.length = 0
    const start = world.player ? world.player.pos : world.camPos
    for (let i = 0; i < count; i++) {
      const p = G.v3(G.rand(-spread, spread), G.rand(-spread * 0.4, spread * 0.4), G.rand(-spread, spread))
      // Three seconds of clear space ahead of the player's start. Flying into
      // a rock is fatal, and nobody should meet one before they have the
      // stick in their hand.
      if (G.vdist(p, start) < 700) { i--; continue }
      const scale = G.rand(14, 70)
      world.asteroids.push({
        pos: p,
        vel: G.v3(G.rand(-4, 4), G.rand(-2, 2), G.rand(-4, 4)),
        quat: G.qaxis(G.qid(), Math.random(), Math.random(), Math.random(), Math.random() * G.TAU),
        spinAxis: G.vrandom(G.v3()),
        spinRate: G.rand(-0.25, 0.25),
        mesh: G.pick(G.models.asteroids),
        scale,
        radius: scale * 1.15,
        hull: scale * 2.2,
        alive: true
      })
    }
  }

  /** The dreadnought and everything bolted to it. */
  const spawnCapital = () => {
    const q = G.qid()
    G.qaxis(q, 0, 1, 0, 0.42)
    const c = {
      pos: G.v3(1500, -260, -3400),
      quat: q,
      invQuat: new Float32Array([-q[0], -q[1], -q[2], q[3]]),
      vel: G.v3(),
      alive: true,
      hull: 2600 + world.difficulty * 700,
      maxHull: 2600 + world.difficulty * 700,
      shielded: true,
      radius: 1000,
      dying: 0,
      deathTimer: 0,
      flash: 0,
      domes: [],
      // Two ellipsoids stand in for the hull: the wedge, and the bridge tower.
      colliders: [
        { c: G.v3(0, -14, 100), r: G.v3(228, 66, 900) },
        { c: G.v3(0, 96, 666), r: G.v3(62, 74, 84) }
      ],
      engines: [[-150, 8, 934], [-72, 6, 934], [72, 6, 934], [150, 8, 934], [0, -44, 934]]
    }
    // Shield domes down the spine. While any survives the hull shrugs off hits.
    const domeSpots = [[0, 56, -180], [-96, 52, 240], [96, 52, 240]]
    for (const d of domeSpots) {
      c.domes.push({
        local: G.v3(d[0], d[1], d[2]), pos: G.v3(),
        hull: 130, maxHull: 130, radius: 30, alive: true, flash: 0
      })
    }
    world.capital = c

    // Turrets, spread over the dorsal surface and the flanks.
    const spots = [
      [[-120, 46, -300], [0, 1, 0]], [[120, 46, -300], [0, 1, 0]],
      [[-170, 46, 60], [0, 1, 0]], [[170, 46, 60], [0, 1, 0]],
      [[-60, 46, 480], [0, 1, 0]], [[60, 46, 480], [0, 1, 0]],
      [[-215, 20, 700], [-1, 0.25, 0]], [[215, 20, 700], [1, 0.25, 0]],
      [[-150, 12, 300], [-1, 0.3, 0]], [[150, 12, 300], [1, 0.3, 0]]
    ]
    for (const [p, n] of spots) {
      const t = G.Fleet.makeTurret(G.v3(p[0], p[1], p[2]), c, {
        normal: G.v3(n[0], n[1], n[2]),
        hull: 70, fireRate: 2.4 - world.difficulty * 0.15, damage: 16, range: 2200, score: 200
      })
      world.turrets.push(t)
    }
  }

  const spawnWing = n => {
    const p = world.player
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1
      G.qright(right, p.quat)
      G.qforward(fwd, p.quat)
      tmp.x = p.pos.x + right.x * side * (60 + i * 20) - fwd.x * 40
      tmp.y = p.pos.y + right.y * side * (60 + i * 20) - fwd.y * 40 + 10
      tmp.z = p.pos.z + right.z * side * (60 + i * 20) - fwd.z * 40
      const w = G.Fleet.spawn('wingman', tmp, p.quat, { skill: 0.55 + Math.random() * 0.2 })
      w.callsign = ['GOLD 2', 'GOLD 3', 'GOLD 4', 'GOLD 5'][i % 4]
    }
  }

  /* -------------------------------------------------------------- waves -- */

  const spawnWave = () => {
    const p = world.player
    const d = world.difficulty
    const n = 3 + world.wave + Math.min(d * 2, 6)
    const centre = G.v3()
    G.qforward(fwd, p.quat)
    G.vrandom(tmp)
    // In front of the player, more or less, and far enough out to see them come.
    const dist = G.rand(1400, 2000)
    centre.x = p.pos.x + (fwd.x * 0.75 + tmp.x * 0.5) * dist
    centre.y = p.pos.y + (fwd.y * 0.75 + tmp.y * 0.4) * dist
    centre.z = p.pos.z + (fwd.z * 0.75 + tmp.z * 0.5) * dist

    for (let i = 0; i < n; i++) {
      let kind = 'talon'
      const r = Math.random()
      if (world.wave >= 2 && r < 0.22 + d * 0.05) kind = 'interceptor'
      else if (world.wave >= 2 && r < 0.34 + d * 0.05) kind = 'bomber'
      if (d >= 1 && r > 0.9) kind = 'elite'

      tmp2.x = centre.x + G.rand(-260, 260)
      tmp2.y = centre.y + G.rand(-140, 140)
      tmp2.z = centre.z + G.rand(-260, 260)
      G.vsub(tmp3, p.pos, tmp2)
      G.vnorm(tmp3, tmp3)
      const q = G.qlook(G.qid(), tmp3, G.v3(0, 1, 0))
      G.Fleet.spawn(kind, tmp2, q, { skill: G.clamp(0.35 + d * 0.12 + Math.random() * 0.2, 0, 0.95) })
    }
  }

  const enemiesLeft = () => {
    let n = 0
    const ships = G.Fleet.ships
    for (let i = 0; i < ships.length; i++) {
      if (ships[i].alive && ships[i].faction === G.Fleet.IMPERIAL) n++
    }
    return n
  }

  /* ------------------------------------------------------------- stages -- */

  const startPatrol = () => {
    world.stage = 'patrol'
    world.stageName = 'PATROL'
    world.sky = SKIES.patrol
    world.wave = 0
    world.phase = 'wave'
    world.phaseTimer = 2.5
    G.renderer.state.fog = 0
    G.renderer.state.ambTop = [0.16, 0.19, 0.28]
    G.renderer.state.rimCol = [0.16, 0.24, 0.42]
    spawnAsteroids(34, 2600)
    say('SECTOR PATROL', 'ENEMY FIGHTERS INBOUND', 3.6)
    G.Sfx.music('battle')
  }

  const startDreadnought = () => {
    world.stage = 'dreadnought'
    world.stageName = 'DREADNOUGHT'
    world.phase = 'assault'
    world.sky = SKIES.patrol
    spawnCapital()
    say('IMPERIAL DREADNOUGHT', 'KNOCK OUT THE SHIELD DOMES', 4.4)
    G.Sfx.music('battle')
    for (let i = 0; i < 4 + world.difficulty; i++) {
      // Its screen of fighters is already up.
      const c = world.capital
      tmp.x = c.pos.x + G.rand(-500, 500)
      tmp.y = c.pos.y + G.rand(100, 400)
      tmp.z = c.pos.z + G.rand(-600, 600)
      G.Fleet.spawn(Math.random() < 0.3 ? 'interceptor' : 'talon', tmp, null,
        { skill: G.clamp(0.4 + world.difficulty * 0.12 + Math.random() * 0.2, 0, 0.95) })
    }
  }

  const startTrench = () => {
    world.stage = 'trench'
    world.stageName = 'TRENCH RUN'
    world.phase = 'run'
    world.sky = SKIES.station
    world.turrets.length = 0
    world.asteroids.length = 0
    world.capital = null

    if (!world.trench) world.trench = G.buildTrench(G.renderer.gl, 0x51ee7)
    const tr = world.trench
    for (const spot of tr.turrets) {
      world.turrets.push(G.Fleet.makeTurret(
        G.v3(spot.x, spot.y, spot.z), null,
        {
          normal: G.v3(-spot.side, 0.15, 0),
          hull: 34, fireRate: 2.6 - world.difficulty * 0.2, damage: 12, range: 1100, score: 120
        }))
    }

    // The port sits in the trench floor, so a torpedo always comes at it down
    // a shallow slope. The capture radius is deliberately larger than the mesh
    // — this is the shot the whole run is for, and it should reward a lock
    // rather than a pixel-perfect line.
    world.port = {
      pos: G.v3(0, -T.DEPTH + 6, -(tr.length - 700)),
      radius: 24, alive: true, hit: false
    }

    // Reset the player into the mouth of the trench.
    const p = world.player
    G.vset(p.pos, 0, -T.DEPTH * 0.45, -200)
    G.qaxis(p.quat, 0, 1, 0, 0)
    G.vset(p.vel, 0, 0, -p.def.speed)
    p.shield = p.maxShield
    p.torpedoes = Math.max(p.torpedoes, 3)

    // Clear the sky of leftovers and drop a couple of fighters into the run.
    const ships = G.Fleet.ships
    for (let i = ships.length - 1; i >= 0; i--) {
      if (!ships[i].player) ships.splice(i, 1)
    }
    for (let i = 0; i < 2 + world.difficulty; i++) {
      G.Fleet.spawn('talon',
        G.v3(G.rand(-20, 20), -T.DEPTH + 30, -900 - i * 500), null,
        { skill: 0.5, mode: 'corridor' })
    }

    G.renderer.state.fog = 0.00034
    G.renderer.state.fogCol = [0.03, 0.035, 0.045]
    G.renderer.state.ambTop = [0.13, 0.15, 0.20]
    G.renderer.state.rimCol = [0.20, 0.24, 0.34]
    say('TRENCH RUN', 'TORPEDOES ONLY — HIT THE EXHAUST PORT', 4.6)
    G.Sfx.music('trench')
  }

  /* -------------------------------------------------------------- start -- */

  const resetRun = () => {
    G.Fleet.reset()
    G.Fx.reset()
    world.turrets.length = 0
    world.asteroids.length = 0
    world.capital = null
    world.port = null
    world.messages.length = 0
    world.time = 0
    world.score = 0
    world.kills = 0
    world.difficulty = 0
    world.over = false
    world.won = false
    world.shake = 0
    world.hitFlash = 0
    world.warpEffect = 0

    const p = G.Fleet.spawn('vanguard', G.v3(0, 0, 600), null, { player: true })
    p.throttle = 1
    p.torpedoes = 6
    p.maxTorpedoes = 6
    p.boostEnergy = 1
    p.rollInput = 0
    p.deadTimer = 0
    world.player = p
    G.qaxis(p.quat, 0, 1, 0, 0)

    spawnWing(3)
    startPatrol()
  }

  /* ------------------------------------------------------------- player -- */

  const PITCH_RATE = 1.75
  const YAW_RATE = 1.35
  const ROLL_RATE = 2.6

  const updatePlayer = (p, dt, input) => {
    if (!p.alive) return
    const trench = world.stage === 'trench'

    // Stick. Rotations are local, so the controls stay in the pilot's frame
    // whatever mad attitude the ship is in.
    const boostFactor = p.boosting ? 0.72 : 1 // hard to turn at full burn
    G.qrotateLocal(p.quat, 1, 0, 0, input.pitch * PITCH_RATE * boostFactor * dt)
    G.qrotateLocal(p.quat, 0, 1, 0, -input.yaw * YAW_RATE * boostFactor * dt)

    // Roll. A held roll input is a rate, as it should be — but with the stick
    // centred the ship banks into whatever turn it is making and then levels
    // itself, which is the difference between flying and slowly corkscrewing
    // into the floor every time you hold a turn.
    if (input.roll !== 0) G.qrotateLocal(p.quat, 0, 0, 1, -input.roll * ROLL_RATE * dt)
    // A gentle gain, not the AI's: this should settle the wings over a couple
    // of seconds, not wrestle the stick back off a pilot flying inverted.
    else G.Fleet.bankInto(p, -input.yaw * YAW_RATE, dt, 1.1)
    G.qnorm(p.quat)

    // Throttle and boost.
    p.throttle = G.clamp(p.throttle + input.throttle * dt * 1.6, 0.15, 1)
    const wantBoost = input.boost && p.boostEnergy > 0.02
    p.boosting = wantBoost
    p.boostEnergy = G.clamp(p.boostEnergy + (wantBoost ? -0.34 : 0.16) * dt, 0, 1)
    if (trench) {
      // The run is flown flat out; there is no throttling back down there.
      p.throttle = 1
    }

    G.Fleet.applyThrust(p, dt)

    // Guns.
    p.cooldown -= dt
    if (input.fire && p.cooldown <= 0) {
      G.qforward(fwd, p.quat)
      G.Fleet.shoot(p, fwd)
      G.Sfx.blaster(null)
      world.shake = Math.max(world.shake, 0.16)
    }

    // Torpedoes.
    p.torpedoCooldown = Math.max(0, (p.torpedoCooldown || 0) - dt)
    if (input.torpedo && p.torpedoes > 0 && p.torpedoCooldown <= 0) {
      fireTorpedo(p)
    }

    // Shields.
    p.shieldTimer -= dt
    if (p.shieldTimer <= 0 && p.shield < p.maxShield) {
      p.shield = Math.min(p.maxShield, p.shield + p.def.regen * dt)
    }
  }

  const fireTorpedo = p => {
    // Torpedoes track whatever the reticle has a hard lock on — including the
    // exhaust port, which is the only thing that will crack it.
    const target = world.locked ? world.lockTarget : null
    G.qforward(fwd, p.quat)
    G.Fleet.gunWorld(p, 0, tmp)
    tmp.y -= 1.2
    G.Fx.fire({
      pos: tmp, dir: fwd, speed: 620, life: 6,
      damage: 260, length: 10, width: 2.6,
      r: 0.7, g: 1.1, b: 2.4,
      seeking: target, turn: target ? 3.6 : 0,
      owner: p, torpedo: true
    })
    p.torpedoes--
    p.torpedoCooldown = 0.7
    G.Sfx.torpedo(null)
    say('TORPEDO AWAY', '', 1.4)
  }

  /* -------------------------------------------------------------- locks -- */

  /* The reticle keeps a soft lock on whatever is nearest the nose. Holding it
     there long enough arms a torpedo. */
  const updateLock = (p, dt) => {
    G.qforward(fwd, p.quat)
    let best = null
    let bestDot = 0.985

    const consider = (obj, pos, radius) => {
      G.vsub(tmp, pos, p.pos)
      const d = G.vlen(tmp)
      if (d < 30 || d > 3000) return
      const dot = G.vdot(fwd, tmp) / d
      // Bigger things are easier to keep in the box.
      const need = bestDot - G.clamp(radius / d, 0, 0.02)
      if (dot > need) { bestDot = dot; best = obj }
    }

    const ships = G.Fleet.ships
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive || s.faction !== G.Fleet.IMPERIAL) continue
      consider(s, s.pos, s.radius)
    }
    for (let i = 0; i < world.turrets.length; i++) {
      const t = world.turrets[i]
      if (t.alive) consider(t, t.pos, t.radius)
    }
    if (world.capital) {
      for (const d of world.capital.domes) if (d.alive) consider(d, d.pos, d.radius)
    }
    if (world.port && world.port.alive) consider(world.port, world.port.pos, world.port.radius)

    if (best !== world.lockTarget) {
      world.lockTarget = best
      world.lockProgress = 0
      world.locked = false
      if (best) G.Sfx.lock()
    }
    if (world.lockTarget) {
      world.lockProgress = Math.min(1, world.lockProgress + dt / 0.9)
      if (world.lockProgress >= 1 && !world.locked) {
        world.locked = true
        G.Sfx.lockOn()
      }
    }
  }

  /* --------------------------------------------------------- collisions -- */

  /** Segment against an ellipsoid, by squashing the world until it is a unit
      sphere. Used for the capital ship's hull. */
  const segmentEllipsoid = (from, dir, len, centre, radii, invQuat) => {
    // Into the body's frame.
    tmp.x = from.x - centre.x; tmp.y = from.y - centre.y; tmp.z = from.z - centre.z
    if (invQuat) {
      G.qvec(tmp2, invQuat, tmp)
      G.vcopyTo(tmp, tmp2)
      G.qvec(tmp2, invQuat, dir)
    } else {
      G.vcopyTo(tmp2, dir)
    }
    tmp.x /= radii.x; tmp.y /= radii.y; tmp.z /= radii.z
    const dx = tmp2.x * len / radii.x, dy = tmp2.y * len / radii.y, dz = tmp2.z * len / radii.z
    const dl = Math.hypot(dx, dy, dz) || 1e-6
    tmp3.x = dx / dl; tmp3.y = dy / dl; tmp3.z = dz / dl
    return G.segmentSphere(tmp, tmp3, dl, ORIGIN, 1)
  }
  const ORIGIN = G.v3()

  const capitalLocalToWorld = (c, local, out) => {
    G.qvec(out, c.quat, local)
    out.x += c.pos.x; out.y += c.pos.y; out.z += c.pos.z
    return out
  }

  const addScore = n => {
    world.score += n
    if (world.score > world.best) {
      world.best = world.score
      try { global.localStorage.setItem('starfighter.best', String(world.best)) } catch (e) { /* private mode */ }
    }
  }

  const hitPoint = G.v3()

  const boltHits = dt => {
    const bolts = G.Fx.bolts
    const ships = G.Fleet.ships
    const p = world.player

    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i]
      if (!b.alive) continue
      G.vsub(tmp, b.pos, b.prev)
      const len = G.vlen(tmp)
      if (len < 0.0001) continue
      G.vscale(tmp, tmp, 1 / len)
      const dir = G.v3(tmp.x, tmp.y, tmp.z)

      let hit = false

      // Ships.
      for (let j = 0; j < ships.length && !hit; j++) {
        const s = ships[j]
        if (!s.alive) continue
        const enemy = b.hostile ? s.faction === G.Fleet.REBEL : s.faction === G.Fleet.IMPERIAL
        if (!enemy) continue
        if (b.owner === s) continue
        const t = G.segmentSphere(b.prev, dir, len, s.pos, s.radius)
        if (t < 0) continue
        hitPoint.x = b.prev.x + dir.x * len * t
        hitPoint.y = b.prev.y + dir.y * len * t
        hitPoint.z = b.prev.z + dir.z * len * t
        if (b.torpedo) G.Fx.explode(hitPoint, s.vel, 15, { debris: false })
        else G.Fx.impact(hitPoint, b.r * 0.5, b.g * 0.5, b.b * 0.5, 1)
        if (s.player) {
          // The player's hits go through damagePlayer so that dying ends the
          // run rather than quietly removing the ship from the world.
          damagePlayer(b.damage, hitPoint)
        } else if (G.Fleet.damage(s, b.damage, hitPoint) && b.owner && b.owner.player) {
          addScore(s.def.score)
          world.kills++
        }
        hit = true
      }

      // Turrets.
      if (!hit && !b.hostile) {
        for (let j = 0; j < world.turrets.length && !hit; j++) {
          const t = world.turrets[j]
          if (!t.alive) continue
          const f = G.segmentSphere(b.prev, dir, len, t.pos, t.radius)
          if (f < 0) continue
          hitPoint.x = b.prev.x + dir.x * len * f
          hitPoint.y = b.prev.y + dir.y * len * f
          hitPoint.z = b.prev.z + dir.z * len * f
          t.hull -= b.damage
          t.flash = 1
          G.Fx.impact(hitPoint, 1, 0.6, 0.2, 1.2)
          if (t.hull <= 0) {
            t.alive = false
            G.Fx.explode(t.pos, null, 16, { tint: [0.5, 0.53, 0.58] })
            if (b.owner && b.owner.player) { addScore(t.score); world.kills++ }
          }
          hit = true
        }
      }

      // The dreadnought: domes first, then the hull once they are down.
      const c = world.capital
      if (!hit && !b.hostile && c && c.alive) {
        for (let j = 0; j < c.domes.length && !hit; j++) {
          const d = c.domes[j]
          if (!d.alive) continue
          const f = G.segmentSphere(b.prev, dir, len, d.pos, d.radius)
          if (f < 0) continue
          hitPoint.x = b.prev.x + dir.x * len * f
          hitPoint.y = b.prev.y + dir.y * len * f
          hitPoint.z = b.prev.z + dir.z * len * f
          d.hull -= b.damage
          d.flash = 1
          G.Fx.impact(hitPoint, 0.4, 0.9, 1.4, 1.4)
          if (d.hull <= 0) {
            d.alive = false
            G.Fx.explode(d.pos, c.vel, 46, { tint: [0.5, 0.55, 0.6] })
            world.shake = Math.max(world.shake, 0.6)
            if (b.owner && b.owner.player) addScore(1000)
            const left = c.domes.filter(x => x.alive).length
            if (left > 0) say('SHIELD DOME DOWN', left + ' REMAINING', 3)
            else {
              c.shielded = false
              say('SHIELDS DOWN', 'HIT THE ENGINES', 4)
              G.Sfx.powerup()
            }
          }
          hit = true
        }

        if (!hit) {
          for (let j = 0; j < c.colliders.length && !hit; j++) {
            const col = c.colliders[j]
            capitalLocalToWorld(c, col.c, hitPoint)
            const f = segmentEllipsoid(b.prev, dir, len, hitPoint, col.r, c.invQuat)
            if (f < 0) continue
            hitPoint.x = b.prev.x + dir.x * len * f
            hitPoint.y = b.prev.y + dir.y * len * f
            hitPoint.z = b.prev.z + dir.z * len * f
            if (c.shielded) {
              G.Fx.shieldFlare(hitPoint, 0.3, 0.65, 1.3)
              G.Sfx.shieldHit(hitPoint)
            } else {
              // The engine bank is the soft spot.
              let mult = 1
              for (const e of c.engines) {
                tmp3.x = e[0]; tmp3.y = e[1]; tmp3.z = e[2]
                capitalLocalToWorld(c, tmp3, tmp2)
                if (G.vdist(tmp2, hitPoint) < 90) { mult = 3; break }
              }
              c.hull -= b.damage * mult
              c.flash = 1
              G.Fx.impact(hitPoint, 1, 0.7, 0.3, mult > 1 ? 2.4 : 1.5)
              if (b.owner && b.owner.player) addScore(Math.round(b.damage * mult * 0.4))
              if (c.hull <= 0 && !c.dying) startCapitalDeath(c)
            }
            hit = true
          }
        }
      }

      // Asteroids.
      if (!hit) {
        for (let j = 0; j < world.asteroids.length && !hit; j++) {
          const a = world.asteroids[j]
          if (!a.alive) continue
          const f = G.segmentSphere(b.prev, dir, len, a.pos, a.radius)
          if (f < 0) continue
          hitPoint.x = b.prev.x + dir.x * len * f
          hitPoint.y = b.prev.y + dir.y * len * f
          hitPoint.z = b.prev.z + dir.z * len * f
          a.hull -= b.damage
          G.Fx.impact(hitPoint, 1, 0.75, 0.4, 1.6)
          if (a.hull <= 0) {
            a.alive = false
            G.Fx.explode(a.pos, a.vel, a.radius * 1.3, { tint: [0.4, 0.37, 0.34] })
            if (b.owner && b.owner.player) addScore(50)
          }
          hit = true
        }
      }

      // The exhaust port, and the trench itself.
      if (!hit && world.stage === 'trench') {
        const port = world.port
        if (port && port.alive && !b.hostile) {
          const f = G.segmentSphere(b.prev, dir, len, port.pos, port.radius)
          if (f >= 0) {
            hitPoint.x = b.prev.x + dir.x * len * f
            hitPoint.y = b.prev.y + dir.y * len * f
            hitPoint.z = b.prev.z + dir.z * len * f
            if (b.damage >= 200) {
              port.alive = false
              port.hit = true
              startStationDeath()
              if (b.owner && b.owner.player) addScore(10000)
            } else {
              G.Fx.impact(hitPoint, 1, 0.5, 0.2, 2)
            }
            hit = true
          }
        }
        if (!hit) hit = boltHitsTrench(b, dir, len)
      }

      if (hit) b.alive = false
    }
  }

  const boltHitsTrench = (b, dir, len) => {
    const halfW = T.HALF_W
    const p = b.pos
    // Right over the port the floor stops eating ordnance: a torpedo diving
    // into a hole in the deck would otherwise always clip the deck first.
    const port = world.port
    if (port && port.alive && G.vdist2(p, port.pos) < 110 * 110) return false
    let hit = false
    if (Math.abs(p.x) > halfW - 1) hit = true
    else if (p.y < -T.DEPTH + 3) hit = true
    else {
      const tr = world.trench
      for (let i = 0; i < tr.barriers.length; i++) {
        const bar = tr.barriers[i]
        if (Math.abs(p.z - bar.z) > bar.hd + 2) continue
        if (Math.abs(p.x - bar.x) < bar.hw && Math.abs(p.y - bar.y) < bar.hh) { hit = true; break }
      }
    }
    if (hit) G.Fx.impact(b.pos, b.r * 0.5, b.g * 0.5, b.b * 0.5, 1.3)
    return hit
  }

  /** Ramming things. The player is fragile; everything else is scenery. */
  const collidePlayer = dt => {
    const p = world.player
    if (!p.alive || world.demo) return

    for (let i = 0; i < world.asteroids.length; i++) {
      const a = world.asteroids[i]
      if (!a.alive) continue
      if (G.vdist(p.pos, a.pos) < a.radius + p.radius) {
        killPlayer('COLLISION')
        return
      }
    }

    const c = world.capital
    if (c && c.alive) {
      for (const col of c.colliders) {
        capitalLocalToWorld(c, col.c, tmp3)
        G.vsub(tmp, p.pos, tmp3)
        G.qvec(tmp2, c.invQuat, tmp)
        const nx = tmp2.x / col.r.x, ny = tmp2.y / col.r.y, nz = tmp2.z / col.r.z
        if (nx * nx + ny * ny + nz * nz < 1) {
          killPlayer('COLLISION')
          return
        }
      }
    }

    if (world.stage === 'trench' && world.phase === 'run') {
      const lim = T.HALF_W - 5
      let crash = false
      if (Math.abs(p.pos.x) > lim) crash = true
      if (p.pos.y < -T.DEPTH + 7) crash = true
      const tr = world.trench
      for (let i = 0; i < tr.barriers.length && !crash; i++) {
        const bar = tr.barriers[i]
        if (Math.abs(p.pos.z - bar.z) > bar.hd + p.radius) continue
        if (Math.abs(p.pos.x - bar.x) < bar.hw + p.radius * 0.6 &&
            Math.abs(p.pos.y - bar.y) < bar.hh + p.radius * 0.6) crash = true
      }
      if (crash) { killPlayer('CRASHED'); return }

      // Above the lip the surface batteries have a clear shot at you.
      if (p.pos.y > -6) {
        world.exposedTimer = (world.exposedTimer || 0) + dt
        if (world.exposedTimer > 0.4) {
          world.exposedTimer = 0
          damagePlayer(14, p.pos)
          say('GET BACK IN THE TRENCH', 'SURFACE BATTERIES HAVE YOU', 1.2)
        }
      }
    }
  }

  const damagePlayer = (amount, at) => {
    const p = world.player
    if (!p.alive || world.demo) return
    world.hitFlash = 1
    world.shake = Math.max(world.shake, 0.45)
    if (G.Fleet.damage(p, amount, at)) killPlayer('DESTROYED')
  }

  const endRun = reason => {
    if (world.over || world.demo) return
    world.over = true
    // The reason becomes the heading on the game-over panel rather than
    // another line of chatter over the top of it.
    world.overReason = reason
    world.messages.length = 0
    G.Sfx.music(null)
  }

  const killPlayer = reason => {
    const p = world.player
    if (world.demo) return
    if (p.alive) {
      p.alive = false
      p.deadTimer = 0
      G.Fx.explode(p.pos, p.vel, 22, { tint: [0.72, 0.74, 0.78] })
      world.shake = 1.4
    }
    endRun(reason)
  }

  /* --------------------------------------------------------- big deaths -- */

  const startCapitalDeath = c => {
    c.dying = 1
    c.deathTimer = 0
    c.alive = false
    say('DREADNOUGHT BREAKING UP', 'GET CLEAR', 4)
    addScore(6000)
    G.Sfx.music(null)
    for (const t of world.turrets) t.alive = false
  }

  const updateCapitalDeath = (c, dt) => {
    c.deathTimer += dt
    // A chain of explosions walks down the hull before the whole thing goes.
    if (Math.random() < dt * 14) {
      tmp3.x = G.rand(-200, 200)
      tmp3.y = G.rand(-60, 50)
      tmp3.z = G.rand(-800, 900)
      capitalLocalToWorld(c, tmp3, tmp2)
      G.Fx.explode(tmp2, c.vel, G.rand(20, 60), { tint: [0.5, 0.53, 0.58] })
    }
    if (c.deathTimer > 4.2) {
      capitalLocalToWorld(c, G.v3(0, 0, 200), tmp2)
      G.Fx.explode(tmp2, c.vel, 260, { debris: true, tint: [0.55, 0.58, 0.62] })
      world.shake = 2
      world.capital = null
      world.phase = 'clear'
      world.phaseTimer = 3.5
    }
  }

  const startStationDeath = () => {
    world.phase = 'escape'
    world.escapeTimer = 0
    say('DIRECT HIT', 'GET OUT OF THE TRENCH', 4)
    world.shake = 1.2
    G.Sfx.explosion(4, null)
    G.Sfx.music(null)
  }

  /* ------------------------------------------------------------- camera -- */

  const updateCamera = (dt, first) => {
    const p = world.player
    G.qforward(fwd, p.quat)
    G.qup(up, p.quat)
    G.qright(right, p.quat)

    const speed = G.vlen(p.vel)
    if (world.view === 1 && p.alive) {
      // Cockpit: sit on the nose, no smoothing, so the ship feels welded on.
      camTarget.x = p.pos.x + up.x * 1.2 - fwd.x * 0.4
      camTarget.y = p.pos.y + up.y * 1.2 - fwd.y * 0.4
      camTarget.z = p.pos.z + up.z * 1.2 - fwd.z * 0.4
      G.vcopyTo(cam.pos, camTarget)
      cam.quat.set(p.quat)
    } else {
      const back = 21 + speed * 0.035
      const high = 5.2
      camTarget.x = p.pos.x - fwd.x * back + up.x * high
      camTarget.y = p.pos.y - fwd.y * back + up.y * high
      camTarget.z = p.pos.z - fwd.z * back + up.z * high
      if (first) {
        G.vcopyTo(cam.pos, camTarget)
        cam.quat.set(p.quat)
      } else {
        // A spring on the position and a slerp on the orientation: the camera
        // lags a hard turn just enough to sell the speed.
        const k = 1 - Math.exp(-11 * dt)
        cam.pos.x += (camTarget.x - cam.pos.x) * k
        cam.pos.y += (camTarget.y - cam.pos.y) * k
        cam.pos.z += (camTarget.z - cam.pos.z) * k
        camQuatTarget.set(p.quat)
        G.qslerp(cam.quat, cam.quat, camQuatTarget, 1 - Math.exp(-9 * dt))
      }
    }

    // Shake, applied after the smoothing so it never gets damped away.
    if (world.shake > 0.001) {
      const s = world.shake
      cam.pos.x += G.rand(-1, 1) * s * 1.5
      cam.pos.y += G.rand(-1, 1) * s * 1.5
      cam.pos.z += G.rand(-1, 1) * s * 1.5
      G.qrotateLocal(cam.quat, 1, 0, 0, G.rand(-1, 1) * s * 0.012)
      G.qrotateLocal(cam.quat, 0, 0, 1, G.rand(-1, 1) * s * 0.02)
      world.shake = Math.max(0, world.shake - dt * (1.6 + world.shake))
    }

    // Speed widens the lens.
    const targetFov = 1.06 + G.clamp(speed / 340, 0, 1) * 0.24 + world.warpEffect * 0.35
    cam.fov = G.damp(cam.fov, targetFov, 6, dt)

    G.vcopyTo(world.camPos, cam.pos)
    world.camQuat.set(cam.quat)
    G.qright(tmp, cam.quat)
    G.Sfx.listen(cam.pos, tmp)
  }

  /* ------------------------------------------------------------- update -- */

  const updateStage = dt => {
    // The world keeps moving under the game-over panel, but the mission does
    // not: no new waves, and no finishing a trench run you did not survive.
    if (world.over) return
    world.phaseTimer -= dt

    if (world.stage === 'patrol') {
      world.objective = 'CLEAR THE SECTOR  ·  WAVE ' + Math.max(1, world.wave) + '/' + world.waves
      if (world.phase === 'wave' && world.phaseTimer <= 0) {
        world.wave++
        if (world.wave > world.waves) {
          world.phase = 'done'
          world.phaseTimer = 2.5
          say('SECTOR CLEAR', 'CAPITAL SHIP INBOUND', 3.4)
        } else {
          spawnWave()
          world.phase = 'fighting'
          say('WAVE ' + world.wave, 'INCOMING', 2.2)
        }
      } else if (world.phase === 'fighting' && enemiesLeft() === 0) {
        world.phase = 'wave'
        world.phaseTimer = 3
        addScore(500 * world.wave)
      } else if (world.phase === 'done' && world.phaseTimer <= 0) {
        startDreadnought()
      }
    } else if (world.stage === 'dreadnought') {
      const c = world.capital
      if (c) {
        const domesLeft = c.domes.filter(d => d.alive).length
        world.objective = domesLeft > 0
          ? 'DESTROY SHIELD DOMES  ·  ' + domesLeft + ' LEFT'
          : 'DESTROY THE DREADNOUGHT  ·  ' + Math.max(0, Math.round(c.hull / c.maxHull * 100)) + '%'
        // Keep a screen of fighters up while the capital ship lives.
        world.spawnTimer = (world.spawnTimer || 0) - dt
        if (world.spawnTimer <= 0 && enemiesLeft() < 6 + world.difficulty) {
          world.spawnTimer = 6
          tmp.x = c.pos.x + G.rand(-700, 700)
          tmp.y = c.pos.y + G.rand(100, 500)
          tmp.z = c.pos.z + G.rand(-700, 700)
          G.Fleet.spawn(Math.random() < 0.4 ? 'interceptor' : 'talon', tmp, null,
            { skill: G.clamp(0.4 + world.difficulty * 0.1 + Math.random() * 0.2, 0, 0.95) })
        }
      } else if (world.phase === 'clear') {
        world.objective = 'REGROUP'
        if (world.phaseTimer <= 0) startTrench()
      }
    } else if (world.stage === 'trench') {
      const p = world.player
      if (world.phase === 'run') {
        const dist = Math.max(0, p.pos.z - world.port.pos.z)
        world.objective = 'EXHAUST PORT  ·  ' + (dist / 1000).toFixed(1) + ' KM'
        if (p.pos.z < world.port.pos.z - 300) {
          // Overshot the port: the run is blown, but the station gets a say.
          say('MISSED THE PORT', 'PULLING UP', 3)
          world.phase = 'escape'
          world.escapeTimer = 0
          world.missed = true
        }
      } else if (world.phase === 'escape') {
        // The escape runs on its own clock: phaseTimer counts down for every
        // other phase, and this one needs to count up.
        world.objective = 'GET CLEAR'
        world.escapeTimer += dt
        const t = world.escapeTimer
        // Hand the stick a nudge upward: nobody should lose the run to the
        // trench floor after they have already put a torpedo in the port.
        if (t < 1.6 && p.alive) G.qrotateLocal(p.quat, 1, 0, 0, 0.85 * dt)
        if (t > 1.2 && t < 3.4 && Math.random() < dt * 12) {
          tmp.x = p.pos.x + G.rand(-400, 400)
          tmp.y = p.pos.y + G.rand(-200, 300)
          tmp.z = p.pos.z + G.rand(-1500, 200)
          if (!world.missed) G.Fx.explode(tmp, null, G.rand(30, 90), { tint: [0.5, 0.5, 0.55] })
        }
        if (t > 2.4) {
          world.warpEffect = G.clamp(world.warpEffect + dt * 0.8, 0, 1)
          p.boosting = true
        }
        if (t > 3.2 && !world.jumped) {
          world.jumped = true
          G.Sfx.hyperspace()
        }
        if (t > 4.6) {
          // Next tour of duty, one notch harder.
          world.jumped = false
          world.missed = false
          world.warpEffect = 0
          world.difficulty++
          addScore(5000)
          G.Fx.reset()
          const ships = G.Fleet.ships
          for (let i = ships.length - 1; i >= 0; i--) if (!ships[i].player) ships.splice(i, 1)
          G.vset(p.pos, 0, 0, 600)
          G.vset(p.vel, 0, 0, -p.def.speed)
          G.qaxis(p.quat, 0, 1, 0, 0)
          p.shield = p.maxShield
          p.hull = p.maxHull
          p.torpedoes = p.maxTorpedoes
          world.port = null
          world.turrets.length = 0
          G.renderer.state.fog = 0
          spawnWing(3)
          startPatrol()
          say('SECTOR ' + (world.difficulty + 1), 'THE WAR IS NOT OVER', 3.6)
          updateCamera(0.016, true)
        }
      }
    }
  }

  const update = (dt, input) => {
    world.time += dt
    world.sky.time = world.time

    const p = world.player
    if (p.alive) {
      updatePlayer(p, dt, input)
      updateLock(p, dt)
    } else {
      p.deadTimer += dt
      // Whatever took the player out — a bolt, a wall, an asteroid — the run
      // is over. This is the one place that is guaranteed to notice.
      endRun('DESTROYED')
    }

    G.Fleet.update(dt, world)
    G.Fx.update(dt)

    for (let i = 0; i < world.turrets.length; i++) G.Fleet.updateTurret(world.turrets[i], dt, world)

    for (let i = 0; i < world.asteroids.length; i++) {
      const a = world.asteroids[i]
      if (!a.alive) continue
      G.vmad(a.pos, a.vel, dt)
      G.qrotateLocal(a.quat, a.spinAxis.x, a.spinAxis.y, a.spinAxis.z, a.spinRate * dt)
    }

    const c = world.capital
    if (c) {
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 4)
      for (const d of c.domes) {
        capitalLocalToWorld(c, d.local, d.pos)
        if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 5)
      }
      if (c.dying) updateCapitalDeath(c, dt)
    }

    boltHits(dt)
    collidePlayer(dt)
    updateStage(dt)
    updateCamera(dt, false)

    // Screen effects.
    world.hitFlash = Math.max(0, world.hitFlash - dt * 2.6)
    const st = G.renderer.state
    st.tintAmount = world.hitFlash * 0.5
    st.flash = world.warpEffect * 0.08
    st.warp = world.warpEffect
    st.vignette = 0.42 + world.hitFlash * 0.25

    for (let i = world.messages.length - 1; i >= 0; i--) {
      world.messages[i].life -= dt
      if (world.messages[i].life <= 0) world.messages.splice(i, 1)
    }

    G.Sfx.engine(p.alive ? (p.boosting ? 1.5 : p.throttle) : 0)
  }

  /* --------------------------------------------------------------- draw -- */

  const drawTrench = R => {
    const tr = world.trench
    const p = world.player
    const chunk = G.clamp(Math.floor(-p.pos.z / T.CHUNK), 0, T.CHUNKS - 1)
    // Only the chunks around the player, which is what keeps a fourteen
    // kilometre corridor as cheap as a couple of fighters.
    const from = Math.max(0, chunk - 2)
    const to = Math.min(T.CHUNKS - 1, chunk + 7)
    for (let i = from; i <= to; i++) {
      G.vset(tmp, 0, 0, 0)
      R.staticMesh(tr.chunks[i], tmp)
    }
    // Barriers are one 2m cube stretched to size, so a hundred of them cost a
    // hundred draws of twelve triangles rather than a hundred meshes.
    for (let i = 0; i < tr.barriers.length; i++) {
      const b = tr.barriers[i]
      if (b.z > p.pos.z + 400 || b.z < p.pos.z - 3200) continue
      G.vset(tmp, b.x, b.y, b.z)
      R.meshScaled(tr.barrierMesh, tmp, null, b.hw, b.hh, b.hd, null)
    }
    if (world.port && world.port.alive) {
      R.mesh(tr.portMesh, world.port.pos, null, 1, null)
    }
  }

  const draw = R => {
    const p = world.player
    const hidePlayer = (world.view === 1 && p.alive) || !p.alive

    R.begin(cam)
    R.background(world.sky)
    if (world.stage !== 'trench') {
      R.planet(PLANET.dir, PLANET.apparent, PLANET.colA, PLANET.colB, PLANET.atmos, PLANET.bands)
    }
    R.scene()

    G.Fleet.draw(R, hidePlayer)

    for (let i = 0; i < world.asteroids.length; i++) {
      const a = world.asteroids[i]
      if (a.alive) R.mesh(a.mesh, a.pos, a.quat, a.scale, null)
    }

    const c = world.capital
    if (c) {
      R.mesh(G.models.dreadnought, c.pos, c.quat, 1, {
        flash: c.flash * 0.4,
        tint: c.flash > 0.02 ? CAP_FLASH : null
      })
      for (const d of c.domes) {
        if (d.alive) R.mesh(G.models.dome, d.pos, c.quat, 1, { flash: d.flash * 0.5 })
      }
    }

    for (let i = 0; i < world.turrets.length; i++) G.Fleet.drawTurret(R, world.turrets[i])

    if (world.stage === 'trench') drawTrench(R)

    G.Fx.drawMeshes(R)

    /* ---- additive pass ---- */

    G.Fleet.drawFx(R, hidePlayer)
    G.Fx.drawFx(R)

    // The star, with a flare that swells as you look into it.
    G.vscale(sunPos, G.renderer.state.light, 6000)
    G.vadd(sunPos, sunPos, cam.pos)
    G.qforward(fwd, cam.quat)
    const facing = G.clamp(G.vdot(fwd, G.renderer.state.light), 0, 1)
    R.sprite(sunPos, 900, 1.6, 1.45, 1.2, 0.95, G.SPRITE.DOT, 0)
    R.sprite(sunPos, 2400 + facing * 2600, 1.2, 1.0, 0.75, 0.5 * facing, G.SPRITE.FLARE, 0)

    if (c) {
      // Engine glow on the dreadnought's stern.
      for (const e of c.engines) {
        tmp3.x = e[0]; tmp3.y = e[1]; tmp3.z = e[2]
        capitalLocalToWorld(c, tmp3, tmp)
        R.sprite(tmp, 150, 0.5, 0.85, 1.3, 0.8, G.SPRITE.DOT, 0)
        R.sprite(tmp, 380, 0.35, 0.6, 1.1, 0.35, G.SPRITE.DOT, 0)
      }
      if (c.shielded) {
        // A faint shield bubble, only visible from certain angles.
        R.sprite(c.pos, 2600, 0.12, 0.24, 0.55, 0.055, G.SPRITE.RING, 0)
      }
    }

    if (world.port && world.port.alive && world.stage === 'trench') {
      R.sprite(world.port.pos, 44, 1.4, 0.55, 0.25, 0.8, G.SPRITE.DOT, 0)
      R.sprite(world.port.pos, 120, 1.2, 0.4, 0.15, 0.3, G.SPRITE.RING, world.time)
    }

    R.end(world.time)
  }

  const CAP_FLASH = new Float32Array([1.2, 0.8, 0.7])

  /* ---------------------------------------------------------------- api -- */

  G.Game = {
    world,
    cam,
    /** `demo` runs the same world with an invulnerable player, which is what
        idles behind the title screen. */
    start (demo) {
      world.demo = !!demo
      resetRun()
      updateCamera(0.016, true)
      try {
        world.best = parseInt(global.localStorage.getItem('starfighter.best') || '0', 10) || 0
      } catch (e) { world.best = 0 }
    },
    update,
    draw,
    say,
    toggleView () {
      world.view = world.view ? 0 : 1
      G.Sfx.ui()
    },
    get over () { return world.over }
  }
})(window)
