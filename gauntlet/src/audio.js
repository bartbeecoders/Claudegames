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
    master.gain.value = 0.3
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
    const t0 = ctx.currentTime + (opts.delay || 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type || 'square'
    osc.frequency.setValueAtTime(opts.from, t0)
    if (opts.to != null) {
      if (opts.curve === 'linear') osc.frequency.linearRampToValueAtTime(opts.to, t0 + opts.dur)
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur)
    }
    env(gain, t0, 0.005, opts.dur * 0.5, opts.dur * 0.5, opts.vol == null ? 0.22 : opts.vol)
    osc.connect(gain).connect(master)
    osc.start(t0)
    osc.stop(t0 + opts.dur + 0.1)
  }

  /** Filtered noise burst, used for impacts and rubble. */
  function noise (opts) {
    if (!ready || muted) return
    const t0 = ctx.currentTime + (opts.delay || 0)
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(opts.from || 2400, t0)
    filter.frequency.exponentialRampToValueAtTime(opts.to || 180, t0 + opts.dur)
    const gain = ctx.createGain()
    env(gain, t0, 0.008, opts.dur * 0.3, opts.dur * 0.7, opts.vol == null ? 0.35 : opts.vol)
    src.connect(filter).connect(gain).connect(master)
    src.start(t0)
    src.stop(t0 + opts.dur + 0.1)
  }

  /* --- Music ---------------------------------------------------------------

     A slow minor ostinato, scheduled ahead on the WebAudio clock so it keeps
     time regardless of frame rate. Offsets are semitones from the root; `null`
     is a rest. */
  const ROOT = 49 // low G#
  const BASS = [0, null, 0, null, 3, null, 0, null, 5, null, 3, null, 0, null, -2, null]
  const PAD = [12, null, null, null, 15, null, null, null, 17, null, null, null, 15, null, 14, null]

  const LOOKAHEAD = 0.15
  const TICK = 25

  let musicTimer = null
  let musicStep = 0
  let musicNext = 0
  let stepDur = 0.17

  function semi (n) {
    return ROOT * Math.pow(2, n / 12)
  }

  function scheduleStep (t, i) {
    const b = BASS[i]
    if (b != null) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(semi(b), t)
      env(gain, t, 0.01, stepDur * 0.4, stepDur * 0.9, 0.15)
      osc.connect(gain).connect(master)
      osc.start(t)
      osc.stop(t + stepDur * 1.6)
    }

    const p = PAD[i]
    if (p == null) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900, t)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(semi(p), t)
    env(gain, t, 0.05, stepDur * 0.6, stepDur * 1.4, 0.05)
    osc.connect(filter).connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + stepDur * 2.2)
  }

  function musicTick () {
    if (!ready) return
    // Timers are throttled hard in a backgrounded tab, so pick the loop back up
    // at the current time instead of replaying every note that was missed.
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
      /* Chrome throws if the page has not been interacted with yet. */
    }
  }

  const Sfx = {
    init,
    resume,
    vibrate,

    get muted () {
      return muted
    },

    toggleMute () {
      muted = !muted
      if (master) master.gain.value = muted ? 0 : 0.3
      return muted
    },

    music: {
      /** @param {number} level — the loop tightens a little as levels climb. */
      start (level) {
        resume()
        if (!ready) return
        stepDur = Math.max(0.12, 0.175 - (level || 1) * 0.004)
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

    shoot () {
      tone({ type: 'square', from: 1100, to: 380, dur: 0.08, vol: 0.12 })
      tone({ type: 'sawtooth', from: 2000, to: 600, dur: 0.05, vol: 0.04 })
    },

    monsterHit () {
      noise({ from: 2200, to: 400, dur: 0.09, vol: 0.2 })
    },

    monsterDie () {
      noise({ from: 2600, to: 200, dur: 0.22, vol: 0.28 })
      tone({ type: 'square', from: 260, to: 70, dur: 0.18, vol: 0.09 })
    },

    generatorDie () {
      noise({ from: 1800, to: 90, dur: 0.5, vol: 0.4 })
      tone({ type: 'sawtooth', from: 200, to: 40, dur: 0.45, vol: 0.14 })
      vibrate(25)
    },

    wallBreak () {
      noise({ from: 1400, to: 300, dur: 0.16, vol: 0.22 })
    },

    food () {
      const notes = [523, 659, 784]
      notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.11, vol: 0.2, delay: i * 0.06 }))
    },

    treasure () {
      tone({ type: 'square', from: 988, dur: 0.06, vol: 0.16 })
      tone({ type: 'square', from: 1319, dur: 0.14, vol: 0.16, delay: 0.06 })
    },

    key () {
      tone({ type: 'square', from: 1175, dur: 0.08, vol: 0.18 })
      tone({ type: 'square', from: 1568, dur: 0.16, vol: 0.18, delay: 0.08 })
    },

    door () {
      noise({ from: 700, to: 120, dur: 0.35, vol: 0.3 })
    },

    potionPickup () {
      const notes = [659, 880, 1175]
      notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.1, vol: 0.18, delay: i * 0.05 }))
    },

    /** The screen-clearing blast. */
    magic () {
      noise({ from: 5000, to: 120, dur: 0.9, vol: 0.45 })
      for (let i = 0; i < 5; i++) {
        tone({ type: 'sawtooth', from: 1600 - i * 240, to: 120, dur: 0.5, vol: 0.1, delay: i * 0.05 })
      }
      vibrate([40, 30, 40])
    },

    hurt () {
      tone({ type: 'sawtooth', from: 320, to: 120, dur: 0.16, vol: 0.2 })
      vibrate(35)
    },

    playerDie () {
      noise({ from: 1600, to: 80, dur: 1.0, vol: 0.45 })
      tone({ type: 'sawtooth', from: 380, to: 40, dur: 0.9, vol: 0.18 })
      vibrate([80, 60, 120])
    },

    /** Rising warning when health runs low — the game's most famous nag. */
    lowHealth () {
      tone({ type: 'square', from: 440, to: 660, dur: 0.14, vol: 0.14 })
    },

    levelStart () {
      const seq = [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36], [659, 0.5], [784, 0.62]]
      seq.forEach(([f, d]) => tone({ type: 'square', from: f, dur: 0.13, vol: 0.14, delay: d }))
    },

    levelClear () {
      const seq = [523, 659, 784, 1047, 1319]
      seq.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.16, vol: 0.2, delay: i * 0.09 }))
      vibrate(30)
    },

    deathAppear () {
      tone({ type: 'sawtooth', from: 90, to: 260, dur: 1.1, vol: 0.16, curve: 'linear' })
      tone({ type: 'sawtooth', from: 94, to: 268, dur: 1.1, vol: 0.16, curve: 'linear' })
      vibrate([60, 40, 60])
    },

    gameOver () {
      const seq = [[440, 0], [349, 0.24], [294, 0.48], [220, 0.72]]
      seq.forEach(([f, d]) => tone({ type: 'sawtooth', from: f, to: f * 0.97, dur: 0.32, vol: 0.2, delay: d }))
    },

    select () {
      tone({ type: 'square', from: 784, dur: 0.06, vol: 0.16 })
    }
  }

  G.Sfx = Sfx
})(window)
