/* Bootstrap: canvas scaling, input, and the fixed-timestep game loop.

   Touch uses two floating thumbsticks — left half of the glass steers, right
   half aims and fires — which is the modern answer to the arcade's eight-way
   joystick and fire button. Neither stick is drawn until a thumb lands, and
   each appears wherever that thumb happens to be, so nothing has to be aimed
   for blind. */
(function (global) {
  'use strict'

  const G = global.G
  const canvas = document.getElementById('screen')
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.imageSmoothingEnabled = false

  const game = new G.Game(ctx)
  global.game = game // handy for poking around in the console

  /* --- Input --------------------------------------------------------------- */

  const input = {
    move: { x: 0, y: 0 },
    aim: null,
    fire: false,
    firePressed: false,
    magicPressed: false,
    startPressed: false,
    selectPressed: 0
  }

  const held = new Set()

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    Space: 'fire',
    Enter: 'start', NumpadEnter: 'start',
    KeyQ: 'magic', ShiftLeft: 'magic', ShiftRight: 'magic', KeyE: 'magic'
  }

  const keys = { left: false, right: false, up: false, down: false }

  /* --- Presentation helpers (declared early; used by input) ---------------- */

  function toggleFullscreen () {
    const el = document.documentElement
    if (document.fullscreenElement) document.exitFullscreen()
    else if (el.requestFullscreen) el.requestFullscreen()
  }

  let syncPad = () => {}

  function togglePause () {
    game.paused = !game.paused
    G.Sfx.resume()
    if (game.paused) G.Sfx.music.stop()
    else if (game.state === 'playing') G.Sfx.music.start(game.level)
    syncPad()
  }

  function toggleMute () {
    G.Sfx.init()
    G.Sfx.toggleMute()
    syncPad()
  }

  /* --- Keyboard ------------------------------------------------------------ */

  global.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (e.code === 'KeyP') {
      togglePause()
      e.preventDefault()
      return
    }
    if (e.code === 'KeyM') {
      toggleMute()
      e.preventDefault()
      return
    }
    if (e.code === 'KeyF') {
      toggleFullscreen()
      e.preventDefault()
      return
    }

    const action = KEYMAP[e.code]
    if (!action) return
    e.preventDefault()
    G.Sfx.resume()
    if (held.has(e.code)) return
    held.add(e.code)

    if (action === 'fire') {
      input.fire = true
      input.firePressed = true
    } else if (action === 'start') {
      input.startPressed = true
    } else if (action === 'magic') {
      input.magicPressed = true
    } else {
      keys[action] = true
      // On the character-select screen the vertical keys move the highlight.
      if (game.state === 'select') {
        if (action === 'up') input.selectPressed = -1
        if (action === 'down') input.selectPressed = 1
      }
    }
  })

  global.addEventListener('keyup', e => {
    const action = KEYMAP[e.code]
    if (!action) return
    e.preventDefault()
    held.delete(e.code)

    const stillHeld = Object.keys(KEYMAP).some(c => KEYMAP[c] === action && held.has(c))
    if (stillHeld) return
    if (action === 'fire') input.fire = false
    else if (action !== 'start' && action !== 'magic') keys[action] = false
  })

  global.addEventListener('blur', () => {
    held.clear()
    keys.left = keys.right = keys.up = keys.down = false
    input.fire = false
    sticks.clear()
    refreshSticks()
  })

  /* --- Touch: two floating thumbsticks ------------------------------------- */

  const STICK_RADIUS = 34 // logical px from origin for a full-tilt reading
  const DEAD_ZONE = 5
  const TAP_SLOP = 8 // a drag shorter than this counts as a tap, not a stick

  /** pointerId -> {side, ox, oy, x, y, moved} in logical screen coordinates. */
  const sticks = new Map()

  function metrics () {
    const r = canvas.getBoundingClientRect()
    return { r, scale: r.width > 0 ? r.width / G.W : 1 }
  }

  /** Convert a client point into the canvas's logical coordinate space. Points
      outside the canvas are allowed: a thumb resting below the playfield still
      has to drive a stick. */
  function toLogical (clientX, clientY) {
    const m = metrics()
    return {
      x: (clientX - m.r.left) / m.scale,
      y: (clientY - m.r.top) / m.scale
    }
  }

  function isControl (target) {
    return !!(target && target.closest && target.closest('.ui'))
  }

  /** Recompute the input vectors from whatever sticks are currently down. */
  function refreshSticks () {
    let mx = 0
    let my = 0
    let aim = null
    let firing = false

    for (const s of sticks.values()) {
      const dx = s.x - s.ox
      const dy = s.y - s.oy
      const len = Math.hypot(dx, dy)

      if (s.side === 'move') {
        if (len > DEAD_ZONE) {
          const t = Math.min(1, len / STICK_RADIUS)
          mx = (dx / len) * t
          my = (dy / len) * t
        }
      } else {
        firing = true // holding the right side fires, tilted or not
        if (len > DEAD_ZONE) aim = { x: dx, y: dy }
      }
    }

    input.move.x = mx
    input.move.y = my
    input.aim = aim
    // The right stick and the fire key are the two ways to hold fire down.
    input.fire = firing || held.has('Space')
  }

  global.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || isControl(e.target)) return
    e.preventDefault()
    G.Sfx.resume()

    const p = toLogical(e.clientX, e.clientY)

    // Character select is a menu, not a battlefield: tapping a row picks it.
    if (game.state === 'select') {
      const row = game.heroRowAt(p.x, p.y)
      if (row >= 0) {
        game.selected = row
        G.Sfx.select()
      }
      input.startPressed = true
      return
    }
    if (game.state === 'gameover') {
      input.startPressed = true
      return
    }

    const side = e.clientX < global.innerWidth / 2 ? 'move' : 'aim'
    sticks.set(e.pointerId, { side, ox: p.x, oy: p.y, x: p.x, y: p.y, moved: false })
    if (side === 'aim') input.firePressed = true
    refreshSticks()
  }, { passive: false })

  global.addEventListener('pointermove', e => {
    const s = sticks.get(e.pointerId)
    if (!s) return
    e.preventDefault()
    const p = toLogical(e.clientX, e.clientY)
    s.x = p.x
    s.y = p.y
    if (Math.hypot(s.x - s.ox, s.y - s.oy) > TAP_SLOP) s.moved = true
    refreshSticks()
  }, { passive: false })

  const endStick = e => {
    if (!sticks.delete(e.pointerId)) return
    refreshSticks()
  }

  global.addEventListener('pointerup', endStick)
  global.addEventListener('pointercancel', endStick)
  global.addEventListener('contextmenu', e => {
    if (!isControl(e.target)) e.preventDefault()
  })

  /* --- Mouse (desktop): aim and fire toward the cursor --------------------- */

  let mouseDown = false
  let mousePos = null

  canvas.addEventListener('mousedown', e => {
    G.Sfx.resume()
    if (game.state === 'select') {
      const p = toLogical(e.clientX, e.clientY)
      const row = game.heroRowAt(p.x, p.y)
      if (row >= 0) game.selected = row
      input.startPressed = true
      return
    }
    if (game.state === 'gameover') {
      input.startPressed = true
      return
    }
    mouseDown = true
    mousePos = toLogical(e.clientX, e.clientY)
    input.firePressed = true
  })

  global.addEventListener('mousemove', e => {
    if (!mouseDown) return
    mousePos = toLogical(e.clientX, e.clientY)
  })

  global.addEventListener('mouseup', () => {
    mouseDown = false
    mousePos = null
  })

  /** Aim from the hero towards the cursor, in logical screen space. */
  function mouseAim () {
    if (!mouseDown || !mousePos || !game.player || game.state !== 'playing') return null
    const px = game.player.x - game.camX
    const py = game.player.y - game.camY + G.HUD_H
    const dx = mousePos.x - px
    const dy = mousePos.y - py
    if (Math.hypot(dx, dy) < 4) return null
    return { x: dx, y: dy }
  }

  /* --- On-screen buttons --------------------------------------------------- */

  const magicBtn = document.getElementById('magic')
  if (magicBtn) {
    magicBtn.addEventListener('click', () => {
      G.Sfx.resume()
      input.magicPressed = true
    })
  }

  const pad = document.getElementById('pad')
  if (pad) {
    const sync = () => {
      pad.querySelector('[data-act="mute"]').textContent = G.Sfx.muted ? '🔇' : '🔊'
      pad.querySelector('[data-act="pause"]').textContent = game.paused ? '▶' : '⏸'
    }
    pad.addEventListener('click', e => {
      const btn = e.target.closest('button')
      if (!btn) return
      switch (btn.dataset.act) {
        case 'pause': togglePause(); break
        case 'mute': toggleMute(); break
        case 'full': toggleFullscreen(); break
      }
      sync()
    })
    syncPad = sync
    sync()
  }

  /* --- Layout -------------------------------------------------------------- */

  /** Fit the canvas to the space actually available.

      Whole-number scaling keeps pixels square, but on a phone the largest
      integer that fits is usually 1, which wastes most of the screen. So snap
      to an integer only when there is room for 2x or more, and fall back to a
      fractional fit on small displays. */
  function resize () {
    const coarse = global.matchMedia('(pointer: coarse)').matches
    // Touch controls float over the playfield, so only the keyboard hint line
    // needs reserving.
    const reserved = coarse ? 10 : 54
    const vv = global.visualViewport
    const vw = vv ? vv.width : global.innerWidth
    const vh = vv ? vv.height : global.innerHeight

    const availW = vw - 8
    const availH = vh - reserved - 12
    const fit = Math.min(availW / G.W, availH / G.H)
    const scale = fit >= 2 ? Math.floor(fit) : Math.max(0.4, fit)

    canvas.style.width = Math.round(G.W * scale) + 'px'
    canvas.style.height = Math.round(G.H * scale) + 'px'
  }

  global.addEventListener('resize', resize)
  global.addEventListener('orientationchange', () => setTimeout(resize, 120))
  if (global.visualViewport) global.visualViewport.addEventListener('resize', resize)
  resize()

  /* --- Thumbstick overlay -------------------------------------------------- */

  /** Draw each active stick as a ring plus a knob, so there is visible feedback
      about how far the stick is tilted. */
  function drawSticks () {
    for (const s of sticks.values()) {
      const dx = s.x - s.ox
      const dy = s.y - s.oy
      const len = Math.hypot(dx, dy)
      const t = Math.min(1, len / STICK_RADIUS)
      const kx = len > 0 ? s.ox + (dx / len) * STICK_RADIUS * t : s.ox
      const ky = len > 0 ? s.oy + (dy / len) * STICK_RADIUS * t : s.oy
      const tint = s.side === 'move' ? '120, 190, 255' : '255, 180, 90'

      ctx.beginPath()
      ctx.arc(s.ox, s.oy, STICK_RADIUS, 0, G.TAU)
      ctx.strokeStyle = 'rgba(' + tint + ', 0.28)'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(kx, ky, 11, 0, G.TAU)
      ctx.fillStyle = 'rgba(' + tint + ', 0.42)'
      ctx.fill()
    }
  }

  /* --- Loop ---------------------------------------------------------------- */

  let last = performance.now()
  let accumulator = 0

  function frame (now) {
    requestAnimationFrame(frame)

    // Clamp so a backgrounded tab does not fast-forward the whole game.
    const elapsed = Math.min(100, now - last)
    last = now
    accumulator += elapsed

    // Keyboard steering folds into the same vector the left stick produces.
    if (keys.left || keys.right || keys.up || keys.down) {
      input.move.x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
      input.move.y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
    } else if (sticks.size === 0) {
      input.move.x = 0
      input.move.y = 0
    }

    const aim = mouseAim()
    if (aim) {
      input.aim = aim
      input.fire = true
    }

    let steps = 0
    while (accumulator >= G.STEP && steps < 5) {
      accumulator -= G.STEP
      steps++
      if (!game.paused) game.update(1, input)
      // Edge-triggered flags last exactly one simulation step.
      input.firePressed = false
      input.startPressed = false
      input.magicPressed = false
      input.selectPressed = 0
    }

    game.draw()
    drawSticks()

    if (magicBtn) {
      const p = game.player
      const n = p ? p.potions : 0
      magicBtn.textContent = '✦' + n
      magicBtn.classList.toggle('empty', n <= 0)
      magicBtn.style.display = game.state === 'select' ? 'none' : ''
    }
  }

  requestAnimationFrame(frame)
})(window)
