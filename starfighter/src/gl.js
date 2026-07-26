/* The thin layer over WebGL: context, shaders, buffers, render targets and the
   handful of procedurally drawn sprites the effects pass needs.

   Shaders are written against GLSL ES 1.00 so the exact same source links on a
   WebGL 2 context and on the WebGL 1 fallback that older phones still hand
   out. Nothing here needs an extension. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  /** Acquire a context. Returns null if the device has no usable WebGL. */
  G.glSetup = canvas => {
    const opts = {
      alpha: false,
      antialias: false, // The post chain resolves edges; MSAA would cost more.
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false
    }
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) ||
      canvas.getContext('experimental-webgl', opts)
    if (!gl) return null
    gl.disable(gl.DITHER)
    return gl
  }

  const compile = (gl, type, src, label) => {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`${label} shader: ${gl.getShaderInfoLog(sh)}`)
    }
    return sh
  }

  /** Compile and link, with lazily cached uniform and attribute locations.

      Attribute slots are bound by name before linking so every mesh can share
      one vertex layout regardless of what the driver would have picked. */
  G.program = (gl, vsSrc, fsSrc, attribs) => {
    const p = gl.createProgram()
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, 'vertex'))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, 'fragment'))
    if (attribs) for (let i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i])
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(p)}`)
    }

    const uniforms = Object.create(null)
    return {
      p,
      use () { gl.useProgram(p); return this },
      /** Uniform location, cached. Returns null for names the linker dropped,
          which gl.uniform* quietly ignores — handy while tuning shaders. */
      u (name) {
        let loc = uniforms[name]
        if (loc === undefined) loc = uniforms[name] = gl.getUniformLocation(p, name)
        return loc
      }
    }
  }

  G.buffer = (gl, data, usage) => {
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW)
    return b
  }

  /** An off-screen colour target. Depth is optional: the scene pass needs it,
      the blur passes do not. */
  G.target = (gl, w, h, depth) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

    // A 16-bit depth buffer is not enough for a scene that runs from a cockpit
    // rail to a capital ship two kilometres out — the hull greebles z-fight
    // visibly. WebGL 2 has 24-bit depth, so use it wherever it exists.
    const depthFormat = gl.DEPTH_COMPONENT24 || gl.DEPTH_COMPONENT16

    let rb = null
    if (depth) {
      rb = gl.createRenderbuffer()
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
      gl.renderbufferStorage(gl.RENDERBUFFER, depthFormat, w, h)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    return {
      fb,
      tex,
      rb,
      w,
      h,
      resize (nw, nh) {
        if (nw === this.w && nh === this.h) return
        this.w = nw; this.h = nh
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        if (rb) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
          gl.renderbufferStorage(gl.RENDERBUFFER, depthFormat, nw, nh)
        }
      }
    }
  }

  G.textureFrom = (gl, source, mip) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    return tex
  }

  /* ---------------------------------------------------------- the atlas -- */

  /* Four sprites in a 2x2 grid, drawn with canvas gradients at load time. The
     effects pass reads them all through one bind, so bolts, engine flares,
     smoke and shockwaves never cost a texture switch between them. */
  G.SPRITE = {
    DOT: 0,     // soft round falloff — glows, sparks, flares
    SMOKE: 1,   // mottled puff — explosion smoke, engine wash
    RING: 2,    // hollow ring — shockwaves, shield impacts
    FLARE: 3    // four-point star — sun and bright hits
  }

  /** UV rect for a sprite id, as [u0, v0, size]. Cells are quarter-texture. */
  G.spriteUV = id => [(id & 1) * 0.5, (id >> 1) * 0.5, 0.5]

  G.makeAtlas = () => {
    const S = 256 // one cell
    const c = document.createElement('canvas')
    c.width = c.height = S * 2
    const x = c.getContext('2d')
    x.clearRect(0, 0, S * 2, S * 2)

    const cell = (id, draw) => {
      x.save()
      x.translate((id & 1) * S, (id >> 1) * S)
      // Keep a 1px transparent border so LINEAR sampling never bleeds cells.
      x.beginPath()
      x.rect(1, 1, S - 2, S - 2)
      x.clip()
      draw(S / 2)
      x.restore()
    }

    cell(G.SPRITE.DOT, h => {
      const g = x.createRadialGradient(h, h, 0, h, h, h)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.18, 'rgba(255,255,255,0.85)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.22)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(0, 0, h * 2, h * 2)
    })

    cell(G.SPRITE.SMOKE, h => {
      // A soft disc, then blobs punched through it for a bit of structure.
      const g = x.createRadialGradient(h, h, 0, h, h, h)
      g.addColorStop(0, 'rgba(255,255,255,0.9)')
      g.addColorStop(0.6, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(0, 0, h * 2, h * 2)
      x.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * G.TAU
        const r = Math.random() * h * 0.8
        const br = h * (0.06 + Math.random() * 0.2)
        const bg = x.createRadialGradient(
          h + Math.cos(a) * r, h + Math.sin(a) * r, 0,
          h + Math.cos(a) * r, h + Math.sin(a) * r, br)
        bg.addColorStop(0, 'rgba(0,0,0,0.5)')
        bg.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = bg
        x.fillRect(0, 0, h * 2, h * 2)
      }
      x.globalCompositeOperation = 'source-over'
    })

    cell(G.SPRITE.RING, h => {
      const g = x.createRadialGradient(h, h, 0, h, h, h)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.62, 'rgba(255,255,255,0)')
      g.addColorStop(0.82, 'rgba(255,255,255,0.95)')
      g.addColorStop(0.93, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(0, 0, h * 2, h * 2)
    })

    cell(G.SPRITE.FLARE, h => {
      const g = x.createRadialGradient(h, h, 0, h, h, h * 0.42)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.4)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(0, 0, h * 2, h * 2)
      // Four diffraction spikes.
      x.translate(h, h)
      for (let i = 0; i < 4; i++) {
        x.save()
        x.rotate(i * Math.PI / 2)
        const sg = x.createLinearGradient(0, 0, h, 0)
        sg.addColorStop(0, 'rgba(255,255,255,0.75)')
        sg.addColorStop(1, 'rgba(255,255,255,0)')
        x.fillStyle = sg
        x.beginPath()
        x.moveTo(0, -h * 0.035)
        x.lineTo(h, 0)
        x.lineTo(0, h * 0.035)
        x.closePath()
        x.fill()
        x.restore()
      }
    })

    return c
  }
})(window)
