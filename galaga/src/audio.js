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

  const Sfx = {
    init,
    resume,

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
      for (let i = 0; i < 6; i++) {
        tone({ type: 'square', from: 300 + i * 130, to: 900 + i * 130, dur: 0.12, vol: 0.13, delay: i * 0.1 })
      }
    },

    rescue () {
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
