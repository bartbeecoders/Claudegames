/* Bootstrap: canvas scaling, input, and the fixed-timestep game loop. */
(function (global) {
  'use strict'

  const G = global.G
  const canvas = document.getElementById('screen')
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.imageSmoothingEnabled = false

  const game = new G.Game(ctx)
  global.game = game // handy for poking around in the console

  /* --- Input ------------------------------------------------------------- */

  const input = {
    left: false,
    right: false,
    fire: false,
    firePressed: false,
    startPressed: false,
    dragDX: 0
  }

  const held = new Set()

  const KEYMAP = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    Space: 'fire',
    ArrowUp: 'fire',
    KeyW: 'fire',
    Enter: 'start',
    NumpadEnter: 'start'
  }

  function setKey (action, down) {
    if (action === 'left' || action === 'right') input[action] = down
    else if (action === 'fire') {
      if (down && !input.fire) input.firePressed = true
      input.fire = down
    } else if (action === 'start') {
      if (down) input.startPressed = true
    }
  }

  /* Pause and mute are reachable from both the keyboard and the on-screen
     buttons, so the behaviour lives here and both paths call it. Assigned by
     the button row once it exists. */
  let syncPad = () => {}

  function togglePause () {
    game.paused = !game.paused
    G.Sfx.resume()
    // Silence the loop while paused rather than leaving it running underneath.
    if (game.paused) G.Sfx.music.stop()
    else if (game.state === 'playing' || game.state === 'challenging') {
      G.Sfx.music.start(game.difficulty)
    }
    syncPad()
  }

  function toggleMute () {
    G.Sfx.init()
    G.Sfx.toggleMute()
    syncPad()
  }

  global.addEventListener('keydown', e => {
    // Let the browser keep its own shortcuts when a modifier is involved.
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
    setKey(action, true)
  })

  global.addEventListener('keyup', e => {
    const action = KEYMAP[e.code]
    if (!action) return
    e.preventDefault()
    held.delete(e.code)
    // Only clear a direction if no other key bound to it is still down.
    const stillHeld = Object.keys(KEYMAP).some(code => KEYMAP[code] === action && held.has(code))
    if (!stillHeld) setKey(action, false)
  })

  global.addEventListener('blur', () => {
    held.clear()
    input.left = input.right = input.fire = false
    // Drop any in-progress drag too, or an interruption mid-swipe (a call, the
    // app switcher) leaves the ship firing with no finger on the glass.
    dragging.clear()
    input.dragDX = 0
  })

  /* Touch: drag anywhere to steer, and firing is automatic.

     A three-button strip was the obvious first cut, but it plays badly on a
     phone: steering is quantised to on/off, dodging a dive needs the thumb in
     two places at once, and the strip eats a quarter of a small screen.

     Instead the whole playfield is the control. Dragging is *relative* — the
     ship moves by the same distance the finger does, converted from CSS pixels
     to game pixels — so the ship never teleports to wherever you happened to
     touch, and your thumb is never sitting on top of it. */
  const DRAG_GAIN = 1.15 // a little faster than 1:1 so corner-to-corner is one swipe

  const dragging = new Map() // pointerId -> last clientX

  /** CSS pixels per game pixel, so drags translate at the on-screen scale. */
  function pixelScale () {
    const r = canvas.getBoundingClientRect()
    return r.width > 0 ? r.width / G.W : 1
  }

  function isControl (target) {
    return !!(target && target.closest && target.closest('#pad'))
  }

  function touchFire (down) {
    if (down && !input.fire) input.firePressed = true
    input.fire = down
  }

  global.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || isControl(e.target)) return
    e.preventDefault()
    G.Sfx.resume()
    dragging.set(e.pointerId, e.clientX)
    touchFire(true)
  }, { passive: false })

  global.addEventListener('pointermove', e => {
    const last = dragging.get(e.pointerId)
    if (last === undefined) return
    e.preventDefault()
    input.dragDX += (e.clientX - last) / pixelScale() * DRAG_GAIN
    dragging.set(e.pointerId, e.clientX)
  }, { passive: false })

  const endDrag = e => {
    if (!dragging.delete(e.pointerId)) return
    if (dragging.size === 0) touchFire(false)
  }

  global.addEventListener('pointerup', endDrag)
  global.addEventListener('pointercancel', endDrag)
  global.addEventListener('contextmenu', e => {
    if (!isControl(e.target)) e.preventDefault()
  })

  /* On-screen buttons for the things that were keyboard-only, and so were
     simply unreachable on a phone: pause, mute and fullscreen. */
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

  /* --- Presentation ------------------------------------------------------ */

  function toggleFullscreen () {
    const el = document.documentElement
    if (document.fullscreenElement) document.exitFullscreen()
    else if (el.requestFullscreen) el.requestFullscreen()
  }

  /** Fit the canvas to the space actually available.

      Whole-number scaling keeps pixels perfectly square, but on a phone the
      largest integer that fits is usually 1, which wastes most of the screen.
      So we snap to an integer only when there's room for 2x or more, and fall
      back to a fractional fit on small displays. `image-rendering: pixelated`
      keeps it nearest-neighbour either way. */
  function resize () {
    const coarse = global.matchMedia('(pointer: coarse)').matches
    // Steering no longer needs a control strip, so a touch device only has to
    // keep the small button row clear; a desktop keeps room for the key hints.
    const reserved = coarse ? 56 : 52
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
  // iOS resizes the visual viewport when the URL bar slides away.
  if (global.visualViewport) global.visualViewport.addEventListener('resize', resize)
  resize()

  /* --- Loop -------------------------------------------------------------- */

  let last = performance.now()
  let accumulator = 0

  function frame (now) {
    requestAnimationFrame(frame)

    // Clamp so a backgrounded tab doesn't fast-forward the whole game.
    const elapsed = Math.min(100, now - last)
    last = now
    accumulator += elapsed

    let steps = 0
    while (accumulator >= G.STEP && steps < 5) {
      accumulator -= G.STEP
      steps++
      if (!game.paused) game.update(1, input)
      // Edge-triggered flags last exactly one simulation step. Drag distance is
      // cleared the same way: it is a displacement already accrued since the
      // last step, so applying it on more than one step would double-count it.
      input.firePressed = false
      input.startPressed = false
      input.dragDX = 0
    }

    game.draw()
  }

  requestAnimationFrame(frame)
})(window)
