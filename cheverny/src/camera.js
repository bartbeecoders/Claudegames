/* Camera and controls.

   Two ways round the estate: an orbit camera that swings about a point, and a
   walk mode that puts you on the gravel at eye height. Both are damped, so
   nothing in the view ever moves in a straight jerk. */
(function (global) {
  'use strict'

  const CH = global.CH
  const m4 = CH.m4
  const clamp = CH.clamp
  const DEG = CH.DEG

  /** The five viewpoints the photographs were taken from. */
  const VIEWS = [
    { name: "Cour d'honneur", target: [0, 9.5, -2], dist: 92, yaw: Math.PI, pitch: 6 * DEG },
    { name: 'Le perron', target: [0, 8.5, -4], dist: 46, yaw: Math.PI + 0.16, pitch: 3 * DEG },
    { name: 'Façade sud', target: [0, 9.5, 4], dist: 88, yaw: 0.06, pitch: 6 * DEG },
    { name: 'Les douves', target: [20, 6.5, 10], dist: 40, yaw: 0.62, pitch: 2 * DEG },
    { name: 'Le parc', target: [0, 10, 0], dist: 165, yaw: Math.PI - 0.55, pitch: 27 * DEG }
  ]

  class Camera {
    constructor () {
      this.target = VIEWS[0].target.slice()
      this.dist = VIEWS[0].dist
      this.yaw = VIEWS[0].yaw
      this.pitch = VIEWS[0].pitch
      this.fov = 44 * DEG

      // Damped values actually used for the matrix.
      this.sTarget = this.target.slice()
      this.sDist = this.dist
      this.sYaw = this.yaw
      this.sPitch = this.pitch

      this.mode = 'orbit'
      this.walk = { pos: [0, 1.7, -40], yaw: Math.PI, pitch: 0 }
      this.eye = [0, 0, 0]
      this._view = m4.create()
    }

    projection (aspect) {
      this.aspect = aspect
      return m4.perspective(this.fov, aspect, 0.35, 1400)
    }

    /** A 62-metre-wide front does not fit a phone held upright at the distance
        that suits a laptop, so the orbit is pulled back on narrow screens.
        Called after projection(), which is where the aspect comes from. */
    framing () {
      const a = this.aspect || 1.6
      return clamp(1.35 / a, 1, 2.0)
    }

    view () {
      if (this.mode === 'walk') {
        const w = this.walk
        const d = [
          Math.sin(w.yaw) * Math.cos(w.pitch),
          Math.sin(w.pitch),
          Math.cos(w.yaw) * Math.cos(w.pitch)
        ]
        this.eye = w.pos.slice()
        return m4.lookAt(this.eye, [w.pos[0] + d[0], w.pos[1] + d[1], w.pos[2] + d[2]], [0, 1, 0], this._view)
      }
      const cp = Math.cos(this.sPitch)
      const d = this.sDist * this.framing()
      this.eye = [
        this.sTarget[0] + Math.sin(this.sYaw) * cp * d,
        this.sTarget[1] + Math.sin(this.sPitch) * d,
        this.sTarget[2] + Math.cos(this.sYaw) * cp * d
      ]
      // Never let the camera sink below the gravel.
      if (this.eye[1] < 0.8) this.eye[1] = 0.8
      return m4.lookAt(this.eye, this.sTarget, [0, 1, 0], this._view)
    }

    goTo (i) {
      const v = VIEWS[i]
      if (!v) return
      this.mode = 'orbit'
      this.target = v.target.slice()
      this.dist = v.dist
      this.pitch = v.pitch
      // Take the shorter way round.
      let dy = v.yaw - this.yaw
      while (dy > Math.PI) dy -= CH.TAU
      while (dy < -Math.PI) dy += CH.TAU
      this.yaw = this.yaw + dy
      this.viewName = v.name
    }

    update (dt) {
      const k = 1 - Math.pow(0.0016, dt)
      this.sYaw += (this.yaw - this.sYaw) * k
      this.sPitch += (this.pitch - this.sPitch) * k
      this.sDist += (this.dist - this.sDist) * k
      for (let i = 0; i < 3; i++) this.sTarget[i] += (this.target[i] - this.sTarget[i]) * k
    }
  }

  /** Mouse, wheel, keyboard and touch, wired to a camera. */
  class Controls {
    constructor (camera, el) {
      this.cam = camera
      this.el = el
      this.keys = new Set()
      this.idle = 0
      this.autoOrbit = false
      this.pointers = new Map()
      this.lastPinch = 0

      const down = e => {
        el.setPointerCapture(e.pointerId)
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button })
        this.idle = 0
        this.autoOrbit = false
      }
      const move = e => {
        const p = this.pointers.get(e.pointerId)
        if (!p) return
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        p.x = e.clientX
        p.y = e.clientY
        this.idle = 0

        if (this.pointers.size >= 2) {
          this.pinch()
          return
        }
        const cam = this.cam
        if (cam.mode === 'walk') {
          cam.walk.yaw -= dx * 0.0032
          cam.walk.pitch = clamp(cam.walk.pitch - dy * 0.0032, -1.2, 1.2)
          return
        }
        if (p.button === 2 || e.shiftKey) {
          this.pan(dx, dy)
        } else {
          cam.yaw -= dx * 0.0042
          cam.pitch = clamp(cam.pitch + dy * 0.0035, -4 * DEG, 78 * DEG)
        }
      }
      const up = e => {
        this.pointers.delete(e.pointerId)
        this.lastPinch = 0
      }

      el.addEventListener('pointerdown', down)
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('contextmenu', e => e.preventDefault())
      el.addEventListener('wheel', e => {
        e.preventDefault()
        this.idle = 0
        this.autoOrbit = false
        const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)
        if (this.cam.mode === 'walk') this.cam.fov = clamp(this.cam.fov * f, 18 * DEG, 70 * DEG)
        else this.cam.dist = clamp(this.cam.dist * f, 12, 420)
      }, { passive: false })

      window.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey) return
        this.keys.add(e.code)
        this.idle = 0
        this.autoOrbit = false
      })
      window.addEventListener('keyup', e => this.keys.delete(e.code))
      window.addEventListener('blur', () => this.keys.clear())
    }

    pan (dx, dy) {
      const cam = this.cam
      const s = cam.sDist * 0.0016
      const sy = Math.sin(cam.sYaw), cy = Math.cos(cam.sYaw)
      cam.target[0] -= (cy * dx - sy * dy * 0.6) * s
      cam.target[2] += (sy * dx + cy * dy * 0.6) * s
      cam.target[1] = clamp(cam.target[1] + dy * s * 0.8, 1, 60)
    }

    pinch () {
      const pts = [...this.pointers.values()]
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (this.lastPinch) {
        const f = this.lastPinch / d
        if (this.cam.mode === 'orbit') this.cam.dist = clamp(this.cam.dist * f, 12, 420)
      }
      this.lastPinch = d
    }

    update (dt) {
      const cam = this.cam
      const k = this.keys
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.2 : 1

      if (cam.mode === 'walk') {
        const w = cam.walk
        const speed = 7 * fast * dt
        let fx = 0, fz = 0
        if (k.has('KeyW') || k.has('ArrowUp')) fz += 1
        if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1
        if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1
        if (k.has('KeyD') || k.has('ArrowRight')) fx += 1
        const sy = Math.sin(w.yaw), cy = Math.cos(w.yaw)
        w.pos[0] += (sy * fz + cy * fx) * speed
        w.pos[2] += (cy * fz - sy * fx) * speed
        if (k.has('KeyQ')) w.pos[1] -= speed
        if (k.has('KeyE')) w.pos[1] += speed
        w.pos[1] = clamp(w.pos[1], 1.7, 60)
      } else {
        const rot = 0.9 * dt
        if (k.has('ArrowLeft')) { cam.yaw += rot; this.autoOrbit = false }
        if (k.has('ArrowRight')) { cam.yaw -= rot; this.autoOrbit = false }
        if (k.has('ArrowUp')) cam.pitch = clamp(cam.pitch + rot * 0.5, -4 * DEG, 78 * DEG)
        if (k.has('ArrowDown')) cam.pitch = clamp(cam.pitch - rot * 0.5, -4 * DEG, 78 * DEG)
        if (k.has('KeyW')) cam.dist = clamp(cam.dist * (1 - dt * 0.8), 12, 420)
        if (k.has('KeyS')) cam.dist = clamp(cam.dist * (1 + dt * 0.8), 12, 420)

        this.idle += dt
        if (this.idle > 25) this.autoOrbit = true
        if (this.autoOrbit) cam.yaw += dt * 0.035
      }
      cam.update(dt)
    }
  }

  CH.Camera = Camera
  CH.Controls = Controls
  CH.VIEWS = VIEWS
})(window)
