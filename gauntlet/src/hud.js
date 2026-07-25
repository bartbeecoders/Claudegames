/* A 5x7 bitmap font plus the status bar.

   Glyphs are stored as 35-bit strings (7 rows of 5) and baked into tinted
   canvases on demand, so drawing text is a handful of drawImage calls. The
   font is shared with the other games in this collection. */
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
  /* --- Status bar --------------------------------------------------------- */

  const MAX_HEALTH = 1000

  /** Health colour runs green to red so the bar reads at a glance, without
      needing to parse the number while something is chewing on you. */
  function healthColor (frac) {
    if (frac > 0.5) return '#4fbf5a'
    if (frac > 0.25) return '#ffd83d'
    return '#ff3b30'
  }

  function drawStatus (ctx, game) {
    const p = game.player
    const info = G.Sprites.hero[p.kind].info

    ctx.fillStyle = '#0a0a12'
    ctx.fillRect(0, 0, G.W, G.HUD_H)
    ctx.fillStyle = '#23233a'
    ctx.fillRect(0, G.HUD_H - 1, G.W, 1)

    text(ctx, info.name, 6, 5, info.A)
    text(ctx, 'LEVEL ' + game.level, G.W - 6, 5, '#7a7a9c', 'right')

    // Health bar.
    const frac = G.clamp(p.health / MAX_HEALTH, 0, 1)
    const barW = G.W - 12
    ctx.fillStyle = '#1a1a2c'
    ctx.fillRect(6, 16, barW, 7)
    // Flash the bar when it is nearly out, matching the audible warning.
    const critical = frac < 0.2 && ((game.tick / 12) | 0) % 2 === 0
    ctx.fillStyle = critical ? '#ffffff' : healthColor(frac)
    ctx.fillRect(6, 16, Math.round(barW * frac), 7)
    ctx.fillStyle = '#000'
    ctx.fillRect(6, 21, Math.round(barW * frac), 2)
    ctx.globalAlpha = 0.35
    ctx.fillStyle = critical ? '#ffffff' : healthColor(frac)
    ctx.fillRect(6, 21, Math.round(barW * frac), 2)
    ctx.globalAlpha = 1

    text(ctx, 'HP ' + (p.health | 0), 6, 27, '#c8c8e0')
    text(ctx, 'SCORE ' + G.commas(p.score), G.W - 6, 27, '#ffd83d', 'right')

    // Key and potion counts, drawn with the pickup sprites as their own labels.
    G.Sprites.draw(ctx, G.Sprites.item.key, 12, 40, false)
    text(ctx, 'x' + p.keys, 20, 37, p.keys > 0 ? '#ffd83d' : '#55556e')
    G.Sprites.draw(ctx, G.Sprites.item.potion, 54, 40, false)
    text(ctx, 'x' + p.potions, 62, 37, p.potions > 0 ? '#b48ae8' : '#55556e')

    const left = game.generators.filter(g => g.alive).length
    text(ctx, 'NESTS ' + left, G.W - 6, 37, left ? '#ff8a6a' : '#4fbf5a', 'right')
  }

  G.Hud = { text, textWidth, drawStatus, MAX_HEALTH, CH, ADV }
})(window)
