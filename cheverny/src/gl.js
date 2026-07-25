/* A thin WebGL2 layer: programs with cached uniforms, static meshes, and
   render targets. Nothing here knows anything about châteaux. */
(function (global) {
  'use strict'

  const CH = global.CH

  class Program {
    constructor (gl, vsSrc, fsSrc, name) {
      this.gl = gl
      this.name = name
      const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + ':vs')
      const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + ':fs')
      const p = gl.createProgram()
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`link failed (${name}): ${gl.getProgramInfoLog(p)}`)
      }
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      this.prog = p
      this.loc = new Map()
    }

    use () {
      this.gl.useProgram(this.prog)
      return this
    }

    at (name) {
      if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name))
      return this.loc.get(name)
    }

    m4 (name, v) { this.gl.uniformMatrix4fv(this.at(name), false, v); return this }
    f (name, v) { this.gl.uniform1f(this.at(name), v); return this }
    i (name, v) { this.gl.uniform1i(this.at(name), v); return this }
    v2 (name, x, y) { this.gl.uniform2f(this.at(name), x, y); return this }
    v3 (name, x, y, z) {
      if (Array.isArray(x)) this.gl.uniform3f(this.at(name), x[0], x[1], x[2])
      else this.gl.uniform3f(this.at(name), x, y, z)
      return this
    }
    v4 (name, x, y, z, w) { this.gl.uniform4f(this.at(name), x, y, z, w); return this }
  }

  function compile (gl, type, src, label) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s)
      const line = /ERROR: \d+:(\d+)/.exec(log)
      let ctx = ''
      if (line) {
        const lines = src.split('\n')
        const n = Number(line[1])
        ctx = '\n' + lines.slice(Math.max(0, n - 4), n + 2)
          .map((t, i) => `${Math.max(1, n - 3) + i}| ${t}`).join('\n')
      }
      throw new Error(`compile failed (${label}): ${log}${ctx}`)
    }
    return s
  }

  /** A static, indexed mesh: interleaved position / normal / uv. */
  class Mesh {
    constructor (gl, group) {
      this.gl = gl
      this.material = group.material
      const n = group.pos.length / 3
      const data = new Float32Array(n * 8)
      for (let i = 0; i < n; i++) {
        data[i * 8] = group.pos[i * 3]
        data[i * 8 + 1] = group.pos[i * 3 + 1]
        data[i * 8 + 2] = group.pos[i * 3 + 2]
        data[i * 8 + 3] = group.nrm[i * 3]
        data[i * 8 + 4] = group.nrm[i * 3 + 1]
        data[i * 8 + 5] = group.nrm[i * 3 + 2]
        data[i * 8 + 6] = group.uv[i * 2]
        data[i * 8 + 7] = group.uv[i * 2 + 1]
      }
      const idx = n > 65535 ? new Uint32Array(group.idx) : new Uint16Array(group.idx)
      this.type = n > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      this.count = group.idx.length
      this.tris = this.count / 3

      this.vao = gl.createVertexArray()
      gl.bindVertexArray(this.vao)
      const vb = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, vb)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      const stride = 32
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12)
      gl.enableVertexAttribArray(2)
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24)
      const ib = gl.createBuffer()
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
      gl.bindVertexArray(null)
    }

    draw () {
      const gl = this.gl
      gl.bindVertexArray(this.vao)
      gl.drawElements(gl.TRIANGLES, this.count, this.type, 0)
    }
  }

  /** Off-screen target: one or more colour attachments plus a depth texture. */
  class Target {
    constructor (gl, w, h, opts = {}) {
      this.gl = gl
      this.w = w
      this.h = h
      this.formats = opts.formats || [gl.RGBA8]
      this.depth = opts.depth !== false
      this.filter = opts.filter || gl.LINEAR
      this.fbo = gl.createFramebuffer()
      this.textures = []
      this.depthTex = null
      this.resize(w, h)
    }

    resize (w, h) {
      const gl = this.gl
      w = Math.max(1, w | 0)
      h = Math.max(1, h | 0)
      if (w === this.w && h === this.h && this.textures.length) return
      this.w = w
      this.h = h
      for (const t of this.textures) gl.deleteTexture(t)
      if (this.depthTex) gl.deleteTexture(this.depthTex)
      this.textures = []

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      const bufs = []
      this.formats.forEach((fmt, i) => {
        const t = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)
        bufs.push(gl.COLOR_ATTACHMENT0 + i)
        this.textures.push(t)
      })
      if (bufs.length > 1) gl.drawBuffers(bufs)

      if (this.depth) {
        const d = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, d)
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, d, 0)
        this.depthTex = d
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    bind () {
      const gl = this.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.viewport(0, 0, this.w, this.h)
    }
  }

  /** Depth-only target used as a shadow map, with hardware compare filtering
      so a single texture() call gives a bilinear-filtered occlusion test. */
  class ShadowMap {
    constructor (gl, size) {
      this.gl = gl
      this.size = size
      this.fbo = gl.createFramebuffer()
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0)
      gl.drawBuffers([gl.NONE])
      gl.readBuffer(gl.NONE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.tex = t
    }

    bind () {
      const gl = this.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.viewport(0, 0, this.size, this.size)
    }
  }

  /** Fullscreen triangle, drawn with gl_VertexID — no buffers needed. */
  function fullscreen (gl) {
    const vao = gl.createVertexArray()
    return () => {
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  CH.gl = { Program, Mesh, Target, ShadowMap, fullscreen }
})(window)
