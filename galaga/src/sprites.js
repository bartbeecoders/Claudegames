/* Pixel art. Each sprite is authored as a character grid plus a palette and
   baked once into an offscreen canvas at load time.

   Convention: every sprite is drawn facing UP. Entities store a heading in
   radians (0 = +x), so the render rotation is always `heading + PI/2`. */
(function (global) {
  'use strict'

  const G = global.G

  function bake (rows, palette, scale) {
    scale = scale || 1
    const w = rows[0].length
    const h = rows.length
    const c = document.createElement('canvas')
    c.width = w * scale
    c.height = h * scale
    const x = c.getContext('2d')
    for (let r = 0; r < h; r++) {
      const row = rows[r]
      for (let col = 0; col < w; col++) {
        const ch = row[col]
        const color = palette[ch]
        if (!color) continue
        x.fillStyle = color
        x.fillRect(col * scale, r * scale, scale, scale)
      }
    }
    c.cx = c.width / 2
    c.cy = c.height / 2
    return c
  }

  const BEE = [
    '................',
    '.......YY.......',
    '......YYYY......',
    '......Y..Y......',
    '.....YYYYYY.....',
    '..B..YYYYYY..B..',
    '.BBB.Y.YY.Y.BBB.',
    'BBBBBYYYYYYBBBBB',
    'BBBBB.YYYY.BBBBB',
    'BBBB..YYYY..BBBB',
    '.BB...Y..Y...BB.',
    '......YYYY......',
    '.....YY..YY.....',
    '....YY....YY....',
    '................',
    '................'
  ]

  const BUTTERFLY = [
    '................',
    '.......RR.......',
    '......RRRR......',
    '.....RRRRRR.....',
    '..W..R.RR.R..W..',
    '.WWW.RRRRRR.WWW.',
    'WWWWWRRRRRRWWWWW',
    'WWWWW.RRRR.WWWWW',
    'WWWW...RR...WWWW',
    '.WW...RRRR...WW.',
    '.....RRRRRR.....',
    '....RR.RR.RR....',
    '...RR..RR..RR...',
    '..RR...RR...RR..',
    '................',
    '................'
  ]

  const BOSS = [
    '................',
    '....GGGGGGGG....',
    '...GGGGGGGGGG...',
    '...GG.GGGG.GG...',
    '...GGGGGGGGGG...',
    '.P.GGG.GG.GGG.P.',
    'PPP.GGGGGGGG.PPP',
    'PPPP.GGGGGG.PPPP',
    'PPPPP.GGGG.PPPPP',
    'PPPP..GGGG..PPPP',
    '.PP..GGGGGG..PP.',
    '....GGG..GGG....',
    '...GG......GG...',
    '..GG........GG..',
    '................',
    '................'
  ]

  const SHIP = [
    '................',
    '.......WW.......',
    '.......WW.......',
    '......WWWW......',
    '......WWWW......',
    '.....WWWWWW.....',
    '.R...WWWWWW...R.',
    'RRR..WRRRRW..RRR',
    'RRR.WWRRRRWW.RRR',
    'RRRWWWWRRWWWWRRR',
    'RRRWWWWRRWWWWRRR',
    'RBBWWWWWWWWWWBBR',
    'RBB.WW.WW.WW.BBR',
    '.B..W...W...W.B.',
    '................',
    '................'
  ]

  const P_BEE = { Y: '#ffd83d', B: '#3d7cff' }
  const P_BUTTERFLY = { R: '#ff3b30', W: '#ffffff' }
  const P_BOSS = { G: '#2fd94f', P: '#c04cff' }
  const P_BOSS_HURT = { G: '#2fd94f', P: '#ff3b30' }
  const P_SHIP = { W: '#ffffff', R: '#ff3b30', B: '#3d7cff' }
  const P_CAPTIVE = { W: '#ff9a3d', R: '#ff3b30', B: '#c04cff' }

  const Sprites = {
    bee: bake(BEE, P_BEE),
    butterfly: bake(BUTTERFLY, P_BUTTERFLY),
    boss: bake(BOSS, P_BOSS),
    bossHurt: bake(BOSS, P_BOSS_HURT),
    ship: bake(SHIP, P_SHIP),
    captive: bake(SHIP, P_CAPTIVE),

    /** Small ship icon used for the remaining-lives row. */
    lifeIcon: bake(SHIP, P_SHIP),

    /** Stage badges awarded at the bottom-right of the HUD. */
    badge (value) {
      return BADGES[value]
    },

    /** Draw a baked sprite centred at (x, y) and rotated to face `heading`. */
    draw (ctx, sprite, x, y, heading, alpha) {
      ctx.save()
      if (alpha != null) ctx.globalAlpha = alpha
      ctx.translate(x, y)
      if (heading) ctx.rotate(heading + Math.PI / 2)
      ctx.drawImage(sprite, -sprite.cx, -sprite.cy)
      ctx.restore()
    }
  }

  /* --- Stage badges ------------------------------------------------------ */

  const BADGE_ROWS = [
    '..oooo..',
    '.o####o.',
    'o##..##o',
    'o#....#o',
    'o#....#o',
    'o##..##o',
    '.o####o.',
    '..oooo..'
  ]

  function badgeSprite (color, dark) {
    return bake(BADGE_ROWS, { '#': color, o: dark }, 1)
  }

  const BADGES = {
    1: badgeSprite('#3d7cff', '#1a3a80'),
    5: badgeSprite('#ff3b30', '#801a16'),
    10: badgeSprite('#3dd6ff', '#166b80'),
    20: badgeSprite('#ffd83d', '#806c1a'),
    30: badgeSprite('#2fd94f', '#166b25'),
    50: badgeSprite('#ffffff', '#808080')
  }

  G.Sprites = Sprites
})(window)
