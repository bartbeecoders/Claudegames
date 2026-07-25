/* Bootstrap: build the model, wire the panel, run the loop. */
(function (global) {
  'use strict'

  const CH = global.CH
  const canvas = document.getElementById('stage')
  const curtain = document.getElementById('curtain')
  const loadMsg = document.getElementById('loadMsg')
  const statsEl = document.getElementById('stats')
  const clockEl = document.getElementById('clock')

  const QUALITIES = [
    { name: 'low', scale: 0.62, shadow: 1024, ao: false, super: false },
    { name: 'medium', scale: 0.92, shadow: 2048, ao: true, super: false },
    { name: 'high', scale: 1.28, shadow: 4096, ao: true, super: true }
  ]

  function fail (message) {
    curtain.classList.add('failed')
    loadMsg.textContent = ''
    const p = document.createElement('p')
    p.className = 'err'
    p.textContent = message
    curtain.appendChild(p)
  }

  let renderer
  try {
    renderer = new CH.Renderer(canvas)
  } catch (e) {
    const hint = /WebGL 2/.test(e.message)
      ? ' Every current desktop and mobile browser has it — try updating, or turning hardware acceleration back on.'
      : ''
    fail(e.message + hint)
    return
  }

  const camera = new CH.Camera()
  const controls = new CH.Controls(camera, canvas)

  /* --- build ------------------------------------------------------------- */

  // Let the curtain paint before the model is cut.
  requestAnimationFrame(() => setTimeout(build, 16))

  function build () {
    const t0 = performance.now()
    try {
      const b = new CH.Builder()
      CH.buildChateau(b)
      CH.buildPark(b)
      renderer.upload(b)
    } catch (e) {
      fail('The model failed to build: ' + e.message)
      throw e
    }
    const ms = Math.round(performance.now() - t0)

    // Something modest on phones, something generous on a desktop GPU.
    const small = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900
    setQuality(small ? 0 : 1)

    statsEl.textContent = `${(renderer.tris / 1000).toFixed(0)}k tris · ${ms} ms`
    curtain.classList.add('gone')
    setTimeout(() => curtain.remove(), 800)
    requestAnimationFrame(frame)
  }

  /* --- panel -------------------------------------------------------------- */

  const viewsEl = document.getElementById('views')
  const viewButtons = CH.VIEWS.map((v, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = v.name
    btn.addEventListener('click', () => setView(i))
    viewsEl.appendChild(btn)
    return btn
  })

  function setView (i) {
    camera.goTo(i)
    controls.autoOrbit = false
    controls.idle = 0
    if (camera.mode === 'walk') toggleWalk(false)
    viewButtons.forEach((b, j) => b.classList.toggle('on', j === i))
  }

  const timeEl = document.getElementById('time')
  timeEl.addEventListener('input', () => setTime(Number(timeEl.value) / 1000))

  function setTime (t) {
    renderer.setTime(t)
    const hour = renderer.sun.hour
    const h = Math.floor(hour)
    const m = Math.floor((hour - h) * 60 / 5) * 5
    clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const walkBtn = document.getElementById('walk')
  walkBtn.addEventListener('click', () => toggleWalk(camera.mode !== 'walk'))

  function toggleWalk (on) {
    if (on) {
      // Step down onto the gravel below wherever we were looking from.
      camera.mode = 'walk'
      camera.walk.pos = [camera.eye[0], 1.7, camera.eye[2]]
      const dx = camera.sTarget[0] - camera.eye[0]
      const dz = camera.sTarget[2] - camera.eye[2]
      camera.walk.yaw = Math.atan2(dx, dz)
      camera.walk.pitch = Math.atan2(camera.sTarget[1] - camera.eye[1], Math.hypot(dx, dz))
    } else {
      camera.mode = 'orbit'
    }
    walkBtn.classList.toggle('on', on)
    walkBtn.textContent = on ? 'Orbit' : 'Walk'
  }

  const qualityBtn = document.getElementById('quality')
  let qi = 1
  qualityBtn.addEventListener('click', () => setQuality((qi + 1) % QUALITIES.length))

  function setQuality (i) {
    qi = i
    renderer.setQuality(QUALITIES[i])
    qualityBtn.textContent = 'Quality: ' + QUALITIES[i].name
  }

  document.getElementById('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  })

  const panel = document.getElementById('panel')
  document.getElementById('fold').addEventListener('click', () => panel.classList.toggle('mini'))

  const about = document.getElementById('about')
  document.getElementById('info').addEventListener('click', () => about.classList.toggle('open'))
  document.getElementById('closeAbout').addEventListener('click', () => about.classList.remove('open'))

  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return
    if (e.code >= 'Digit1' && e.code <= 'Digit5') setView(Number(e.code.slice(5)) - 1)
    if (e.code === 'KeyW' && e.shiftKey) toggleWalk(camera.mode !== 'walk')
    if (e.code === 'KeyF') document.getElementById('full').click()
    if (e.code === 'KeyH') panel.classList.toggle('mini')
  })

  setView(0)
  setTime(0.78)

  /* --- loop --------------------------------------------------------------- */

  let last = performance.now()
  let fps = 60
  let acc = 0

  function frame (now) {
    const dt = Math.min(0.05, (now - last) / 1000) || 0.016
    last = now
    fps += (1 / dt - fps) * 0.06
    acc += dt
    if (acc > 0.5) {
      acc = 0
      statsEl.textContent = `${fps.toFixed(0)} fps · ${(renderer.tris / 1000).toFixed(0)}k tris`
    }
    controls.update(dt)
    renderer.render(camera, dt)
    requestAnimationFrame(frame)
  }

  global.cheverny = { renderer, camera, controls }
})(window)
