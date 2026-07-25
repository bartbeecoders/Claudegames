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
    startPressed: false
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

  global.addEventListener('keydown', e => {
    // Let the browser keep its own shortcuts when a modifier is involved.
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (e.code === 'KeyP') {
      game.paused = !game.paused
      G.Sfx.resume()
      e.preventDefault()
      return
    }
    if (e.code === 'KeyM') {
      G.Sfx.init()
      G.Sfx.toggleMute()
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
  })

  /* Touch: three zones along the bottom of the screen.

     Zones are hit-tested by coordinate rather than bound to each element, so a
     finger can slide from one control straight into another. Per-element
     handlers can't do that on touch: the first pointerdown implicitly captures
     the pointer, and every later event keeps going to the original element. */
  const touch = document.getElementById('touch')
  if (touch) {
    const zones = Array.prototype.slice.call(touch.querySelectorAll('div'))
    const active = new Map() // pointerId -> action

    const zoneAt = (x, y) => {
      for (const z of zones) {
        const r = z.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z
      }
      return null
    }

    const apply = () => {
      const actions = new Set(active.values())
      input.left = actions.has('left')
      input.right = actions.has('right')
      const fire = actions.has('fire')
      if (fire && !input.fire) input.firePressed = true
      input.fire = fire
      for (const z of zones) z.classList.toggle('on', actions.has(z.dataset.key))
    }

    const track = e => {
      e.preventDefault()
      G.Sfx.resume()
      const z = zoneAt(e.clientX, e.clientY)
      if (z) active.set(e.pointerId, z.dataset.key)
      else active.delete(e.pointerId)
      apply()
    }

    const drop = e => {
      active.delete(e.pointerId)
      apply()
    }

    touch.addEventListener('pointerdown', e => {
      // Release implicit capture so a drag can cross into a neighbouring zone.
      if (touch.hasPointerCapture && touch.hasPointerCapture(e.pointerId)) {
        touch.releasePointerCapture(e.pointerId)
      }
      track(e)
    })
    touch.addEventListener('pointermove', e => {
      if (active.size === 0 && e.pressure === 0) return
      track(e)
    })
    touch.addEventListener('pointerup', drop)
    touch.addEventListener('pointercancel', drop)
    touch.addEventListener('contextmenu', e => e.preventDefault())
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
    // Space taken by the on-screen controls, or by the keyboard hint line.
    const reserved = coarse && touch ? touch.getBoundingClientRect().height : 52
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
      // Edge-triggered flags last exactly one simulation step.
      input.firePressed = false
      input.startPressed = false
    }

    game.draw()
  }

  requestAnimationFrame(frame)
})(window)
