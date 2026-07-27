/* The head-up display, drawn on a 2D canvas stacked over the WebGL one.

   Keeping it in 2D means crisp text at any device pixel ratio and no font
   atlas to generate, and it costs nothing in the 3D pass. Everything here
   reads the world; nothing here changes it. */
(function (global) {
  'use strict'

  const G = global.G

  const MINT = '#7cf6d0'
  const MINT_DIM = 'rgba(124, 246, 208, 0.34)'
  const RED = '#ff5a4a'
  const AMBER = '#ffce4d'
  const BLUE = '#7fbcff'

  let cv = null
  let x = null
  let W = 0, H = 0, S = 1

  const p0 = G.v3(), p1 = G.v3()
  const tmp = G.v3(), tmp2 = G.v3()

  const font = (size, weight) => {
    x.font = `${weight || 400} ${size}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`
  }

  /** Uppercase, letter-spaced text. Canvas letterSpacing is not universal, so
      wide text is drawn a glyph at a time when it matters. */
  const text = (str, px, py, size, color, align, spacing, weight) => {
    font(size, weight)
    x.fillStyle = color
    x.textBaseline = 'middle'
    if (!spacing) {
      x.textAlign = align || 'left'
      x.fillText(str, px, py)
      return
    }
    x.textAlign = 'left'
    let total = 0
    for (let i = 0; i < str.length; i++) total += x.measureText(str[i]).width + spacing
    total -= spacing
    let cx = align === 'center' ? px - total / 2 : align === 'right' ? px - total : px
    for (let i = 0; i < str.length; i++) {
      x.fillText(str[i], cx, py)
      cx += x.measureText(str[i]).width + spacing
    }
  }

  const bar = (px, py, w, h, frac, color, back) => {
    x.fillStyle = back || 'rgba(255,255,255,0.08)'
    x.fillRect(px, py, w, h)
    x.fillStyle = color
    x.fillRect(px, py, w * G.clamp(frac, 0, 1), h)
    x.strokeStyle = 'rgba(255,255,255,0.16)'
    x.lineWidth = 1
    x.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1)
  }

  /* ---------------------------------------------------------- targeting -- */

  const bracket = (sx, sy, size, color, thickness) => {
    const h = size / 2
    x.strokeStyle = color
    x.lineWidth = thickness || 2
    const c = size * 0.3
    x.beginPath()
    x.moveTo(sx - h, sy - h + c); x.lineTo(sx - h, sy - h); x.lineTo(sx - h + c, sy - h)
    x.moveTo(sx + h - c, sy - h); x.lineTo(sx + h, sy - h); x.lineTo(sx + h, sy - h + c)
    x.moveTo(sx + h, sy + h - c); x.lineTo(sx + h, sy + h); x.lineTo(sx + h - c, sy + h)
    x.moveTo(sx - h + c, sy + h); x.lineTo(sx - h, sy + h); x.lineTo(sx - h, sy + h - c)
    x.stroke()
  }

  /** The gunsight: a fixed reticle plus a floating pipper showing where the
      bolts will actually be when they arrive. */
  const reticle = (world, R) => {
    const cx = W / 2, cy = H / 2
    x.strokeStyle = MINT
    x.lineWidth = 1.6
    x.globalAlpha = 0.85
    x.beginPath()
    x.arc(cx, cy, 15, 0, G.TAU)
    x.moveTo(cx - 30, cy); x.lineTo(cx - 19, cy)
    x.moveTo(cx + 19, cy); x.lineTo(cx + 30, cy)
    x.moveTo(cx, cy - 30); x.lineTo(cx, cy - 19)
    x.moveTo(cx, cy + 30); x.lineTo(cx, cy + 19)
    x.stroke()
    x.beginPath()
    x.arc(cx, cy, 2, 0, G.TAU)
    x.fillStyle = MINT
    x.fill()
    x.globalAlpha = 1

    const t = world.lockTarget
    if (!t || !t.alive) return

    // Lead pipper.
    const p = world.player
    const vel = t.vel || ZERO
    G.leadPoint(tmp, p.pos, t.pos, vel, p.def.boltSpeed)
    if (R.project(tmp, p1)) {
      const locked = world.locked
      x.strokeStyle = locked ? RED : AMBER
      x.lineWidth = 2
      x.globalAlpha = 0.9
      x.beginPath()
      x.arc(p1.x, p1.y, 9, 0, G.TAU)
      x.stroke()
      x.beginPath()
      x.moveTo(p1.x - 14, p1.y); x.lineTo(p1.x - 10, p1.y)
      x.moveTo(p1.x + 10, p1.y); x.lineTo(p1.x + 14, p1.y)
      x.stroke()
      x.globalAlpha = 1
    }

    // Bracket on the target itself, sized by how close it is.
    if (R.project(t.pos, p0)) {
      const dist = G.vdist(p.pos, t.pos)
      const size = G.clamp(40000 / Math.max(dist, 1), 22, 150)
      bracket(p0.x, p0.y, size, world.locked ? RED : MINT, 2)
      text(Math.round(dist) + 'M', p0.x, p0.y + size / 2 + 12, 11, world.locked ? RED : MINT, 'center', 1)
      if (t.maxHull) {
        bar(p0.x - size / 2, p0.y - size / 2 - 10, size, 3,
          t.hull / t.maxHull, t.hull / t.maxHull > 0.4 ? MINT : RED)
      }
      if (world.lockProgress < 1) {
        // Lock ring closing in.
        x.strokeStyle = AMBER
        x.lineWidth = 2.5
        x.globalAlpha = 0.8
        x.beginPath()
        x.arc(p0.x, p0.y, size * 0.9, -Math.PI / 2, -Math.PI / 2 + G.TAU * world.lockProgress)
        x.stroke()
        x.globalAlpha = 1
      } else {
        text('LOCK', p0.x, p0.y - size / 2 - 20, 11, RED, 'center', 2, 700)
      }
    } else {
      offscreenArrow(t.pos, world, R, RED)
    }
  }

  const ZERO = G.v3()

  /** An arrow at the edge of the screen pointing at something behind or wide
      of the camera. Without this, dogfighting in 3D is guesswork. */
  const offscreenArrow = (pos, world, R, color) => {
    G.vsub(tmp, pos, world.camPos)
    G.qright(tmp2, world.camQuat)
    const rx = G.vdot(tmp, tmp2)
    G.qup(tmp2, world.camQuat)
    const ry = G.vdot(tmp, tmp2)
    const a = Math.atan2(-ry, rx)
    const cx = W / 2, cy = H / 2
    const r = Math.min(W, H) * 0.36
    const px = cx + Math.cos(a) * r
    const py = cy + Math.sin(a) * r
    x.save()
    x.translate(px, py)
    x.rotate(a)
    x.fillStyle = color
    x.globalAlpha = 0.9
    x.beginPath()
    x.moveTo(11, 0); x.lineTo(-7, -7); x.lineTo(-3, 0); x.lineTo(-7, 7)
    x.closePath()
    x.fill()
    x.restore()
    x.globalAlpha = 1
  }

  /* -------------------------------------------------------------- radar -- */

  /* A hemisphere radar: contacts in front of the ship plot inside the circle,
     contacts behind plot in the outer ring. It takes a moment to learn and
     then you never look at anything else. */
  const radar = (world, cx, cy, r) => {
    x.strokeStyle = MINT_DIM
    x.lineWidth = 1
    x.beginPath()
    x.arc(cx, cy, r, 0, G.TAU)
    x.moveTo(cx - r, cy); x.lineTo(cx + r, cy)
    x.moveTo(cx, cy - r); x.lineTo(cx, cy + r)
    x.stroke()
    x.beginPath()
    x.arc(cx, cy, r * 0.55, 0, G.TAU)
    x.stroke()

    const p = world.player
    const fwd = G.v3(), up = G.v3(), right = G.v3()
    G.qforward(fwd, p.quat)
    G.qup(up, p.quat)
    G.qright(right, p.quat)

    const plot = (pos, color, size) => {
      G.vsub(tmp, pos, p.pos)
      const d = G.vlen(tmp)
      if (d < 0.01 || d > 4000) return
      G.vscale(tmp, tmp, 1 / d)
      const f = G.vdot(tmp, fwd)
      let px = G.vdot(tmp, right)
      let py = -G.vdot(tmp, up)
      const len = Math.hypot(px, py) || 0.0001
      // Front hemisphere maps into the inner disc, rear into the outer band.
      const radial = f >= 0 ? (1 - f) * 0.72 : 0.72 + (1 + f) * 0.28
      px = px / len * radial * r
      py = py / len * radial * r
      const fade = G.clamp(1 - d / 4000, 0.25, 1)
      x.globalAlpha = fade
      x.fillStyle = color
      x.fillRect(cx + px - size / 2, cy + py - size / 2, size, size)
      x.globalAlpha = 1
    }

    const ships = G.Fleet.ships
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive || s.player) continue
      plot(s.pos, s.faction === G.Fleet.IMPERIAL ? RED : BLUE, s.faction === G.Fleet.IMPERIAL ? 4 : 3)
    }
    for (let i = 0; i < world.turrets.length; i++) {
      if (world.turrets[i].alive) plot(world.turrets[i].pos, '#ff9d4a', 3)
    }
    if (world.capital) {
      plot(world.capital.pos, AMBER, 7)
      for (const d of world.capital.domes) if (d.alive) plot(d.pos, '#66e0ff', 4)
    }
    if (world.port && world.port.alive) plot(world.port.pos, '#ff7a2a', 6)

    text('RADAR', cx, cy + r + 12, 9, MINT_DIM, 'center', 2)
  }

  /* --------------------------------------------------------------- draw -- */

  const drawFlight = (world, R, showMessages) => {
    const p = world.player
    const pad = 22

    reticle(world, R)

    // Anything hostile that is not the current target still gets a light box.
    const ships = G.Fleet.ships
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive || s.faction !== G.Fleet.IMPERIAL || s === world.lockTarget) continue
      const d = G.vdist(p.pos, s.pos)
      if (d > 1800) continue
      if (!R.project(s.pos, p0)) continue
      const size = G.clamp(28000 / Math.max(d, 1), 14, 90)
      x.globalAlpha = G.clamp(1 - d / 1800, 0.2, 0.75)
      bracket(p0.x, p0.y, size, RED, 1.2)
      x.globalAlpha = 1
    }

    // Wingmen, marked so you do not shoot them.
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (!s.alive || s.faction !== G.Fleet.REBEL || s.player) continue
      if (!R.project(s.pos, p0)) continue
      const d = G.vdist(p.pos, s.pos)
      if (d > 1400) continue
      x.globalAlpha = G.clamp(1 - d / 1400, 0.15, 0.5)
      x.strokeStyle = BLUE
      x.lineWidth = 1.2
      x.beginPath()
      x.arc(p0.x, p0.y, 9, 0, G.TAU)
      x.stroke()
      x.globalAlpha = 1
    }

    // Objective marker.
    let obj = null
    if (world.port && world.port.alive) obj = world.port.pos
    else if (world.capital) {
      const dome = world.capital.domes.find(d => d.alive)
      obj = dome ? dome.pos : world.capital.pos
    }
    if (obj && R.project(obj, p0)) {
      x.strokeStyle = AMBER
      x.lineWidth = 1.6
      x.globalAlpha = 0.8
      x.beginPath()
      x.moveTo(p0.x, p0.y - 16); x.lineTo(p0.x + 12, p0.y); x.lineTo(p0.x, p0.y + 16); x.lineTo(p0.x - 12, p0.y)
      x.closePath()
      x.stroke()
      x.globalAlpha = 1
    } else if (obj) {
      offscreenArrow(obj, world, R, AMBER)
    }

    /* -- left: shields and hull -- */
    const barW = Math.min(150, W * 0.24)
    const y0 = H - pad - 52
    text('SHIELDS', pad, y0 - 10, 10, MINT_DIM, 'left', 2)
    bar(pad, y0, barW, 9, p.shield / p.maxShield, p.shield > p.maxShield * 0.3 ? MINT : AMBER)
    text('HULL', pad, y0 + 26, 10, MINT_DIM, 'left', 2)
    bar(pad, y0 + 36, barW, 9, p.hull / p.maxHull, p.hull > p.maxHull * 0.35 ? '#9ff5ff' : RED)

    /* -- right: throttle, boost, torpedoes -- */
    const rx = W - pad - barW
    text('THROTTLE', W - pad, y0 - 10, 10, MINT_DIM, 'right', 2)
    bar(rx, y0, barW, 9, p.throttle, BLUE)
    text('BOOST', W - pad, y0 + 26, 10, MINT_DIM, 'right', 2)
    bar(rx, y0 + 36, barW, 9, p.boostEnergy, p.boosting ? AMBER : MINT_DIM)

    const speed = Math.round(G.vlen(p.vel))
    text(speed + ' M/S', W - pad, y0 - 34, 14, MINT, 'right', 2, 700)

    // Torpedo pips.
    for (let i = 0; i < p.maxTorpedoes; i++) {
      const px = W - pad - 12 - i * 15
      x.fillStyle = i < p.torpedoes ? '#c08bff' : 'rgba(255,255,255,0.12)'
      x.fillRect(px, y0 + 58, 9, 12)
    }
    text('TORPEDOES', W - pad, y0 + 82, 9, MINT_DIM, 'right', 2)

    /* -- top: score and objective -- */
    text('SCORE ' + G.commas(world.score), pad, pad + 4, 15, MINT, 'left', 2, 700)
    text('BEST ' + G.commas(world.best), pad, pad + 24, 10, MINT_DIM, 'left', 2)
    // Clear of the utility buttons in the top right corner of the page.
    text(world.stageName, W - pad, pad + 40, 13, AMBER, 'right', 3, 700)
    text(world.objective, W - pad, pad + 60, 10, MINT_DIM, 'right', 1.5)

    radar(world, W / 2, H - pad - 62, Math.min(62, H * 0.11))

    /* -- warnings -- */
    if (p.hull < p.maxHull * 0.3 && p.alive) {
      const pulse = 0.5 + 0.5 * Math.sin(world.time * 9)
      x.globalAlpha = 0.5 + pulse * 0.5
      text('HULL CRITICAL', W / 2, H * 0.22, 16, RED, 'center', 4, 700)
      x.globalAlpha = 1
    }

    /* -- messages -- */
    // Mission chatter is hidden behind a panel, so that a pause or a death
    // screen never has three lines of amber text running through it.
    if (!showMessages) return
    let my = H * 0.24
    for (let i = 0; i < world.messages.length; i++) {
      const m = world.messages[i]
      const fade = G.clamp(m.life / 0.6, 0, 1) * G.clamp((m.max - m.life) / 0.2, 0, 1)
      x.globalAlpha = fade
      text(m.text, W / 2, my, 22, AMBER, 'center', 5, 700)
      if (m.sub) text(m.sub, W / 2, my + 24, 12, MINT, 'center', 3)
      x.globalAlpha = 1
      my += 62
    }
  }

  /* -------------------------------------------------------------- menus -- */

  const panel = (w, h) => {
    x.fillStyle = 'rgba(4, 8, 14, 0.72)'
    x.fillRect(W / 2 - w / 2, H / 2 - h / 2, w, h)
    x.strokeStyle = 'rgba(124, 246, 208, 0.28)'
    x.lineWidth = 1
    x.strokeRect(W / 2 - w / 2 + 0.5, H / 2 - h / 2 + 0.5, w - 1, h - 1)
  }

  const title = (str, y, size) => {
    text(str, W / 2, y, size, '#ffffff', 'center', size * 0.24, 700)
  }

  const drawMenu = (world, touch) => {
    x.fillStyle = 'rgba(0, 0, 0, 0.45)'
    x.fillRect(0, 0, W, H)

    const big = Math.min(W * 0.09, 54)
    title('STARFIGHTER', H * 0.3, big)
    text('A REBELLION IS ONLY EVER ONE RUN AWAY', W / 2, H * 0.3 + big * 0.75, 11, MINT, 'center', 3)

    const y = H * 0.52
    const lines = touch
      ? [
        'DRAG THE LEFT SIDE TO FLY',
        'FIRE AND BOOST BUTTONS ON THE RIGHT',
        'TAP FIRE TO BEGIN'
      ]
      : [
        'MOUSE OR ARROWS / WASD  —  FLY',
        'CLICK OR SPACE  —  CANNONS      F  —  TORPEDO',
        'SHIFT  —  BOOST      Q E  —  ROLL      C  —  VIEW',
        'P  —  PAUSE      M  —  MUTE      ENTER  —  LAUNCH'
      ]
    for (let i = 0; i < lines.length; i++) {
      text(lines[i], W / 2, y + i * 22, 12, i === lines.length - 1 ? AMBER : MINT_DIM, 'center', 2)
    }

    if (world.best > 0) {
      text('BEST  ' + G.commas(world.best), W / 2, H * 0.78, 13, MINT, 'center', 3, 700)
    }
  }

  const drawPaused = () => {
    x.fillStyle = 'rgba(0, 0, 0, 0.5)'
    x.fillRect(0, 0, W, H)
    panel(Math.min(340, W * 0.8), 120)
    title('PAUSED', H / 2 - 12, 26)
    text('P OR TAP TO RESUME', W / 2, H / 2 + 22, 11, MINT_DIM, 'center', 2)
  }

  const drawOver = (world, touch) => {
    x.fillStyle = 'rgba(20, 0, 0, 0.42)'
    x.fillRect(0, 0, W, H)
    panel(Math.min(400, W * 0.86), 190)
    title(world.overReason || 'YOU WERE HIT', H / 2 - 52, 24)
    text('SCORE  ' + G.commas(world.score), W / 2, H / 2 - 12, 18, AMBER, 'center', 3, 700)
    text('BEST  ' + G.commas(world.best), W / 2, H / 2 + 12, 12, MINT, 'center', 2)
    text('KILLS  ' + world.kills + '   ·   SECTOR  ' + (world.difficulty + 1),
      W / 2, H / 2 + 34, 11, MINT_DIM, 'center', 2)
    text(touch ? 'TAP TO FLY AGAIN' : 'ENTER TO FLY AGAIN', W / 2, H / 2 + 66, 12, AMBER, 'center', 3, 700)
  }

  /* ---------------------------------------------------------------- api -- */

  G.Hud = {
    init (canvas) {
      cv = canvas
      x = cv.getContext('2d')
    },

    resize (w, h, dpr) {
      W = w; H = h; S = dpr
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
    },

    draw (state, world, R, touch, fps) {
      x.setTransform(S, 0, 0, S, 0, 0)
      x.clearRect(0, 0, W, H)
      x.textBaseline = 'middle'

      if (state !== 'menu') drawFlight(world, R, state === 'playing')
      if (state === 'menu') drawMenu(world, touch)
      else if (state === 'paused') drawPaused()
      else if (state === 'over') drawOver(world, touch)

      if (fps) text(fps + ' FPS', W / 2, 16, 10, MINT_DIM, 'center', 1)
    }
  }
})(window)
