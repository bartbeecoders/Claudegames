/* A 5x7 bitmap font plus the score / lives / stage-badge overlay.

   Glyphs are stored as 35-bit strings (7 rows of 5) and baked into tinted
   canvases on demand, so drawing text is a handful of drawImage calls. */
(function (global) {
  'use strict'

  const G = global.G

  const CW = 5
  const CH = 7
  const ADV = 6

  const GLYPHS = {
    A: '01110100011000111111100011000110001',
    B: '11110100011000111110100011000111110',
    C: '01110100011000010000100001000101110',
    D: '11110100011000110001100011000111110',
    E: '11111100001000011110100001000011111',
    F: '11111100001000011110100001000010000',
    G: '01110100011000010111100011000101111',
    H: '10001100011000111111100011000110001',
    I: '11111001000010000100001000010011111',
    J: '00111000100001000010000101001001100',
    K: '10001100101010011000101001001010001',
    L: '10000100001000010000100001000011111',
    M: '10001110111010110101100011000110001',
    N: '10001110011010110011100011000110001',
    O: '01110100011000110001100011000101110',
    P: '11110100011000111110100001000010000',
    Q: '01110100011000110001101011001001101',
    R: '11110100011000111110101001001010001',
    S: '01111100001000001110000010000111110',
    T: '11111001000010000100001000010000100',
    U: '10001100011000110001100011000101110',
    V: '10001100011000110001100010101000100',
    W: '10001100011000110101101011101110001',
    X: '10001100010101000100010101000110001',
    Y: '10001100010101000100001000010000100',
    Z: '11111000010001000100010001000011111',
    0: '01110100011001110101110011000101110',
    1: '00100011000010000100001000010001110',
    2: '01110100010000100110010001000011111',
    3: '11111000100010000010000011000101110',
    4: '00010001100101010010111110001000010',
    5: '11111100001111000001000011000101110',
    6: '00110010001000011110100011000101110',
    7: '11111000010001000100010000100001000',
    8: '01110100011000101110100011000101110',
    9: '01110100011000101111000010001001100',
    ' ': '00000000000000000000000000000000000',
    '-': '00000000000000011111000000000000000',
    '.': '00000000000000000000000000000000100',
    ',': '00000000000000000000000001000100000',
    '!': '00100001000010000100001000000000100',
    '?': '01110100010000100110001000000000100',
    ':': '00000001000000000000000100000000000',
    "'": '00100001000000000000000000000000000',
    '/': '00001000100001000100010000100010000',
    '(': '00010001000100001000010000010000010',
    ')': '01000001000001000010000100010001000',
    '*': '00000101000111011111011100101000000',
    '=': '00000000001111100000111110000000000',
    '+': '00000001000010011111001000010000000',
    '<': '00010001000100010000010000010000010',
    '>': '01000001000001000001000100010001000',
    '©': '01110100011011110101101101000101110'
  }

  const cache = new Map()

  function glyphCanvas (ch, color) {
    const key = ch + color
    let c = cache.get(key)
    if (c) return c
    const bits = GLYPHS[ch]
    if (!bits) return null
    c = document.createElement('canvas')
    c.width = CW
    c.height = CH
    const x = c.getContext('2d')
    x.fillStyle = color
    for (let r = 0; r < CH; r++) {
      for (let col = 0; col < CW; col++) {
        if (bits[r * CW + col] === '1') x.fillRect(col, r, 1, 1)
      }
    }
    cache.set(key, c)
    return c
  }

  function textWidth (str) {
    return str.length * ADV - 1
  }

  /** `align` is 'left' (default), 'center' or 'right'. */
  function text (ctx, str, x, y, color, align) {
    str = String(str).toUpperCase()
    let px = x
    if (align === 'center') px = Math.round(x - textWidth(str) / 2)
    else if (align === 'right') px = Math.round(x - textWidth(str))
    px = Math.round(px)
    const py = Math.round(y)
    for (let i = 0; i < str.length; i++) {
      const c = glyphCanvas(str[i], color)
      if (c) ctx.drawImage(c, px + i * ADV, py)
    }
    return px
  }

  /* --- Stage badges ------------------------------------------------------ */

  const BADGE_VALUES = [50, 30, 20, 10, 5, 1]

  /** Break a stage number into the badge row shown bottom-right. */
  function badgesFor (stage) {
    const out = []
    let n = stage
    for (const v of BADGE_VALUES) {
      while (n >= v && out.length < 20) {
        out.push(v)
        n -= v
      }
    }
    return out
  }

  const HUD = {
    text,
    textWidth,
    badgesFor,

    /** Top row: score labels and values. Bottom row: lives and stage badges. */
    draw (ctx, game) {
      const S = G.Sprites

      // 1UP blinks like the original attract/play display.
      const blink = ((game.clock / 22) | 0) % 2 === 0
      if (blink || game.state === 'attract') text(ctx, '1UP', 24, 1, '#ff3b30')
      text(ctx, String(game.score).padStart(2, '0'), 60, 9, '#ffffff', 'right')

      text(ctx, 'HIGH SCORE', 112, 1, '#ff3b30', 'center')
      text(ctx, String(game.highScore).padStart(2, '0'), 140, 9, '#ffffff', 'right')

      // Remaining lives, bottom-left. The title screen shows no ships.
      if (game.state !== 'attract') {
        const shown = Math.min(game.lives, 6)
        for (let i = 0; i < shown; i++) {
          ctx.drawImage(S.lifeIcon, 1 + i * 15, G.H - 17)
        }
      }

      // Stage badges, bottom-right, most valuable first.
      const badges = badgesFor(game.stageShown)
      let bx = G.W - 2
      for (let i = badges.length - 1; i >= 0; i--) {
        const spr = S.badge(badges[i])
        if (!spr) continue
        bx -= spr.width + 1
        ctx.drawImage(spr, bx, G.H - 10)
        if (bx < 60) break
      }
    }
  }

  G.HUD = HUD
})(window)
