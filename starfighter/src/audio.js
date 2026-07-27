/* Every sound in the game, synthesised in the browser at runtime — there is no
   audio file anywhere in this repository.

   The effects are built the way the originals were: a blaster is a fast
   downward sweep with a slapback echo (the real thing was a hammer struck on a
   guy wire), an explosion is filtered noise falling through a sub drop, and
   the enemy fighter scream is a resonant sweep chasing a vibrato'd saw.

   The score is an original theme, sequenced with a lookahead scheduler so it
   stays in time regardless of what the frame rate is doing. */
(function (global) {
  'use strict'

  const G = global.G

  let ctx = null
  let master = null      // everything, post compressor
  let sfxBus = null
  let musicBus = null
  let noiseBuf = null
  let ready = false
  let muted = false

  /* Listener state, refreshed by the game each frame so positional sounds can
     be panned and attenuated without a full HRTF panner per voice. */
  const ear = { pos: G.v3(), right: G.v3(1, 0, 0), fwd: G.v3(0, 0, -1) }

  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12)

  function init () {
    if (ready) return
    const AC = global.AudioContext || global.webkitAudioContext
    if (!AC) return
    ctx = new AC()

    master = ctx.createGain()
    master.gain.value = 0.85
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 22
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.22
    master.connect(comp).connect(ctx.destination)

    sfxBus = ctx.createGain()
    sfxBus.gain.value = 0.62
    sfxBus.connect(master)

    musicBus = ctx.createGain()
    musicBus.gain.value = 0
    musicBus.connect(master)

    const len = Math.floor(ctx.sampleRate * 1.2)
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    ready = true
  }

  /** Audio contexts start suspended until the page has seen a gesture. */
  function resume () {
    if (!ready) init()
    if (ctx && ctx.state === 'suspended') ctx.resume()
  }

  /* ------------------------------------------------------------ routing -- */

  /* Cutting a finished voice out of the graph matters more than it looks: the
     blaster's slapback is a delay feeding itself, and a cycle like that never
     quite reaches silence, so the browser will happily keep every shot you
     have ever fired alive and mixing. Each voice retires its own subgraph. */
  const retire = (node, after) => {
    setTimeout(() => {
      try { node.disconnect() } catch (e) { /* already gone */ }
    }, (after + 0.4) * 1000)
  }

  /** A gain node panned and attenuated for a world position. Distance rolls
      off gently — space battles are not the place for inverse-square. */
  function place (pos, refDist) {
    const g = ctx.createGain()
    if (!pos) {
      g.connect(sfxBus)
      return { node: g, gain: 1, tail: after => retire(g, after) }
    }
    const dx = pos.x - ear.pos.x, dy = pos.y - ear.pos.y, dz = pos.z - ear.pos.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
    const ref = refDist || 260
    const atten = ref / (ref + dist * dist / ref)
    let out = g
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = G.clamp((dx * ear.right.x + dy * ear.right.y + dz * ear.right.z) / dist, -1, 1) * 0.85
      g.connect(p)
      out = p
    }
    out.connect(sfxBus)
    const outer = out
    return { node: g, gain: atten, tail: after => retire(outer, after) }
  }

  const noiseSource = (t0, dur, rate) => {
    const s = ctx.createBufferSource()
    s.buffer = noiseBuf
    s.playbackRate.value = rate || 1
    s.loop = true
    s.start(t0)
    s.stop(t0 + dur + 0.05)
    return s
  }

  /* -------------------------------------------------------------- voices -- */

  /** The player's cannon: a bright sweep, a noise transient for the arc, and a
      short feedback delay that gives it the metallic ring. */
  function blaster (pos, enemy) {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const dur = enemy ? 0.2 : 0.17
    const { node, gain, tail } = place(pos, enemy ? 220 : 900)
    if (gain < 0.02) { node.disconnect(); return }
    tail(dur + 0.6)

    const osc = ctx.createOscillator()
    osc.type = enemy ? 'square' : 'sawtooth'
    const hi = enemy ? 1250 : 2100
    const lo = enemy ? 110 : 190
    osc.frequency.setValueAtTime(hi, t0)
    osc.frequency.exponentialRampToValueAtTime(lo, t0 + dur * 0.85)

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 3.2
    bp.frequency.setValueAtTime(hi * 1.1, t0)
    bp.frequency.exponentialRampToValueAtTime(lo * 2, t0 + dur)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(0.5 * gain, t0 + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

    // Slapback: two short taps with feedback, the twang of a struck wire.
    const delay = ctx.createDelay(0.2)
    delay.delayTime.value = enemy ? 0.052 : 0.038
    const fb = ctx.createGain()
    fb.gain.value = 0.32
    const wet = ctx.createGain()
    wet.gain.value = 0.5

    osc.connect(bp).connect(env).connect(node)
    env.connect(delay)
    delay.connect(fb).connect(delay)
    delay.connect(wet).connect(node)

    const crack = noiseSource(t0, 0.05)
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.22 * gain, t0)
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    crack.connect(hp).connect(cg).connect(node)

    osc.start(t0)
    osc.stop(t0 + dur + 0.25)
  }

  /** Proton torpedo away: a whoosh with a hollow rising tail. */
  function torpedo (pos) {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const { node, gain, tail } = place(pos, 700)
    tail(0.9)
    const src = noiseSource(t0, 0.7)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.6
    bp.frequency.setValueAtTime(320, t0)
    bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.45 * gain, t0 + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65)
    src.connect(bp).connect(g).connect(node)

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(120, t0)
    osc.frequency.exponentialRampToValueAtTime(600, t0 + 0.5)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t0)
    og.gain.exponentialRampToValueAtTime(0.16 * gain, t0 + 0.06)
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6)
    osc.connect(og).connect(node)
    osc.start(t0)
    osc.stop(t0 + 0.8)
  }

  /** Explosion. `size` scales both the length and how far down it falls, so a
      fighter pops and a capital ship rolls for three seconds. */
  function explosion (size, pos) {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const s = G.clamp(size || 1, 0.4, 4)
    const dur = 0.55 + s * 0.75
    const { node, gain, tail } = place(pos, 500 + s * 900)
    if (gain < 0.015) { node.disconnect(); return }
    tail(dur)

    const src = noiseSource(t0, dur, 0.85)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(4200 / s, t0)
    lp.frequency.exponentialRampToValueAtTime(90, t0 + dur)
    lp.Q.value = 1.4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.85 * gain, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(lp).connect(g).connect(node)

    // Sub drop: the part you feel rather than hear.
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(150 / s, t0)
    sub.frequency.exponentialRampToValueAtTime(26, t0 + dur * 0.8)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.0001, t0)
    sg.gain.exponentialRampToValueAtTime(0.7 * gain, t0 + 0.03)
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    sub.connect(sg).connect(node)
    sub.start(t0)
    sub.stop(t0 + dur + 0.1)

    // Debris crackle for the bigger ones.
    if (s > 1.4) {
      const cr = noiseSource(t0 + 0.1, dur * 0.8, 1.6)
      const cf = ctx.createBiquadFilter()
      cf.type = 'bandpass'
      cf.frequency.value = 2600
      cf.Q.value = 0.7
      const cg = ctx.createGain()
      cg.gain.setValueAtTime(0.0001, t0 + 0.1)
      cg.gain.exponentialRampToValueAtTime(0.2 * gain, t0 + 0.2)
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      cr.connect(cf).connect(cg).connect(node)
    }
  }

  /** Enemy fighter fly-by: the howl that tells you something just crossed your
      canopy. A vibrato'd saw chased by a resonant sweep. */
  function scream (pos) {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const { node, gain, tail } = place(pos, 320)
    if (gain < 0.05) { node.disconnect(); return }
    const dur = 0.85
    tail(dur)

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(240, t0)
    osc.frequency.exponentialRampToValueAtTime(150, t0 + dur)

    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(11, t0)
    lfo.frequency.linearRampToValueAtTime(24, t0 + dur)
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 42
    lfo.connect(lfoGain).connect(osc.frequency)

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 9
    bp.frequency.setValueAtTime(700, t0)
    bp.frequency.exponentialRampToValueAtTime(2100, t0 + dur * 0.45)
    bp.frequency.exponentialRampToValueAtTime(420, t0 + dur)

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.4 * gain, t0 + 0.12)
    g.gain.setValueAtTime(0.4 * gain, t0 + dur * 0.55)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

    const air = noiseSource(t0, dur, 1.1)
    const ag = ctx.createGain()
    ag.gain.value = 0.09 * gain
    const af = ctx.createBiquadFilter()
    af.type = 'bandpass'
    af.frequency.value = 1400
    air.connect(af).connect(ag).connect(node)

    osc.connect(bp).connect(g).connect(node)
    osc.start(t0); osc.stop(t0 + dur + 0.05)
    lfo.start(t0); lfo.stop(t0 + dur + 0.05)
  }

  /** Something hit you. Shields ring, hull thuds. */
  function impact (shield, pos) {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const { node, gain, tail } = place(pos, 600)
    const dur = shield ? 0.35 : 0.5
    tail(dur)

    const osc = ctx.createOscillator()
    osc.type = shield ? 'sine' : 'triangle'
    osc.frequency.setValueAtTime(shield ? 880 : 190, t0)
    osc.frequency.exponentialRampToValueAtTime(shield ? 320 : 48, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime((shield ? 0.3 : 0.5) * gain, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(node)
    osc.start(t0); osc.stop(t0 + dur + 0.05)

    const n = noiseSource(t0, dur * 0.6, 1)
    const f = ctx.createBiquadFilter()
    f.type = shield ? 'highpass' : 'lowpass'
    f.frequency.value = shield ? 2200 : 900
    const ng = ctx.createGain()
    ng.gain.setValueAtTime((shield ? 0.22 : 0.34) * gain, t0)
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6)
    n.connect(f).connect(ng).connect(node)
  }

  /** Short UI blips: target lock, menu moves, warnings. */
  function beep (freq, dur, vol, type, delay) {
    if (!ready || muted) return
    const t0 = ctx.currentTime + (delay || 0)
    const osc = ctx.createOscillator()
    osc.type = type || 'square'
    osc.frequency.setValueAtTime(freq, t0)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(sfxBus)
    osc.start(t0); osc.stop(t0 + dur + 0.02)
  }

  /** The jump to lightspeed: a long rise that snaps into a pressure wave. */
  function hyperspace () {
    if (!ready || muted) return
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(60, t0)
    osc.frequency.exponentialRampToValueAtTime(2400, t0 + 1.1)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(300, t0)
    lp.frequency.exponentialRampToValueAtTime(9000, t0 + 1.15)
    lp.Q.value = 6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35)
    osc.connect(lp).connect(g).connect(sfxBus)
    osc.start(t0); osc.stop(t0 + 1.4)

    const boom = noiseSource(t0 + 1.05, 1.2, 0.6)
    const bf = ctx.createBiquadFilter()
    bf.type = 'lowpass'
    bf.frequency.setValueAtTime(2000, t0 + 1.05)
    bf.frequency.exponentialRampToValueAtTime(60, t0 + 2.1)
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0.0001, t0 + 1.05)
    bg.gain.exponentialRampToValueAtTime(0.55, t0 + 1.1)
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1)
    boom.connect(bf).connect(bg).connect(sfxBus)
  }

  /* -------------------------------------------------------- engine loop -- */

  /* One permanently running voice whose filter and pitch follow the throttle.
     Cutting it off and restarting it would click, so it simply idles at zero
     gain whenever the ship is not flying. */
  let engineNodes = null

  function startEngine () {
    if (!ready || engineNodes) return
    const t0 = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noiseBuf
    src.loop = true
    src.playbackRate.value = 0.55
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 320
    lp.Q.value = 1.2
    const rumble = ctx.createGain()
    rumble.gain.value = 0

    const oscA = ctx.createOscillator()
    oscA.type = 'sawtooth'
    oscA.frequency.value = 62
    const oscB = ctx.createOscillator()
    oscB.type = 'sawtooth'
    oscB.frequency.value = 78
    const tone = ctx.createGain()
    tone.gain.value = 0
    const toneLp = ctx.createBiquadFilter()
    toneLp.type = 'lowpass'
    toneLp.frequency.value = 420

    src.connect(lp).connect(rumble).connect(sfxBus)
    oscA.connect(toneLp)
    oscB.connect(toneLp)
    toneLp.connect(tone).connect(sfxBus)

    src.start(t0)
    oscA.start(t0)
    oscB.start(t0)
    engineNodes = { src, lp, rumble, oscA, oscB, tone, toneLp }
  }

  /** Called every frame. `power` is 0..1.4, where over 1 is the boost. */
  function engine (power) {
    if (!ready || !engineNodes) return
    const n = engineNodes
    const t = ctx.currentTime
    const p = G.clamp(power, 0, 1.6)
    const vol = muted ? 0 : 1
    n.rumble.gain.setTargetAtTime(0.16 * p * vol, t, 0.12)
    n.tone.gain.setTargetAtTime(0.055 * p * p * vol, t, 0.12)
    n.lp.frequency.setTargetAtTime(220 + p * 520, t, 0.15)
    n.toneLp.frequency.setTargetAtTime(300 + p * 900, t, 0.15)
    n.oscA.frequency.setTargetAtTime(52 + p * 46, t, 0.2)
    n.oscB.frequency.setTargetAtTime(66 + p * 58, t, 0.2)
    n.src.playbackRate.setTargetAtTime(0.45 + p * 0.5, t, 0.2)
  }

  /* -------------------------------------------------------------- music -- */

  /* An original theme in D minor. One sixteen-step riff is transposed per bar,
     the brass carries a four-bar melody over the top, and the whole thing is
     scheduled a fifth of a second ahead of the clock so it never stutters when
     a frame runs long. */

  const CUES = {
    // Wide, hopeful, the fleet forming up.
    launch: {
      bpm: 96,
      bars: [0, 0, -4, -2],
      bass: [0, null, null, 0, null, 7, null, null, 0, null, null, 5, null, null, 3, null],
      melody: [
        { s: 0, n: 62, d: 6 }, { s: 6, n: 69, d: 4 }, { s: 10, n: 67, d: 2 },
        { s: 12, n: 65, d: 4 },
        { s: 16, n: 64, d: 6 }, { s: 22, n: 62, d: 4 }, { s: 26, n: 69, d: 6 },
        { s: 32, n: 70, d: 8 }, { s: 40, n: 69, d: 4 }, { s: 44, n: 65, d: 4 },
        { s: 48, n: 67, d: 12 }, { s: 60, n: 62, d: 4 }
      ],
      pad: [[38, 45, 53], [36, 43, 52], [34, 41, 50], [36, 43, 48]],
      drums: [0, null, null, null, null, null, null, null, 8, null, null, null, null, null, null, null],
      gain: 0.5
    },
    // Driving, the dogfight.
    battle: {
      bpm: 132,
      bars: [0, 0, 3, -2],
      bass: [0, 0, null, 0, 12, null, 0, null, 0, 0, null, 7, null, 0, 10, null],
      melody: [
        { s: 0, n: 74, d: 3 }, { s: 3, n: 74, d: 2 }, { s: 5, n: 72, d: 3 },
        { s: 8, n: 70, d: 4 }, { s: 12, n: 69, d: 4 },
        { s: 16, n: 74, d: 3 }, { s: 19, n: 77, d: 5 }, { s: 24, n: 76, d: 8 },
        { s: 32, n: 72, d: 3 }, { s: 35, n: 74, d: 3 }, { s: 38, n: 75, d: 6 },
        { s: 44, n: 74, d: 4 },
        { s: 48, n: 70, d: 4 }, { s: 52, n: 69, d: 4 }, { s: 56, n: 67, d: 8 }
      ],
      pad: [[38, 45, 53], [38, 45, 53], [41, 48, 57], [36, 43, 52]],
      drums: [0, null, null, 4, null, null, 0, null, null, 4, null, null, 0, null, 4, null],
      gain: 0.62
    },
    // Tight, mechanical, down in the trench.
    trench: {
      bpm: 148,
      bars: [0, 0, 0, 1],
      bass: [0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 0, null],
      melody: [
        { s: 0, n: 62, d: 2 }, { s: 4, n: 63, d: 2 }, { s: 8, n: 62, d: 2 }, { s: 12, n: 60, d: 2 },
        { s: 16, n: 62, d: 2 }, { s: 20, n: 65, d: 2 }, { s: 24, n: 63, d: 4 },
        { s: 32, n: 62, d: 2 }, { s: 36, n: 63, d: 2 }, { s: 40, n: 65, d: 2 }, { s: 44, n: 67, d: 2 },
        { s: 48, n: 68, d: 6 }, { s: 56, n: 67, d: 6 }
      ],
      pad: [[38, 45, 50], [38, 45, 50], [38, 44, 51], [39, 46, 51]],
      drums: [0, null, 8, null, 0, null, 8, null, 0, null, 8, null, 0, 8, 0, 8],
      gain: 0.55
    }
  }

  let cue = null
  let cueName = null
  let step = 0
  let nextTime = 0
  let timer = null

  function bass (freq, t, dur) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = freq
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = freq * 0.5
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1400, t)
    lp.frequency.exponentialRampToValueAtTime(280, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(lp)
    sub.connect(lp)
    lp.connect(g).connect(musicBus)
    o.start(t); o.stop(t + dur + 0.05)
    sub.start(t); sub.stop(t + dur + 0.05)
  }

  /** Three detuned saws through a filter that opens on the attack: the closest
      a couple of oscillators get to a brass section. */
  function brass (freq, t, dur, vol) {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.055)
    g.gain.setValueAtTime(vol, t + dur * 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(600, t)
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.09)
    lp.frequency.exponentialRampToValueAtTime(1300, t + dur)
    lp.Q.value = 2.2

    const voices = []
    for (const cents of [-7, 0, 8]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq * Math.pow(2, cents / 1200)
      o.connect(lp)
      o.start(t); o.stop(t + dur + 0.05)
      voices.push(o)
    }
    // A touch of vibrato, but only once the note has had time to settle —
    // exactly where a player would lean on it.
    if (dur > 0.3) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 5.5
      const la = ctx.createGain()
      la.gain.setValueAtTime(0.0001, t)
      la.gain.linearRampToValueAtTime(freq * 0.007, t + dur * 0.5)
      lfo.connect(la)
      for (const o of voices) la.connect(o.frequency)
      lfo.start(t); lfo.stop(t + dur + 0.05)
    }
    lp.connect(g).connect(musicBus)
  }

  function strings (freq, t, dur) {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.075, t + dur * 0.35)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1500
    for (const det of [-5, 6]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq * Math.pow(2, det / 1200)
      o.connect(lp)
      o.start(t); o.stop(t + dur + 0.1)
    }
    lp.connect(g).connect(musicBus)
  }

  /** 0 = timpani, 4 = tom, 8 = snare. */
  function drum (kind, t) {
    if (kind === 8) {
      const n = ctx.createBufferSource()
      n.buffer = noiseBuf
      n.playbackRate.value = 1.4
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1900
      bp.Q.value = 0.8
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.26, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
      n.connect(bp).connect(g).connect(musicBus)
      n.start(t); n.stop(t + 0.2)
      return
    }
    const o = ctx.createOscillator()
    o.type = 'sine'
    const f0 = kind === 0 ? 105 : 150
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 0.28)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    o.connect(g).connect(musicBus)
    o.start(t); o.stop(t + 0.5)

    const n = ctx.createBufferSource()
    n.buffer = noiseBuf
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.12, t)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    n.connect(ng).connect(musicBus)
    n.start(t); n.stop(t + 0.1)
  }

  const LOOKAHEAD = 0.2
  const TICK = 25

  function schedule () {
    if (!ready || !cue) return
    const spb = 60 / cue.bpm / 4 // one sixteenth
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const s = step % 64
      const bar = (s / 16) | 0
      const shift = cue.bars[bar]
      const t = nextTime

      const b = cue.bass[s % 16]
      if (b !== null && b !== undefined) bass(NOTE(38 + shift + b), t, spb * 1.8)

      const d = cue.drums[s % 16]
      if (d !== null && d !== undefined) drum(d, t)

      for (const ev of cue.melody) {
        if (ev.s === s) brass(NOTE(ev.n + shift), t, spb * ev.d * 0.95, 0.11)
      }

      if (s % 16 === 0) {
        for (const n of cue.pad[bar]) strings(NOTE(n + shift), t, spb * 16)
      }

      nextTime += spb
      step++
    }
  }

  function setMusic (name) {
    if (!ready || cueName === name) return
    cueName = name
    if (!name) {
      cue = null
      if (timer) { clearInterval(timer); timer = null }
      musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
      return
    }
    const next = CUES[name]
    if (!next) return
    // Restart on a bar boundary so cue changes never land off the beat.
    cue = next
    step = 0
    nextTime = Math.max(nextTime, ctx.currentTime + 0.06)
    musicBus.gain.cancelScheduledValues(ctx.currentTime)
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime)
    musicBus.gain.linearRampToValueAtTime(muted ? 0 : next.gain, ctx.currentTime + 0.9)
    if (!timer) timer = setInterval(schedule, TICK)
  }

  /* --------------------------------------------------------------- api -- */

  G.Sfx = {
    resume () {
      resume()
      startEngine()
    },

    get ready () { return ready },

    /** Update the virtual listener; called once a frame from the game. */
    listen (pos, right) {
      G.vcopyTo(ear.pos, pos)
      G.vcopyTo(ear.right, right)
    },

    muted () { return muted },

    toggleMute () {
      muted = !muted
      if (ready) {
        master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05)
      }
      return muted
    },

    /** Pull the whole mix down while paused, without stopping the sequencer. */
    duck (on) {
      if (!ready) return
      master.gain.setTargetAtTime(muted ? 0 : (on ? 0.12 : 0.85), ctx.currentTime, 0.08)
    },

    blaster: pos => blaster(pos, false),
    enemyBlaster: pos => blaster(pos, true),
    torpedo,
    explosion,
    scream,
    engine,
    hyperspace,
    shieldHit: pos => impact(true, pos),
    hullHit: pos => impact(false, pos),
    lock: () => beep(1180, 0.05, 0.14),
    lockOn: () => { beep(1480, 0.06, 0.16); beep(1980, 0.09, 0.16, 'square', 0.07) },
    warn: () => beep(420, 0.16, 0.15, 'sawtooth'),
    ui: () => beep(760, 0.05, 0.12),
    confirm: () => { beep(680, 0.06, 0.14); beep(1020, 0.12, 0.14, 'square', 0.07) },
    powerup: () => {
      beep(560, 0.07, 0.13, 'triangle')
      beep(840, 0.07, 0.13, 'triangle', 0.07)
      beep(1260, 0.16, 0.13, 'triangle', 0.14)
    },
    music: setMusic
  }
})(window)
