/* Formation layout, entrance choreography and per-stage difficulty. */
(function (global) {
  'use strict'

  const G = global.G
  const P = G.Paths

  /* The classic 5 x 10 formation: bosses on top, then butterflies, then bees. */
  const LAYOUT = []
  function add (row, cols, kind) {
    for (const col of cols) LAYOUT.push({ row: row, col: col, kind: kind })
  }
  add(0, [3, 4, 5, 6], 'boss')
  add(1, [1, 2, 3, 4, 5, 6, 7, 8], 'butterfly')
  add(2, [1, 2, 3, 4, 5, 6, 7, 8], 'butterfly')
  add(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'bee')
  add(4, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'bee')

  const indexOfSlot = {}
  LAYOUT.forEach((s, i) => {
    indexOfSlot[s.row + ':' + s.col] = i
  })
  const idx = (row, col) => indexOfSlot[row + ':' + col]

  /* Five entrance groups of eight, matching the arcade's flight order. */
  const GROUPS = [
    // Bosses plus their butterfly escorts, straight down the middle.
    [idx(0, 3), idx(0, 4), idx(0, 5), idx(0, 6), idx(1, 3), idx(1, 4), idx(1, 5), idx(1, 6)],
    [idx(1, 1), idx(1, 2), idx(1, 7), idx(1, 8), idx(2, 3), idx(2, 4), idx(2, 5), idx(2, 6)],
    [idx(2, 1), idx(2, 2), idx(2, 7), idx(2, 8), idx(3, 4), idx(3, 5), idx(4, 4), idx(4, 5)],
    [idx(3, 0), idx(3, 1), idx(3, 2), idx(3, 3), idx(4, 0), idx(4, 1), idx(4, 2), idx(4, 3)],
    [idx(3, 6), idx(3, 7), idx(3, 8), idx(3, 9), idx(4, 6), idx(4, 7), idx(4, 8), idx(4, 9)]
  ]

  /* Entrance route per group. The side flips on alternate stages so the same
     stage never looks identical twice in a row. */
  const ROUTES = [
    { make: P.entranceTopCenter, side: 1 },
    { make: P.entranceBottom, side: -1 },
    { make: P.entranceBottom, side: 1 },
    { make: P.entranceTopSide, side: -1 },
    { make: P.entranceTopSide, side: 1 }
  ]

  /* --- Challenging stage fly-through patterns ---------------------------- */
  /* Eight squadrons of five drift through without ever stopping or shooting.
     Every route must leave the screen so the wave can end. */

  function flyLoopUp (side) {
    return new P.Turtle(G.W / 2 + side * 36, G.H + 20, -90)
      .forward(120)
      .turn(side * 360, 28)
      .forward(70)
      .turn(-side * 140, 42)
      .forward(240)
      .done()
  }

  function flyCross (side) {
    return new P.Turtle(G.W / 2 + side * 110, -20, 90)
      .forward(70)
      .turn(-side * 100, 40)
      .forward(110)
      .turn(-side * 100, 40)
      .forward(90)
      .turn(side * 190, 44)
      .forward(240)
      .done()
  }

  function flyZigzag (side) {
    const t = new P.Turtle(G.W / 2 + side * 90, -20, 90)
    t.forward(40)
    for (let i = 0; i < 3; i++) {
      t.turn(-side * 110, 26)
      t.forward(24)
      t.turn(side * 110, 26)
      t.forward(24)
    }
    return t.forward(220).done()
  }

  function flyFigureEight (side) {
    return new P.Turtle(G.W / 2 + side * 70, -20, 90)
      .forward(60)
      .turn(side * 300, 32)
      .forward(30)
      .turn(-side * 300, 32)
      .forward(240)
      .done()
  }

  function flySweepAcross (side) {
    return new P.Turtle(G.W / 2 + side * 140, 90, side > 0 ? 180 : 0)
      .forward(70)
      .turn(side * 90, 46)
      .forward(60)
      .turn(side * 90, 46)
      .forward(80)
      .turn(-side * 200, 40)
      .forward(260)
      .done()
  }

  const FLYBYS = [flyLoopUp, flyCross, flyZigzag, flyFigureEight, flySweepAcross]

  const CHALLENGE_KINDS = ['bee', 'butterfly', 'bee', 'butterfly', 'boss', 'bee', 'butterfly', 'bee']

  const Stages = {
    LAYOUT,
    GROUPS,

    /** Every fourth stage from the third is a bonus round. */
    isChallenging (stage) {
      return stage % 4 === 3
    },

    /** Build the entrance descriptor list for a normal stage. */
    entrances (stage) {
      const flip = stage % 2 === 0 ? -1 : 1
      return GROUPS.map((slots, i) => {
        const route = ROUTES[i]
        const side = route.side * flip
        return { slots: slots, path: route.make(side), side: side }
      })
    },

    /** Eight squadrons of five for a challenging stage. */
    challengeWaves (stage) {
      const waves = []
      for (let w = 0; w < 8; w++) {
        const side = w % 2 === 0 ? -1 : 1
        const make = FLYBYS[(w + stage) % FLYBYS.length]
        waves.push({
          path: make(side),
          kind: CHALLENGE_KINDS[w],
          count: 5
        })
      }
      return waves
    },

    /** Difficulty knobs, ramped over the first dozen stages. */
    tuning (stage) {
      const t = Math.min(1, (stage - 1) / 12)
      return {
        difficulty: t,
        // Frames between attack sorties.
        diveInterval: Math.round(G.lerp(115, 40, t)),
        maxDivers: Math.min(6, 2 + Math.floor(stage / 2)),
        bombScale: G.lerp(1, 2.2, t),
        // Odds that a boss opens with a capture attempt instead of a plain dive.
        captureChance: stage === 1 ? 0.35 : G.lerp(0.45, 0.75, t)
      }
    }
  }

  G.Stages = Stages
})(window)
