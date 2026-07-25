/* Procedural sound effects and music, synthesised with the WebAudio API.
   Nothing is loaded from disk, so the game stays a single self-contained folder. */
(function (global) {
  'use strict'

  const G = global.G

  let ctx = null
  let master = null
  let noiseBuffer = null
  let muted = false
  let ready = false

  /** Lazily create the AudioContext; browsers require a user gesture first. */
  function init () {
    if (ready) return
    const AC = global.AudioContext || global.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.32
    master.connect(ctx.destination)

    const len = ctx.sampleRate * 0.6
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    ready = true
  }

  function resume () {
    if (!ready) init()
    if (ctx && ctx.state === 'suspended') ctx.resume()
  }

  function now () {
    return ctx.currentTime
  }

  function env (node, t0, attack, hold, release, peak) {
    const g = node.gain
    g.setValueAtTime(0.0001, t0)
    g.exponentialRampToValueAtTime(peak, t0 + attack)
    g.setValueAtTime(peak, t0 + attack + hold)
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release)
  }

  /** One shot oscillator with an optional frequency sweep. */
  function tone (opts) {
    if (!ready || muted) return
    const t0 = now() + (opts.delay || 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type || 'square'
    osc.frequency.setValueAtTime(opts.from, t0)
    if (opts.to != null) {
      if (opts.curve === 'linear') osc.frequency.linearRampToValueAtTime(opts.to, t0 + opts.dur)
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur)
    }
    env(gain, t0, 0.005, opts.dur * 0.5, opts.dur * 0.5, opts.vol == null ? 0.25 : opts.vol)
    osc.connect(gain).connect(master)
    osc.start(t0)
    osc.stop(t0 + opts.dur + 0.1)
  }

  /** Filtered noise burst, used for explosions. */
  function noise (opts) {
    if (!ready || muted) return
    const t0 = now() + (opts.delay || 0)
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(opts.from || 2400, t0)
    filter.frequency.exponentialRampToValueAtTime(opts.to || 180, t0 + opts.dur)
    const gain = ctx.createGain()
    env(gain, t0, 0.008, opts.dur * 0.3, opts.dur * 0.7, opts.vol == null ? 0.4 : opts.vol)
    src.connect(filter).connect(gain).connect(master)
    src.start(t0)
    src.stop(t0 + opts.dur + 0.1)
  }

  /* --- Music -------------------------------------------------------------

     A short looping bass-and-arpeggio figure, sequenced on the WebAudio clock
     rather than on rAF: notes are scheduled a fraction of a second ahead of
     time, so the groove stays steady even when the frame rate does not.

     Offsets are semitones from the root. `null` in the arp line is a rest. */
  const ROOT = 55 // A1
  const BASS = [0, 0, 7, 0, 5, 5, 0, 5, 3, 3, 10, 3, 5, 7, 5, 3]
  const ARP = [
    12, null, 19, null, 16, null, 19, null,
    15, null, 22, null, 19, null, 16, null
  ]

  const LOOKAHEAD = 0.15 // seconds of notes to keep queued
  const TICK = 25 // ms between scheduler wake-ups

  let musicTimer = null
  let musicStep = 0
  let musicNext = 0
  let stepDur = 0.125

  function semi (n) {
    return ROOT * Math.pow(2, n / 12)
  }

  /** Queue the two voices for one 16th-note slot at absolute time `t`. */
  function scheduleStep (t, i) {
    const bass = ctx.createOscillator()
    const bassGain = ctx.createGain()
    bass.type = 'triangle'
    bass.frequency.setValueAtTime(semi(BASS[i]), t)
    env(bassGain, t, 0.006, stepDur * 0.25, stepDur * 0.6, 0.16)
    bass.connect(bassGain).connect(master)
    bass.start(t)
    bass.stop(t + stepDur * 1.2)

    const a = ARP[i]
    if (a == null) return
    const lead = ctx.createOscillator()
    const leadGain = ctx.createGain()
    lead.type = 'square'
    lead.frequency.setValueAtTime(semi(a), t)
    env(leadGain, t, 0.004, stepDur * 0.15, stepDur * 0.5, 0.05)
    lead.connect(leadGain).connect(master)
    lead.start(t)
    lead.stop(t + stepDur * 1.2)
  }

  function musicTick () {
    if (!ready) return
    // Timers are throttled hard in a backgrounded tab, so the queue can fall
    // arbitrarily far behind. Pick the groove back up at the current time
    // instead of scheduling every note that was missed in the meantime.
    if (musicNext < ctx.currentTime) musicNext = ctx.currentTime + 0.02
    while (musicNext < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(musicNext, musicStep)
      musicNext += stepDur
      musicStep = (musicStep + 1) % BASS.length
    }
  }

  /** Short haptic pulse, silenced along with the audio. */
  function vibrate (pattern) {
    if (muted || !global.navigator || !global.navigator.vibrate) return
    try {
      global.navigator.vibrate(pattern)
    } catch (e) {
      /* Chrome throws if the page hasn't been interacted with yet. */
    }
  }

  const Sfx = {
    init,
    resume,
    vibrate,

    /** Looping background music. Safe to call redundantly. */
    music: {
      /** @param {number} difficulty 0..1 — nudges the tempo up as stages climb. */
      start (difficulty) {
        resume()
        if (!ready) return
        stepDur = 0.135 - Math.min(0.045, (difficulty || 0) * 0.05)
        if (musicTimer) return
        musicStep = 0
        musicNext = ctx.currentTime + 0.06
        musicTick()
        musicTimer = global.setInterval(musicTick, TICK)
      },

      stop () {
        if (!musicTimer) return
        global.clearInterval(musicTimer)
        musicTimer = null
      },

      get playing () {
        return musicTimer !== null
      }
    },

    get muted () {
      return muted
    },

    toggleMute () {
      muted = !muted
      if (master) master.gain.value = muted ? 0 : 0.32
      return muted
    },

    shoot () {
      tone({ type: 'square', from: 1400, to: 420, dur: 0.09, vol: 0.16 })
      tone({ type: 'sawtooth', from: 2600, to: 700, dur: 0.06, vol: 0.05 })
    },

    enemyKill () {
      noise({ from: 3200, to: 220, dur: 0.26, vol: 0.34 })
      tone({ type: 'square', from: 320, to: 60, dur: 0.2, vol: 0.1 })
    },

    bossHit () {
      tone({ type: 'square', from: 900, to: 500, dur: 0.07, vol: 0.2 })
    },

    playerDeath () {
      vibrate(70)
      noise({ from: 1800, to: 90, dur: 0.9, vol: 0.5 })
      tone({ type: 'sawtooth', from: 420, to: 40, dur: 0.8, vol: 0.18 })
      tone({ type: 'square', from: 300, to: 30, dur: 0.9, vol: 0.12, delay: 0.05 })
    },

    dive () {
      tone({ type: 'sawtooth', from: 880, to: 210, dur: 0.34, vol: 0.07 })
    },

    beam () {
      // Warbling tractor beam: two detuned saws sweeping upward.
      tone({ type: 'sawtooth', from: 180, to: 760, dur: 0.85, vol: 0.09, curve: 'linear' })
      tone({ type: 'sawtooth', from: 186, to: 780, dur: 0.85, vol: 0.09, curve: 'linear' })
    },

    captured () {
      vibrate([25, 45, 25, 45, 60])
      for (let i = 0; i < 6; i++) {
        tone({ type: 'square', from: 300 + i * 130, to: 900 + i * 130, dur: 0.12, vol: 0.13, delay: i * 0.1 })
      }
    },

    rescue () {
      vibrate(30)
      const notes = [523, 659, 784, 1047, 1319]
      notes.forEach((f, i) => tone({ type: 'square', from: f, dur: 0.13, vol: 0.2, delay: i * 0.08 }))
    },

    extraLife () {
      const notes = [784, 1047, 1319, 1568]
      notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.16, vol: 0.24, delay: i * 0.07 }))
    },

    coin () {
      tone({ type: 'square', from: 988, dur: 0.07, vol: 0.22 })
      tone({ type: 'square', from: 1319, dur: 0.24, vol: 0.22, delay: 0.07 })
    },

    /** Short fanfare that opens every stage. */
    stageStart () {
      const seq = [
        [523, 0.0], [659, 0.11], [784, 0.22], [1047, 0.33],
        [784, 0.47], [1047, 0.58], [1319, 0.69]
      ]
      seq.forEach(([f, d]) => tone({ type: 'square', from: f, dur: 0.12, vol: 0.16, delay: d }))
    },

    challengeStart () {
      const seq = [880, 988, 1047, 1175, 1319, 1175, 1319, 1568]
      seq.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.11, vol: 0.16, delay: i * 0.09 }))
    },

    perfect () {
      const seq = [1047, 1319, 1568, 2093]
      seq.forEach((f, i) => tone({ type: 'square', from: f, dur: 0.2, vol: 0.22, delay: i * 0.12 }))
    },

    gameOver () {
      const seq = [[523, 0], [415, 0.22], [349, 0.44], [262, 0.66]]
      seq.forEach(([f, d]) => tone({ type: 'sawtooth', from: f, to: f * 0.98, dur: 0.3, vol: 0.2, delay: d }))
    }
  }

  G.Sfx = Sfx
})(window)
