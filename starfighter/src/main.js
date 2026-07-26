/* Bootstrap: input, the frame loop, and the watchdog that trades resolution
   for frame rate when the device cannot keep up.

   Three control schemes share one virtual stick — mouse position, keys, and a
   thumb drag — so the game plays the same whether it is a desktop, a laptop
   trackpad or a phone. */
(function (global) {
  'use strict'

  const G = global.G

  const glCanvas = document.getElementById('view')
  const hudCanvas = document.getElementById('hud')
  const hint = document.getElementById('hint')
  const pad = document.getElementById('pad')

  const TOUCH = global.matchMedia('(pointer: coarse)').matches

  let state = 'menu'
  let width = 0, height = 0, dpr = 1
  let renderScale = 1
  let lastTime = 0
  let fpsShown = 0
  let fpsAccum = 0, fpsFrames = 0
  let showFps = false

  /* --------------------------------------------------------------- input -- */

  const input = {
    pitch: 0, yaw: 0, roll: 0, throttle: 0,
    fire: false, boost: false, torpedo: false
  }

  const keys = Object.create(null)
  const mouse = { x: 0, y: 0, active: false, down: false }
  const touchStick = { id: -1, x0: 0, y0: 0, x: 0, y: 0, active: false }
  const buttons = { fire: false, boost: false, torpedo: false }

  const DEAD = 0.06

  /** Map a raw stick deflection to a control input: a dead zone in the middle,
      then a squared response so small corrections stay small. */
  const curve = v => {
    const a = Math.abs(v)
    if (a < DEAD) return 0
    const s = (a - DEAD) / (1 - DEAD)
    return Math.sign(v) * s * s
  }

  const readInput = () => {
    let px = 0, py = 0

    if (TOUCH) {
      if (touchStick.active) {
        const r = Math.min(width, height) * 0.18
        px = G.clamp((touchStick.x - touchStick.x0) / r, -1, 1)
        py = G.clamp((touchStick.y - touchStick.y0) / r, -1, 1)
      }
    } else if (mouse.active) {
      const r = Math.min(width, height) * 0.34
      px = G.clamp((mouse.x - width / 2) / r, -1, 1)
      py = G.clamp((mouse.y - height / 2) / r, -1, 1)
    }

    // Keys override the pointer when they are held, so either works any time.
    let kx = 0, ky = 0
    if (keys.ArrowLeft || keys.KeyA) kx -= 1
    if (keys.ArrowRight || keys.KeyD) kx += 1
    if (keys.ArrowUp || keys.KeyW) ky -= 1
    if (keys.ArrowDown || keys.KeyS) ky += 1
    if (kx || ky) { px = kx; py = ky }

    input.yaw = curve(px)
    // Screen down is nose up: the classic pull-back-to-climb mapping.
    input.pitch = -curve(py)

    let roll = 0
    if (keys.KeyQ) roll -= 1
    if (keys.KeyE) roll += 1
    input.roll = roll

    let th = 0
    if (keys.KeyZ) th -= 1
    if (keys.KeyX) th += 1
    input.throttle = th

    input.fire = !!(keys.Space || mouse.down || buttons.fire)
    input.boost = !!(keys.ShiftLeft || keys.ShiftRight || buttons.boost)
    input.torpedo = !!(keys.KeyF || buttons.torpedo)
    if (buttons.torpedo) buttons.torpedo = false // one shot per press
  }

  const clearInput = () => {
    input.pitch = input.yaw = input.roll = input.throttle = 0
    input.fire = input.boost = input.torpedo = false
  }

  /* -------------------------------------------------------------- states -- */

  const launch = () => {
    G.Sfx.resume()
    G.Game.start(false)
    state = 'playing'
    if (hint) hint.style.display = 'none'
    document.body.classList.add('flying')
  }

  const togglePause = () => {
    if (state === 'playing') {
      state = 'paused'
      G.Sfx.duck(true)
    } else if (state === 'paused') {
      state = 'playing'
      G.Sfx.duck(false)
    }
  }

  const primary = () => {
    // Whatever the current screen is, the big obvious action.
    G.Sfx.resume()
    if (state === 'menu') launch()
    else if (state === 'over') launch()
    else if (state === 'paused') togglePause()
  }

  const fullscreen = () => {
    const el = document.documentElement
    if (document.fullscreenElement) document.exitFullscreen()
    else if (el.requestFullscreen) el.requestFullscreen()
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
  }

  /* ------------------------------------------------------------ listeners -- */

  global.addEventListener('keydown', e => {
    if (e.code === 'F5' || e.code === 'F12' || e.metaKey || e.ctrlKey) return
    keys[e.code] = true
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].indexOf(e.code) >= 0) {
      e.preventDefault()
    }
    if (e.code === 'Enter') primary()
    else if (e.code === 'KeyP' || e.code === 'Escape') togglePause()
    else if (e.code === 'KeyM') G.Sfx.toggleMute()
    else if (e.code === 'KeyC' && state === 'playing') G.Game.toggleView()
    else if (e.code === 'KeyI') showFps = !showFps
    else if (e.code === 'KeyF' && e.shiftKey) fullscreen()
  })

  global.addEventListener('keyup', e => { keys[e.code] = false })
  global.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false
    if (state === 'playing') togglePause()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause()
  })

  if (!TOUCH) {
    global.addEventListener('mousemove', e => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
    })
    global.addEventListener('mouseleave', () => { mouse.active = false })
    global.addEventListener('mousedown', e => {
      if (e.target.closest && e.target.closest('.ui')) return
      if (e.button === 0) {
        if (state !== 'playing') primary()
        else mouse.down = true
      } else if (e.button === 2 && state === 'playing') {
        buttons.torpedo = true
      }
      e.preventDefault()
    })
    global.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false })
    global.addEventListener('contextmenu', e => e.preventDefault())
  }

  /* Touch: the left two thirds of the screen is the stick, the buttons on the
     right are their own elements. */
  glCanvas.addEventListener('touchstart', e => {
    e.preventDefault()
    G.Sfx.resume()
    if (state !== 'playing') { primary(); return }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (touchStick.id < 0 && t.clientX < width * 0.62) {
        touchStick.id = t.identifier
        touchStick.x0 = t.clientX; touchStick.y0 = t.clientY
        touchStick.x = t.clientX; touchStick.y = t.clientY
        touchStick.active = true
      }
    }
  }, { passive: false })

  const touchMove = e => {
    e.preventDefault()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (t.identifier === touchStick.id) {
        touchStick.x = t.clientX
        touchStick.y = t.clientY
      }
    }
  }
  glCanvas.addEventListener('touchmove', touchMove, { passive: false })

  const touchEnd = e => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchStick.id) {
        touchStick.id = -1
        touchStick.active = false
      }
    }
  }
  glCanvas.addEventListener('touchend', touchEnd)
  glCanvas.addEventListener('touchcancel', touchEnd)

  const holdButton = (el, name) => {
    if (!el) return
    const on = e => { e.preventDefault(); G.Sfx.resume(); buttons[name] = true }
    const off = e => { e.preventDefault(); buttons[name] = false }
    el.addEventListener('touchstart', on, { passive: false })
    el.addEventListener('touchend', off)
    el.addEventListener('touchcancel', off)
    el.addEventListener('mousedown', on)
    el.addEventListener('mouseup', off)
  }
  holdButton(document.getElementById('btn-fire'), 'fire')
  holdButton(document.getElementById('btn-boost'), 'boost')

  const torpedoBtn = document.getElementById('btn-torpedo')
  if (torpedoBtn) {
    const tap = e => { e.preventDefault(); buttons.torpedo = true }
    torpedoBtn.addEventListener('touchstart', tap, { passive: false })
    torpedoBtn.addEventListener('mousedown', tap)
  }

  if (pad) {
    pad.addEventListener('click', e => {
      const act = e.target.getAttribute('data-act')
      if (!act) return
      if (act === 'pause') togglePause()
      else if (act === 'mute') G.Sfx.toggleMute()
      else if (act === 'full') fullscreen()
      else if (act === 'view') G.Game.toggleView()
      e.stopPropagation()
    })
  }

  /* -------------------------------------------------------------- resize -- */

  const resize = () => {
    width = global.innerWidth
    height = global.innerHeight
    // Phones have more pixels than fill rate; cap them harder than desktops.
    dpr = Math.min(TOUCH ? 1.75 : 2, global.devicePixelRatio || 1)
    G.renderer.resize(width, height, dpr, renderScale)
    G.Hud.resize(width, height, dpr)
  }

  global.addEventListener('resize', resize)
  global.addEventListener('orientationchange', () => setTimeout(resize, 120))

  /* ---------------------------------------------------- quality watchdog -- */

  /* Rather than guess at the device, watch the actual frame times: if the
     renderer is missing 60fps for a while, shrink the internal target; if it
     has headroom to spare, hand the pixels back. */
  const perf = { slow: 0, fast: 0 }
  const SCALES = [0.55, 0.7, 0.85, 1]
  let scaleIndex = SCALES.length - 1

  const watchdog = frameMs => {
    if (frameMs > 21) {
      perf.slow += frameMs / 1000
      perf.fast = 0
    } else if (frameMs < 14) {
      perf.fast += frameMs / 1000
      perf.slow = 0
    }

    if (perf.slow > 1.2) {
      perf.slow = 0
      if (scaleIndex > 0) {
        scaleIndex--
        renderScale = SCALES[scaleIndex]
        resize()
      } else if (G.renderer.state.bloom > 0) {
        // Last resort: drop the post chain entirely.
        G.renderer.state.bloom = 0
        G.renderer.state.quality = 0
      }
    } else if (perf.fast > 4 && scaleIndex < SCALES.length - 1 && G.renderer.state.quality > 0) {
      perf.fast = 0
      scaleIndex++
      renderScale = SCALES[scaleIndex]
      resize()
    }
  }

  /* ---------------------------------------------------------------- loop -- */

  const frame = now => {
    global.requestAnimationFrame(frame)
    const elapsed = lastTime ? now - lastTime : 16.7
    lastTime = now
    const dt = Math.min(0.05, elapsed / 1000)

    fpsAccum += elapsed
    fpsFrames++
    if (fpsAccum > 500) {
      fpsShown = Math.round(1000 / (fpsAccum / fpsFrames))
      fpsAccum = 0; fpsFrames = 0
    }
    watchdog(elapsed)

    const world = G.Game.world

    if (state === 'playing') {
      readInput()
      G.Game.update(dt, input)
      if (world.over) state = 'over'
    } else if (state === 'over') {
      // Keep the world running under the game-over panel: the wreck tumbles,
      // the battle carries on without you, and the moment lands better than a
      // freeze-frame would.
      clearInput()
      G.Game.update(dt, input)
    } else if (state === 'menu') {
      // The battle carries on behind the menu, flown by nobody.
      clearInput()
      input.pitch = Math.sin(world.time * 0.21) * 0.09
      input.yaw = Math.sin(world.time * 0.13) * 0.12
      G.Game.update(dt, input)
    } else {
      clearInput()
      G.Sfx.engine(0)
    }

    G.Game.draw(G.renderer)
    G.Hud.draw(state, world, G.renderer, TOUCH, showFps ? fpsShown : 0)
  }

  /* ---------------------------------------------------------------- boot -- */

  const fail = msg => {
    const el = document.createElement('div')
    el.id = 'fail'
    el.innerHTML = '<h1>NO WEBGL</h1><p>' + msg + '</p>'
    document.body.appendChild(el)
  }

  try {
    if (!G.renderer.init(glCanvas)) {
      fail('This browser could not give the game a WebGL context. Try a different browser, or check that hardware acceleration is switched on.')
      return
    }
  } catch (err) {
    fail(String(err && err.message ? err.message : err))
    return
  }

  G.Hud.init(hudCanvas)
  resize()
  G.Game.start(true)
  global.requestAnimationFrame(frame)
})(window)
