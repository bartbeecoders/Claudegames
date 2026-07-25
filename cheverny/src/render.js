/* The renderer: one shadow pass, one forward pass with a second target for
   the ambient term, a screen-space occlusion pass that is subtracted from it,
   and a composite that tone-maps the result. */
(function (global) {
  'use strict'

  const CH = global.CH
  const m4 = CH.m4
  const clamp = CH.clamp
  const lerp = CH.lerp

  /* --- materials ----------------------------------------------------------

     pattern: 1 ashlar · 2 slate · 3 gravel · 4 grass · 5 glazing · 6 foliage
              7 louvres · 8 lead · 9 render · 10 timber · 11 blossom */

  const MATERIALS = {
    stone: { color: '#eae3ce', alt: '#ffffff', rough: 0.88, pattern: 1, bump: 1.0, spec: 0.7 },
    stoneOld: { color: '#cbc3ad', alt: '#ffffff', rough: 0.93, pattern: 1, bump: 1.3, spec: 0.7 },
    plaster: { color: '#dfd0a6', alt: '#ece0c2', rough: 0.92, pattern: 9, bump: 0.7, spec: 0.6 },
    slate: { color: '#565b61', alt: '#6d727a', rough: 0.88, pattern: 2, bump: 1.0, spec: 0.35 },
    lead: { color: '#63686e', alt: '#7d838b', rough: 0.86, pattern: 8, bump: 1.0, spec: 0.35 },
    glass: { color: '#1d2830', alt: '#d6d0c0', rough: 0.10, pattern: 5, bump: 0.6, spec: 3.0 },
    shutter: { color: '#a3ada4', alt: '#b8c0b6', rough: 0.75, pattern: 7, bump: 1.0 },
    iron: { color: '#1f3128', alt: '#2b4032', rough: 0.45, pattern: 0, spec: 2.0 },
    wood: { color: '#5d4529', alt: '#41301c', rough: 0.70, pattern: 10, bump: 0.8 },
    planter: { color: '#8d7550', alt: '#6d5a3d', rough: 0.80, pattern: 10, bump: 0.8 },
    interior: { color: '#0d0f11', alt: '#000000', rough: 1.0, pattern: 0, spec: 0.2 },
    gravel: { color: '#c0a982', alt: '#9b8763', rough: 0.95, pattern: 3, bump: 1.0 },
    whiteGravel: { color: '#d5cfc2', alt: '#b6afa0', rough: 0.95, pattern: 3, bump: 0.8 },
    grass: { color: '#4d6a2e', alt: '#5f7a38', rough: 0.98, pattern: 4, bump: 0.7 },
    hedge: { color: '#3d5226', alt: '#4a6130', rough: 0.98, pattern: 0, bump: 0.5 },
    foliage: { color: '#41582a', alt: '#5f7735', rough: 0.97, pattern: 6, bump: 0.22, spec: 0.25, cutout: true },
    cedar: { color: '#2c3a25', alt: '#3c4d2b', rough: 0.97, pattern: 6, bump: 0.22, spec: 0.2, cutout: true },
    foliageFar: { color: '#374a26', alt: '#435729', rough: 0.98, pattern: 6, bump: 0.15, spec: 0.2, cutout: true },
    trunk: { color: '#4a4238', alt: '#3a342c', rough: 0.95, pattern: 10, bump: 1.0 },
    flower: { color: '#8e2016', alt: '#bf3f27', rough: 0.90, pattern: 11, bump: 0.6, cutout: true }
  }

  /** Draw the sky and the ground before the fiddly bits, so early-Z has a
      chance, and keep the cut-out materials last. */
  const DRAW_ORDER = [
    'grass', 'gravel', 'whiteGravel', 'stone', 'stoneOld', 'plaster', 'slate',
    'lead', 'interior', 'glass', 'shutter', 'wood', 'planter', 'iron', 'trunk',
    'hedge', 'foliage', 'cedar', 'foliageFar', 'flower'
  ]

  function srgb (hex) {
    const n = parseInt(hex.slice(1), 16)
    return [
      Math.pow(((n >> 16) & 255) / 255, 2.2),
      Math.pow(((n >> 8) & 255) / 255, 2.2),
      Math.pow((n & 255) / 255, 2.2)
    ]
  }

  /* --- the sky, hour by hour ---------------------------------------------- */

  /** Sun position and light colours for a time of day, t in [0, 1] over the
      window 05:00 - 21:00. A summer arc for 47.5° N: it comes up behind the
      garden front, crosses in front of the court at midday, and goes down
      behind the west pavilion — so both long fronts get their hour of raking
      light, and the shadows swing right across the estate. */
  function sunState (t) {
    const hour = 5 + t * 16
    const day = clamp((hour - 5) / 16, 0, 1)
    const el = Math.sin(day * Math.PI) * 61 * CH.DEG - 1.5 * CH.DEG
    const az = (114 - 228 * day) * CH.DEG

    const dir = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el)
    ]

    const high = CH.smoothstep(-0.02, 0.38, dir[1])
    const dusk = 1 - CH.smoothstep(-0.03, 0.20, dir[1])
    const night = 1 - CH.smoothstep(-0.10, 0.02, dir[1])

    const sunCol = mix3(srgb('#ff7a2e'), srgb('#fff4e2'), high)
    const strength = lerp(0.25, 4.6, high) * (1 - night * 0.92)

    const zenith = mix3(mix3(srgb('#1b2a52'), srgb('#2f5aa8'), 0.4 + high * 0.4), srgb('#4f8fdd'), high)
    const horizon = mix3(srgb('#e8813c'), srgb('#c8dcf2'), CH.smoothstep(0.02, 0.30, dir[1]))

    return {
      dir,
      color: [sunCol[0] * strength, sunCol[1] * strength, sunCol[2] * strength],
      tint: sunCol,
      zenith: scale3(zenith, lerp(0.10, 1.0, 1 - night)),
      horizon: scale3(horizon, lerp(0.10, 1.0, 1 - night)),
      skyAmbient: scale3(mix3(srgb('#3c5074'), srgb('#9db2c4'), high), lerp(0.16, 0.95, 1 - night) * 0.9),
      groundBounce: scale3(mix3(srgb('#2a2f26'), srgb('#6a6350'), high), lerp(0.12, 0.6, 1 - night)),
      dusk,
      night,
      hour
    }
  }

  function mix3 (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] }
  function scale3 (a, s) { return [a[0] * s, a[1] * s, a[2] * s] }

  /* --- renderer ------------------------------------------------------------ */

  class Renderer {
    constructor (canvas) {
      const gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: true, stencil: false,
        powerPreference: 'high-performance'
      })
      if (!gl) throw new Error('WebGL 2 is not available in this browser.')
      this.gl = gl
      this.canvas = canvas

      this.float = !!gl.getExtension('EXT_color_buffer_float')
      if (this.float) gl.getExtension('OES_texture_float_linear')
      this.storeScale = this.float ? 1 : 1 / 8

      const S = CH.shaders
      const G = CH.gl
      this.pMain = new G.Program(gl, S.MAIN_VS, S.MAIN_FS, 'main')
      this.pDepth = new G.Program(gl, S.DEPTH_VS, S.DEPTH_FS, 'depth')
      this.pSky = new G.Program(gl, S.FS_TRI_VS, S.SKY_FS, 'sky')
      this.pAO = new G.Program(gl, S.FS_TRI_VS, S.SSAO_FS, 'ssao')
      this.pBlur = new G.Program(gl, S.FS_TRI_VS, S.BLUR_FS, 'blur')
      this.pPost = new G.Program(gl, S.FS_TRI_VS, S.COMPOSITE_FS, 'post')
      this.drawFS = G.fullscreen(gl)

      this.quality = { scale: 0.9, shadow: 2048, ao: true, super: false }
      this.shadow = new G.ShadowMap(gl, this.quality.shadow)
      const fmt = this.float ? gl.RGBA16F : gl.RGBA8
      this.scene = new G.Target(gl, 2, 2, { formats: [fmt, fmt] })
      this.aoA = new G.Target(gl, 2, 2, { formats: [gl.R8], depth: false })
      this.aoB = new G.Target(gl, 2, 2, { formats: [gl.R8], depth: false })

      this.lightVP = m4.create()
      this.viewProj = m4.create()
      this.invViewProj = m4.create()
      this.invProj = m4.create()

      this.time = 0.78
      this.sun = sunState(this.time)
      this.exposure = 1.25
      this.aoStrength = 0.85
      this.cloudiness = 0.45

      this.meshes = []
      this.tris = 0
    }

    /** Turn a finished Builder into GPU meshes, in a stable draw order. */
    upload (builder) {
      const gl = this.gl
      this.meshes = []
      this.tris = 0
      const names = [...builder.groups.keys()]
      names.sort((a, b) => {
        const ia = DRAW_ORDER.indexOf(a), ib = DRAW_ORDER.indexOf(b)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      })
      for (const name of names) {
        const group = builder.groups.get(name)
        if (!group.idx.length) continue
        const mesh = new CH.gl.Mesh(gl, group)
        const mat = MATERIALS[name] || MATERIALS.stone
        this.meshes.push({ mesh, mat, name })
        this.tris += mesh.tris
      }
    }

    setTime (t) {
      this.time = clamp(t, 0, 1)
      this.sun = sunState(this.time)
    }

    setQuality (q) {
      Object.assign(this.quality, q)
      if (q.shadow && q.shadow !== this.shadow.size) {
        this.shadow = new CH.gl.ShadowMap(this.gl, q.shadow)
      }
    }

    resize () {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr * this.quality.scale))
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr * this.quality.scale))
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
      }
      this.scene.resize(w, h)
      this.aoA.resize(Math.max(1, w >> 1), Math.max(1, h >> 1))
      this.aoB.resize(Math.max(1, w >> 1), Math.max(1, h >> 1))
    }

    /** Orthographic light frustum, fitted around the château and its court. */
    fitShadow () {
      const sun = this.sun
      const centre = [0, 8, -4]
      const extent = 78
      const eye = [
        centre[0] + sun.dir[0] * 200,
        centre[1] + sun.dir[1] * 200,
        centre[2] + sun.dir[2] * 200
      ]
      const view = m4.lookAt(eye, centre, [0, 1, 0])
      const proj = m4.ortho(-extent, extent, -extent, extent, 20, 420)
      m4.multiply(proj, view, this.lightVP)
    }

    drawScene (prog, depthPass) {
      for (const { mesh, mat } of this.meshes) {
        if (depthPass) {
          prog.i('uCutout', mat.cutout ? 1 : 0)
        } else {
          prog.v3('uBaseColor', srgb(mat.color))
          prog.v3('uAltColor', srgb(mat.alt || mat.color))
          prog.f('uRough', mat.rough === undefined ? 0.85 : mat.rough)
          prog.f('uSpecular', mat.spec === undefined ? 1 : mat.spec)
          prog.i('uPattern', mat.pattern || 0)
          prog.f('uBump', mat.bump === undefined ? 0 : mat.bump)
        }
        mesh.draw()
      }
    }

    skyUniforms (p) {
      const s = this.sun
      p.v3('uSunDir', s.dir)
      p.v3('uSunTint', s.tint)
      p.v3('uZenith', s.zenith)
      p.v3('uHorizon', s.horizon)
      p.f('uTime', this.clock || 0)
      p.f('uCloudiness', this.cloudiness)
    }

    render (camera, dt) {
      const gl = this.gl
      this.clock = (this.clock || 0) + (dt || 0)
      this.resize()

      const w = this.scene.w, h = this.scene.h
      const proj = camera.projection(w / h)
      const view = camera.view()
      m4.multiply(proj, view, this.viewProj)
      m4.invert(this.viewProj, this.invViewProj)
      m4.invert(proj, this.invProj)

      /* Shadow map. */
      this.fitShadow()
      this.shadow.bind()
      gl.enable(gl.DEPTH_TEST)
      gl.depthMask(true)
      gl.depthFunc(gl.LEQUAL)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.FRONT)
      this.pDepth.use().m4('uViewProj', this.lightVP)
      this.drawScene(this.pDepth, true)
      gl.cullFace(gl.BACK)

      /* Forward pass. */
      this.scene.bind()
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      const s = this.sun
      const p = this.pMain.use()
      p.m4('uViewProj', this.viewProj)
      p.v3('uCam', camera.eye)
      p.v3('uSunColor', s.color)
      p.v3('uSkyAmbient', s.skyAmbient)
      p.v3('uGroundBounce', s.groundBounce)
      p.v3('uFogColor', scale3(s.horizon, 1.05))
      p.f('uFogDensity', 0.0019)
      p.f('uStoreScale', this.storeScale)
      p.m4('uShadowMat', this.lightVP)
      p.f('uShadowTexel', 1 / this.shadow.size)
      p.f('uTexScale', CH.LAYOUT.PAV_X)
      this.skyUniforms(p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex)
      p.i('uShadow', 0)
      this.drawScene(p, false)

      /* Sky, on the far plane. */
      gl.depthMask(false)
      const sk = this.pSky.use()
      sk.m4('uInvViewProj', this.invViewProj)
      sk.v3('uCam', camera.eye)
      sk.f('uStoreScale', this.storeScale)
      this.skyUniforms(sk)
      this.drawFS()
      gl.depthMask(true)

      /* Ambient occlusion, at half resolution. */
      gl.disable(gl.DEPTH_TEST)
      if (this.quality.ao) {
        this.aoA.bind()
        const ao = this.pAO.use()
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.scene.depthTex)
        ao.i('uDepth', 0)
        ao.m4('uProj', proj)
        ao.m4('uInvProj', this.invProj)
        ao.v2('uSize', this.aoA.w, this.aoA.h)
        ao.f('uRadius', 0.85)
        this.drawFS()

        const bl = this.pBlur.use()
        this.aoB.bind()
        gl.bindTexture(gl.TEXTURE_2D, this.aoA.textures[0])
        bl.i('uTex', 0)
        bl.v2('uStep', 1 / this.aoA.w, 0)
        this.drawFS()
        this.aoA.bind()
        gl.bindTexture(gl.TEXTURE_2D, this.aoB.textures[0])
        bl.v2('uStep', 0, 1 / this.aoA.h)
        this.drawFS()
      }

      /* Composite. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      const post = this.pPost.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.scene.textures[0])
      post.i('uColor', 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.scene.textures[1])
      post.i('uAmbient', 1)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.quality.ao ? this.aoA.textures[0] : this.whiteTex(gl))
      post.i('uAO', 2)
      post.v2('uTexel', 1 / w, 1 / h)
      post.f('uExposure', this.exposure)
      post.f('uStoreScale', this.storeScale)
      post.f('uAoStrength', this.quality.ao ? this.aoStrength : 0)
      post.i('uSuper', this.quality.super ? 1 : 0)
      this.drawFS()
      gl.activeTexture(gl.TEXTURE0)
      gl.enable(gl.DEPTH_TEST)
    }

    whiteTex (gl) {
      if (!this._white) {
        this._white = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, this._white)
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 1, 1)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]))
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      }
      return this._white
    }
  }

  CH.Renderer = Renderer
  CH.MATERIALS = MATERIALS
  CH.sunState = sunState
})(window)
