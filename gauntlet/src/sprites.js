/* Pixel art. Each sprite is a character grid plus a palette, baked once into an
   offscreen canvas at load time. No image files anywhere.

   Heroes share one humanoid pair of grids (front and back) and differ only by
   palette, which is how the arcade original got four distinct characters out of
   very little ROM. Facing left is the same sprite mirrored at draw time. */
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
      for (let col = 0; col < w; col++) {
        const color = palette[rows[r][col]]
        if (!color) continue
        x.fillStyle = color
        x.fillRect(col * scale, r * scale, scale, scale)
      }
    }
    return c
  }

  /* --- Heroes ------------------------------------------------------------- */

  // K outline, A armour, D armour shadow, S skin, M metal, C cloak
  const HERO_FRONT = [
    '....KKKK....',
    '...KMMMMK...',
    '...KSSSSK...',
    '...KS..SK...',
    '..KKSSSSKK..',
    '.KCKAAAAKCK.',
    'KCCKAAAAKCCK',
    'KCCKAADAKCCK',
    '.KKKAADAKKK.',
    '...KAAAAK...',
    '...KDKKDK...',
    '...KDK.KDK..',
    '..KMMK.KMMK.',
    '..KKKK.KKKK.'
  ]

  const HERO_BACK = [
    '....KKKK....',
    '...KMMMMK...',
    '...KAAAAK...',
    '...KAAAAK...',
    '..KKAAAAKK..',
    '.KCKAAAAKCK.',
    'KCCKACCAKCCK',
    'KCCKACCAKCCK',
    '.KKKACCAKKK.',
    '...KAAAAK...',
    '...KDKKDK...',
    '...KDK.KDK..',
    '..KMMK.KMMK.',
    '..KKKK.KKKK.'
  ]

  /** The four playable characters, in the arcade's own order. */
  const HEROES = {
    warrior: { name: 'WARRIOR', title: 'THOR', K: '#2a0f0a', A: '#d8452f', D: '#8f2417', S: '#f0c090', M: '#d9d9e6', C: '#7a1f14' },
    valkyrie: { name: 'VALKYRIE', title: 'THYRA', K: '#0a1430', A: '#3f7fe0', D: '#22509c', S: '#f0c090', M: '#e6e6f2', C: '#1d3f7d' },
    wizard: { name: 'WIZARD', title: 'MERLIN', K: '#1c0a2c', A: '#9a5ce0', D: '#5f2f96', S: '#f0c090', M: '#ffd83d', C: '#4a2478' },
    elf: { name: 'ELF', title: 'QUESTOR', K: '#08240f', A: '#4fbf5a', D: '#25742e', S: '#f0c090', M: '#d9d9e6', C: '#1c5424' }
  }

  /* --- Monsters ----------------------------------------------------------- */

  // K outline, B body, D shadow, E eyes, X extra
  const GRUNT = [
    '..KKKKKK..',
    '.KBBBBBBK.',
    'KBEBBBBEBK',
    'KBBBBBBBBK',
    'KBDBBBBDBK',
    'KBBDDDDBBK',
    '.KBBBBBBK.',
    'KXKBBBBKXK',
    'KXK.KK.KXK',
    '.K..KK..K.'
  ]

  const GHOST = [
    '...KKKK...',
    '..KBBBBK..',
    '.KBBBBBBK.',
    'KBEBBBBEBK',
    'KBBBBBBBBK',
    'KBBBBBBBBK',
    'KBBBBBBBBK',
    'KBKBKKBKBK',
    '.K.K..K.K.',
    '..........'
  ]

  const DEMON = [
    'K..KKKK..K',
    'KK.KBBK.KK',
    'KBKBBBBKBK',
    'KBBEBBEBBK',
    'KBBBBBBBBK',
    '.KBBDDBBK.',
    '.KBBBBBBK.',
    '..KBBBBK..',
    '..K.KK.K..',
    '..........'
  ]

  const LOBBER = [
    '..KKKKKK..',
    '.KBBBBBBK.',
    'KBBEBBEBBK',
    'KBBBBBBBBK',
    'KXBBDDBBXK',
    'KXBBBBBBXK',
    'KXKBBBBKXK',
    '.K.KBBK.K.',
    '...K..K...',
    '..........'
  ]

  const SORCERER = [
    '...KKKK...',
    '..KBBBBK..',
    '.KBEBBEBK.',
    '.KBBBBBBK.',
    'KXKBBBBKXK',
    'KXKBBBBKXK',
    '.KBBBBBBK.',
    '.KBBBBBBK.',
    '.KBBBBBBK.',
    '..KKKKKK..'
  ]

  const DEATH = [
    '..KKKKKK..',
    '.KBBBBBBK.',
    'KBBBBBBBBK',
    'KBEEBBEEBK',
    'KBEEBBEEBK',
    'KBBBBBBBBK',
    'KBBKBBKBBK',
    '.KBKKKKBK.',
    '.KXKKKKXK.',
    '..KKKKKK..'
  ]

  const MONSTERS = {
    grunt: { rows: GRUNT, K: '#2a0a0a', B: '#c8503c', D: '#8a2f22', E: '#ffe08a', X: '#8a2f22', hp: 1, score: 10 },
    ghost: { rows: GHOST, K: '#12203a', B: '#9fd8ff', D: '#5f9ac8', E: '#20304a', X: '#5f9ac8', hp: 1, score: 10 },
    demon: { rows: DEMON, K: '#3a0a20', B: '#e05fa0', D: '#96305f', E: '#fff0a0', X: '#96305f', hp: 2, score: 30 },
    lobber: { rows: LOBBER, K: '#0a2a20', B: '#4fc8a0', D: '#237a5f', E: '#fff0a0', X: '#237a5f', hp: 2, score: 30 },
    sorcerer: { rows: SORCERER, K: '#201038', B: '#b48ae8', D: '#6a4a9a', E: '#ffe08a', X: '#6a4a9a', hp: 2, score: 50 },
    death: { rows: DEATH, K: '#101010', B: '#e8e8f0', D: '#9a9ab0', E: '#ff3b30', X: '#9a9ab0', hp: 99, score: 0 }
  }

  /* --- Items -------------------------------------------------------------- */

  const FOOD = [
    '..KKKK..',
    '.KMMMMK.',
    'KMMMMMMK',
    'KMMMMMMK',
    'KMMMMMMK',
    '.KMMMMK.',
    '..KBBK..',
    '...KK...'
  ]

  const POTION = [
    '..KKKK..',
    '..KBBK..',
    '.KKBBKK.',
    '.KMMMMK.',
    'KMMMMMMK',
    'KMMMMMMK',
    'KMMMMMMK',
    '.KKKKKK.'
  ]

  const KEY = [
    '.KKKK...',
    'KMMMMK..',
    'KMKKMK..',
    'KMMMMK..',
    '.KMMK...',
    '..KMKKK.',
    '..KMKMK.',
    '..KKKKK.'
  ]

  const TREASURE = [
    '........',
    '.KKKKKK.',
    'KMMMMMMK',
    'KMBMMBMK',
    'KMMMMMMK',
    'KMBMMBMK',
    'KMMMMMMK',
    '.KKKKKK.'
  ]

  const ITEMS = {
    food: { rows: FOOD, K: '#2a1408', M: '#c8783c', B: '#f0e0c0' },
    potion: { rows: POTION, K: '#20103a', M: '#7f5fe8', B: '#c8b8ff' },
    key: { rows: KEY, K: '#3a2c08', M: '#ffd83d', B: '#ffd83d' },
    treasure: { rows: TREASURE, K: '#3a2c08', M: '#ffd83d', B: '#c8960f' }
  }

  /* --- Generators ---------------------------------------------------------- */

  /** Monster spawners: a cracked nest that pulses as it is worn down. */
  const GENERATOR = [
    '.KKKKKKKKKK.',
    'KBBDDBBDDBBK',
    'KBDDBBDDBBDK',
    'KDDBBDDBBDDK',
    'KBBDDBBDDBBK',
    'KBDDBBDDBBDK',
    'KDDBBDDBBDDK',
    'KBBDDBBDDBBK',
    'KBDDBBDDBBDK',
    'KDDBBDDBBDDK',
    'KBBDDBBDDBBK',
    '.KKKKKKKKKK.'
  ]

  /* --- Baking -------------------------------------------------------------- */

  const sprites = { hero: {}, monster: {}, item: {}, generator: {} }

  for (const key of Object.keys(HEROES)) {
    const p = HEROES[key]
    sprites.hero[key] = {
      front: bake(HERO_FRONT, p),
      back: bake(HERO_BACK, p),
      info: p
    }
  }

  for (const key of Object.keys(MONSTERS)) {
    const m = MONSTERS[key]
    sprites.monster[key] = bake(m.rows, m)
    sprites.generator[key] = bake(GENERATOR, { K: m.K, B: m.B, D: m.D })
  }

  for (const key of Object.keys(ITEMS)) {
    sprites.item[key] = bake(ITEMS[key].rows, ITEMS[key])
  }

  sprites.HEROES = HEROES
  sprites.MONSTERS = MONSTERS

  /** Draw a baked sprite centred on (x, y), optionally mirrored. */
  sprites.draw = function (ctx, img, x, y, flip) {
    const dx = Math.round(x - img.width / 2)
    const dy = Math.round(y - img.height / 2)
    if (!flip) {
      ctx.drawImage(img, dx, dy)
      return
    }
    ctx.save()
    ctx.translate(Math.round(x), 0)
    ctx.scale(-1, 1)
    ctx.drawImage(img, -Math.round(img.width / 2), dy)
    ctx.restore()
  }

  G.Sprites = sprites
})(window)
