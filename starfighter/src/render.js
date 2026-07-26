/* The renderer.

   Five passes, in this order:

     1. background   nebula lobes and a star sphere, painted with depth off
     2. sky bodies   planet, atmosphere rim and sun, also depth off
     3. opaque       every hull in the scene, lit, depth tested, back faces cut
     4. effects      bolts, engine flares, sparks and shockwaves, additive
     5. post         bright pass, separable blur, then a composite that adds
                     the bloom back with chromatic aberration and a vignette

   Everything renders into an off-screen target first so the post chain has
   something to read, and that target can be smaller than the canvas — which is
   how the game keeps 60fps on a phone. */
(function (global) {
  'use strict'

  const G = global.G || (global.G = {})

  const MAX_SPRITES = 3600

  /* ------------------------------------------------------------ shaders -- */

  const MESH_VS = `
    attribute vec3 aPos;
    attribute vec3 aNor;
    attribute vec3 aCol;
    attribute float aEmit;
    uniform mat4 uViewProj;
    uniform mat4 uModel;
    uniform mat3 uNormalMat;
    varying vec3 vNor;
    varying vec3 vCol;
    varying vec3 vWorld;
    varying float vEmit;
    void main () {
      vec4 world = uModel * vec4(aPos, 1.0);
      vWorld = world.xyz;
      vNor = uNormalMat * aNor;
      vCol = aCol;
      vEmit = aEmit;
      gl_Position = uViewProj * world;
    }`

  const MESH_FS = `
    precision mediump float;
    varying vec3 vNor;
    varying vec3 vCol;
    varying vec3 vWorld;
    varying float vEmit;
    uniform vec3 uLightDir;   // unit vector pointing at the star
    uniform vec3 uLightCol;
    uniform vec3 uAmbTop;
    uniform vec3 uAmbBot;
    uniform vec3 uRimCol;
    uniform vec3 uCamPos;
    uniform vec3 uTint;
    uniform float uFlash;
    uniform float uEmit;
    uniform float uAlpha;
    uniform vec3 uFogCol;
    uniform float uFog;
    void main () {
      vec3 n = normalize(vNor);
      vec3 toCam = uCamPos - vWorld;
      float dist = length(toCam);
      vec3 v = toCam / max(dist, 0.0001);
      vec3 base = vCol * uTint;

      float ndl = dot(n, uLightDir);
      // A wrapped term keeps the unlit side readable instead of pure black,
      // which is what bounce light off a nearby hull would do anyway.
      float diff = max(ndl, 0.0) + max((ndl + 0.4) / 1.4, 0.0) * 0.14;
      vec3 amb = mix(uAmbBot, uAmbTop, n.y * 0.5 + 0.5);
      vec3 col = base * (amb + uLightCol * diff);

      vec3 h = normalize(uLightDir + v);
      col += uLightCol * pow(max(dot(n, h), 0.0), 48.0) * 0.32 * step(0.0, ndl);

      // Rim light. Without it every grey hull dissolves into the black.
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      col += uRimCol * rim;

      col = mix(col, base * (1.35 + uEmit), vEmit);
      col = mix(col, vec3(1.0, 0.95, 0.9), uFlash);
      float fog = 1.0 - exp(-uFog * uFog * dist * dist);
      col = mix(col, uFogCol, clamp(fog, 0.0, 1.0));
      gl_FragColor = vec4(col, uAlpha);
    }`

  const FX_VS = `
    attribute vec3 aPos;
    attribute vec2 aUV;
    attribute vec4 aCol;
    uniform mat4 uViewProj;
    varying vec2 vUV;
    varying vec4 vCol;
    void main () {
      vUV = aUV;
      vCol = aCol;
      gl_Position = uViewProj * vec4(aPos, 1.0);
    }`

  const FX_FS = `
    precision mediump float;
    varying vec2 vUV;
    varying vec4 vCol;
    uniform sampler2D uTex;
    void main () {
      vec4 t = texture2D(uTex, vUV);
      gl_FragColor = vec4(vCol.rgb * t.a * vCol.a, t.a * vCol.a);
    }`

  const STAR_VS = `
    attribute vec3 aPos;
    attribute vec4 aCol;   // rgb + point size
    uniform mat4 uViewProj;
    uniform float uScale;
    uniform float uTime;
    varying vec3 vCol;
    void main () {
      // Stars sit on a unit sphere and ride with the camera, so only the
      // rotation part of the view matrix is ever applied to them.
      gl_Position = uViewProj * vec4(aPos, 1.0);
      gl_Position.z = gl_Position.w * 0.999;
      float tw = 0.82 + 0.18 * sin(uTime * 2.1 + aPos.x * 41.0 + aPos.y * 17.0);
      gl_PointSize = aCol.w * uScale * tw;
      vCol = aCol.rgb * tw;
    }`

  const STAR_FS = `
    precision mediump float;
    varying vec3 vCol;
    void main () {
      float d = length(gl_PointCoord - vec2(0.5));
      float a = smoothstep(0.5, 0.08, d);
      gl_FragColor = vec4(vCol * a, a);
    }`

  const BG_VS = `
    attribute vec2 aPos;
    varying vec2 vNdc;
    void main () {
      vNdc = aPos;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`

  /* The nebula is a handful of directional lobes rather than noise: dot the
     view ray against a few fixed directions, raise to a power, tint. It costs
     a couple of dozen instructions instead of a few hundred, and at these
     scales the eye cannot tell the difference. */
  const BG_FS = `
    precision mediump float;
    varying vec2 vNdc;
    uniform vec3 uRight;
    uniform vec3 uUp;
    uniform vec3 uFwd;
    uniform float uTan;
    uniform float uAspect;
    uniform vec3 uLobeDir[4];
    uniform vec3 uLobeCol[4];
    uniform vec2 uLobePow[4];  // x = tightness, y = strength
    uniform vec3 uHaze;
    void main () {
      vec3 ray = normalize(uFwd + uRight * (vNdc.x * uTan * uAspect) + uUp * (vNdc.y * uTan));
      // Warp the ray a little so the lobes get soft filaments instead of
      // looking like four airbrushed blobs.
      vec3 w = ray + 0.06 * vec3(
        sin(ray.y * 7.0 + ray.z * 3.0),
        sin(ray.z * 6.0 + ray.x * 4.0),
        sin(ray.x * 5.0 + ray.y * 6.0));
      w = normalize(w);
      vec3 col = uHaze * (0.5 + 0.5 * w.y);
      for (int i = 0; i < 4; i++) {
        float d = max(dot(w, uLobeDir[i]), 0.0);
        col += uLobeCol[i] * pow(d, uLobePow[i].x) * uLobePow[i].y;
      }
      // A faint galactic band across the sky.
      float band = pow(1.0 - abs(dot(w, vec3(0.32, 0.91, 0.26))), 22.0);
      col += vec3(0.10, 0.12, 0.20) * band;
      gl_FragColor = vec4(col, 1.0);
    }`

  const PLANET_VS = `
    attribute vec3 aPos;
    attribute vec3 aNor;
    uniform mat4 uViewProj;
    uniform mat4 uModel;
    varying vec3 vNor;
    varying vec3 vPos;
    void main () {
      vNor = aNor;
      vPos = aPos;
      gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
      gl_Position.z = gl_Position.w * 0.998;
    }`

  const PLANET_FS = `
    precision mediump float;
    varying vec3 vNor;
    varying vec3 vPos;
    uniform vec3 uLightDir;
    uniform vec3 uColA;
    uniform vec3 uColB;
    uniform vec3 uAtmos;
    uniform vec3 uViewDir;   // world-space direction from camera to centre
    uniform float uBands;
    void main () {
      vec3 n = normalize(vNor);
      // Latitude bands with a couple of harmonics: enough structure to read as
      // a gas giant without a single texel of texture.
      float lat = n.y;
      float b = sin(lat * uBands) * 0.5 + 0.5;
      b = b * 0.6 + 0.4 * (sin(lat * uBands * 2.7 + n.x * 1.5) * 0.5 + 0.5);
      vec3 surface = mix(uColA, uColB, b);
      // Storms.
      float storm = smoothstep(0.86, 1.0, sin(n.x * 9.0 + lat * 5.0) * sin(n.z * 7.0));
      surface = mix(surface, uColB * 1.4, storm * 0.5);

      float ndl = dot(n, uLightDir);
      float light = smoothstep(-0.12, 0.35, ndl);
      vec3 col = surface * (0.03 + light * 1.05);

      // Limb darkening plus an atmospheric rim that only lights where the sun
      // hits it, which is what sells the sphere as a world.
      float rim = pow(1.0 - max(dot(n, -uViewDir), 0.0), 3.0);
      col += uAtmos * rim * smoothstep(-0.35, 0.5, ndl) * 1.6;
      gl_FragColor = vec4(col, 1.0);
    }`

  const POST_VS = `
    attribute vec2 aPos;
    varying vec2 vUV;
    void main () {
      vUV = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`

  const BRIGHT_FS = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uTex;
    uniform vec2 uTexel;
    uniform float uThreshold;
    void main () {
      // Four bilinear taps: a box downsample and the bright-pass in one go.
      vec3 c = texture2D(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb;
      c += texture2D(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
      c += texture2D(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb;
      c *= 0.25;
      float l = max(max(c.r, c.g), c.b);
      float k = smoothstep(uThreshold, uThreshold + 0.28, l);
      gl_FragColor = vec4(c * k, 1.0);
    }`

  const BLUR_FS = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uTex;
    uniform vec2 uDir;
    void main () {
      // Nine-tap gaussian folded into five bilinear fetches.
      vec3 c = texture2D(uTex, vUV).rgb * 0.2270270270;
      c += texture2D(uTex, vUV + uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(uTex, vUV - uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(uTex, vUV + uDir * 3.2307692308).rgb * 0.0702702703;
      c += texture2D(uTex, vUV - uDir * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`

  const COMPOSITE_FS = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uScene;
    uniform sampler2D uBloom;
    uniform float uBloomAmount;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    uniform vec3 uTintCol;
    uniform float uTintAmount;
    uniform float uFlash;
    uniform float uWarp;      // radial streak strength, used for the jump
    void main () {
      vec2 uv = vUV;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Lateral chromatic aberration, strongest at the edges.
      vec2 off = c * uAberration * (0.35 + r2);
      vec3 col;
      col.r = texture2D(uScene, uv + off).r;
      col.g = texture2D(uScene, uv).g;
      col.b = texture2D(uScene, uv - off).b;

      if (uWarp > 0.001) {
        // Smear the scene outward from the centre: cheap hyperspace streaks.
        vec3 sum = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
          float t = float(i) / 6.0;
          sum += texture2D(uScene, uv - c * t * uWarp * 0.6).rgb;
        }
        col = mix(col, sum / 6.0, min(uWarp * 1.4, 0.85));
      }

      col += texture2D(uBloom, uv).rgb * uBloomAmount;
      col = mix(col, uTintCol * (col.r + col.g + col.b) * 0.6 + uTintCol * 0.25, uTintAmount);
      col += uFlash;

      col *= 1.0 - uVignette * r2 * 1.9;

      // Film grain, scaled down in the highlights so it reads as sensor noise.
      float n = fract(sin(dot(uv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain * (1.2 - min(col.r + col.g + col.b, 1.0) * 0.4);

      gl_FragColor = vec4(col, 1.0);
    }`

  /* -------------------------------------------------------------- setup -- */

  G.renderer = (() => {
    let gl = null
    let canvas = null
    let progMesh, progFx, progStar, progBg, progPlanet, progBright, progBlur, progComposite
    let quadBuf, starBuf, starCount
    let fxBuf, fxData, fxCount
    let atlasTex
    let sceneRT, bloomA, bloomB
    let width = 1, height = 1, scale = 1
    let rtW = 1, rtH = 1

    const viewProj = G.m4()
    const proj = G.m4()
    const view = G.m4()
    const viewRot = G.m4()
    const viewProjRot = G.m4()
    const model = G.m4()
    const normalMat = new Float32Array(9)
    const camRight = G.v3(), camUp = G.v3(), camFwd = G.v3()
    const tmpV = G.v3(), tmpV2 = G.v3()
    const frustum = new Float32Array(24)

    const state = {
      light: G.v3(0.45, 0.62, 0.64),
      lightCol: [0.94, 0.88, 0.80],
      ambTop: [0.12, 0.15, 0.23],
      ambBot: [0.035, 0.04, 0.062],
      rimCol: [0.13, 0.19, 0.34],
      fogCol: [0.02, 0.03, 0.05],
      fog: 0,
      bloom: 0.9,
      aberration: 0.0016,
      vignette: 0.42,
      grain: 0.045,
      tintCol: [1, 0.25, 0.2],
      tintAmount: 0,
      flash: 0,
      warp: 0,
      quality: 1 // 1 = full post chain, 0 = straight to the canvas
    }

    let curProg = null
    let curAttribs = -1

    /* Attribute arrays are global state in WebGL 1, so switching programs has
       to switch the enabled set with it — otherwise a two-attribute program
       leaves slots 2 and 3 pointing at whatever buffer ran last. */
    const enableAttribs = n => {
      if (curAttribs === n) return
      const from = curAttribs < 0 ? 0 : curAttribs
      if (n > from) for (let i = from; i < n; i++) gl.enableVertexAttribArray(i)
      else for (let i = n; i < from; i++) gl.disableVertexAttribArray(i)
      curAttribs = n
    }

    const useProg = (p, attribs) => {
      if (curProg !== p) { p.use(); curProg = p }
      enableAttribs(attribs)
      return p
    }

    /* -- vertex layout binding -- */

    const STRIDE = G.VERT_FLOATS * 4
    const bindMeshAttribs = vbo => {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0)
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12)
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE, 24)
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 36)
    }

    /* -- the star sphere -- */

    const buildStars = () => {
      const N = 2600
      const data = new Float32Array(N * 7)
      const tints = [
        [1, 1, 1], [0.72, 0.82, 1], [1, 0.88, 0.72],
        [1, 0.76, 0.66], [0.86, 0.92, 1], [1, 0.97, 0.85]
      ]
      const v = G.v3()
      for (let i = 0; i < N; i++) {
        G.vrandom(v)
        const t = tints[(Math.random() * tints.length) | 0]
        // Weighted so most stars are faint pinpricks and a few really burn.
        const mag = Math.pow(Math.random(), 3.2)
        const b = 0.32 + mag * 0.85
        const o = i * 7
        data[o] = v.x; data[o + 1] = v.y; data[o + 2] = v.z
        data[o + 3] = t[0] * b; data[o + 4] = t[1] * b; data[o + 5] = t[2] * b
        data[o + 6] = 0.9 + mag * 2.6
      }
      starBuf = G.buffer(gl, data)
      starCount = N
    }

    /* -- frustum culling -- */

    const extractFrustum = m => {
      // Six planes straight out of the view-projection matrix.
      const rows = [
        [3, 0, 1], [3, 0, -1], [3, 1, 1], [3, 1, -1], [3, 2, 1], [3, 2, -1]
      ]
      for (let i = 0; i < 6; i++) {
        const [r0, r1, sign] = rows[i]
        const a = m[0 * 4 + r0] + sign * m[0 * 4 + r1]
        const b = m[1 * 4 + r0] + sign * m[1 * 4 + r1]
        const c = m[2 * 4 + r0] + sign * m[2 * 4 + r1]
        const d = m[3 * 4 + r0] + sign * m[3 * 4 + r1]
        const len = Math.hypot(a, b, c) || 1
        frustum[i * 4] = a / len
        frustum[i * 4 + 1] = b / len
        frustum[i * 4 + 2] = c / len
        frustum[i * 4 + 3] = d / len
      }
    }

    const sphereVisible = (pos, radius) => {
      for (let i = 0; i < 6; i++) {
        const d = frustum[i * 4] * pos.x + frustum[i * 4 + 1] * pos.y +
          frustum[i * 4 + 2] * pos.z + frustum[i * 4 + 3]
        if (d < -radius) return false
      }
      return true
    }

    /* -- the effects batch -- */

    const FX_FLOATS = 9 // pos3 uv2 rgba4
    const pushSpriteVerts = (
      x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, sprite, r, g, b, a) => {
      if (fxCount + 6 > MAX_SPRITES * 6) return
      const uv = G.spriteUV(sprite)
      const u0 = uv[0] + 0.008, v0 = uv[1] + 0.008, s = uv[2] - 0.016
      let o = fxCount * FX_FLOATS
      const put = (x, y, z, u, v) => {
        fxData[o] = x; fxData[o + 1] = y; fxData[o + 2] = z
        fxData[o + 3] = u; fxData[o + 4] = v
        fxData[o + 5] = r; fxData[o + 6] = g; fxData[o + 7] = b; fxData[o + 8] = a
        o += FX_FLOATS
      }
      put(x0, y0, z0, u0, v0 + s)
      put(x1, y1, z1, u0 + s, v0 + s)
      put(x2, y2, z2, u0 + s, v0)
      put(x0, y0, z0, u0, v0 + s)
      put(x2, y2, z2, u0 + s, v0)
      put(x3, y3, z3, u0, v0)
      fxCount += 6
    }

    /* --------------------------------------------------------- public -- */

    const R = {
      get gl () { return gl },
      state,

      init (cv) {
        canvas = cv
        gl = G.glSetup(cv)
        if (!gl) return false

        progMesh = G.program(gl, MESH_VS, MESH_FS, ['aPos', 'aNor', 'aCol', 'aEmit'])
        progFx = G.program(gl, FX_VS, FX_FS, ['aPos', 'aUV', 'aCol'])
        progStar = G.program(gl, STAR_VS, STAR_FS, ['aPos', 'aCol'])
        progBg = G.program(gl, BG_VS, BG_FS, ['aPos'])
        progPlanet = G.program(gl, PLANET_VS, PLANET_FS, ['aPos', 'aNor'])
        progBright = G.program(gl, POST_VS, BRIGHT_FS, ['aPos'])
        progBlur = G.program(gl, POST_VS, BLUR_FS, ['aPos'])
        progComposite = G.program(gl, POST_VS, COMPOSITE_FS, ['aPos'])

        // One oversized triangle covers the screen with no seam down the middle.
        quadBuf = G.buffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]))

        fxData = new Float32Array(MAX_SPRITES * 6 * FX_FLOATS)
        fxBuf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, fxBuf)
        gl.bufferData(gl.ARRAY_BUFFER, fxData.byteLength, gl.DYNAMIC_DRAW)

        atlasTex = G.textureFrom(gl, G.makeAtlas(), true)
        buildStars()
        G.buildModels(gl)

        sceneRT = G.target(gl, 2, 2, true)
        bloomA = G.target(gl, 2, 2, false)
        bloomB = G.target(gl, 2, 2, false)

        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
        gl.depthFunc(gl.LEQUAL)
        return true
      },

      /** Size the drawing buffer. `renderScale` trades resolution for speed and
          is nudged at runtime by the frame-time watchdog in main.js. */
      resize (w, h, dpr, renderScale) {
        width = w; height = h
        scale = renderScale
        canvas.width = Math.max(1, Math.round(w * dpr))
        canvas.height = Math.max(1, Math.round(h * dpr))
        rtW = Math.max(2, Math.round(canvas.width * renderScale))
        rtH = Math.max(2, Math.round(canvas.height * renderScale))
        sceneRT.resize(rtW, rtH)
        bloomA.resize(Math.max(2, rtW >> 2), Math.max(2, rtH >> 2))
        bloomB.resize(Math.max(2, rtW >> 2), Math.max(2, rtH >> 2))
      },

      get aspect () { return width / height },

      /** Start a frame. `cam` is {pos, quat, fov, near, far}. */
      begin (cam) {
        G.mperspective(proj, cam.fov, width / height, cam.near, cam.far)
        G.mview(view, cam.pos, cam.quat)
        G.mmul(viewProj, proj, view)
        extractFrustum(viewProj)

        // Rotation-only view, for anything that lives at infinity.
        viewRot.set(view)
        viewRot[12] = viewRot[13] = viewRot[14] = 0
        G.mmul(viewProjRot, proj, viewRot)

        G.qright(camRight, cam.quat)
        G.qup(camUp, cam.quat)
        G.qforward(camFwd, cam.quat)
        this.cam = cam

        gl.bindFramebuffer(gl.FRAMEBUFFER, state.quality > 0 ? sceneRT.fb : null)
        gl.viewport(0, 0, state.quality > 0 ? rtW : canvas.width, state.quality > 0 ? rtH : canvas.height)
        gl.clearColor(0, 0, 0, 1)
        gl.depthMask(true)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.disable(gl.BLEND)
        fxCount = 0
        curProg = null
      },

      /** Nebula and stars. */
      background (sky) {
        gl.disable(gl.DEPTH_TEST)
        gl.depthMask(false)

        const p = useProg(progBg, 1)
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
        gl.uniform3f(p.u('uRight'), camRight.x, camRight.y, camRight.z)
        gl.uniform3f(p.u('uUp'), camUp.x, camUp.y, camUp.z)
        gl.uniform3f(p.u('uFwd'), camFwd.x, camFwd.y, camFwd.z)
        gl.uniform1f(p.u('uTan'), Math.tan(this.cam.fov * 0.5))
        gl.uniform1f(p.u('uAspect'), width / height)
        gl.uniform3fv(p.u('uHaze'), sky.haze)
        gl.uniform3fv(p.u('uLobeDir[0]'), sky.lobeDir)
        gl.uniform3fv(p.u('uLobeCol[0]'), sky.lobeCol)
        gl.uniform2fv(p.u('uLobePow[0]'), sky.lobePow)
        gl.drawArrays(gl.TRIANGLES, 0, 3)

        const s = useProg(progStar, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, starBuf)
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0)
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12)
        gl.uniformMatrix4fv(s.u('uViewProj'), false, viewProjRot)
        gl.uniform1f(s.u('uScale'), Math.max(1, (rtH / 900) * 1.4))
        gl.uniform1f(s.u('uTime'), sky.time)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        gl.drawArrays(gl.POINTS, 0, starCount)
        gl.disable(gl.BLEND)
      },

      /** A planet, drawn at a fixed distance in front of the camera so it
          never clips the scene and never needs depth precision. */
      planet (dir, apparent, colA, colB, atmos, bands) {
        const p = useProg(progPlanet, 2)
        const mesh = G.models.unitSphere
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo)
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0)
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12)

        const D = 800
        G.vscale(tmpV, dir, D)
        G.vadd(tmpV, tmpV, this.cam.pos)
        G.mmodel(model, tmpV, IDENT_Q, D * apparent)
        gl.uniformMatrix4fv(p.u('uViewProj'), false, viewProj)
        gl.uniformMatrix4fv(p.u('uModel'), false, model)
        gl.uniform3f(p.u('uLightDir'), state.light.x, state.light.y, state.light.z)
        gl.uniform3fv(p.u('uColA'), colA)
        gl.uniform3fv(p.u('uColB'), colB)
        gl.uniform3fv(p.u('uAtmos'), atmos)
        gl.uniform3f(p.u('uViewDir'), dir.x, dir.y, dir.z)
        gl.uniform1f(p.u('uBands'), bands)
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
      },

      /** Switch to the lit pass. Everything drawn after this is depth tested. */
      scene () {
        gl.enable(gl.DEPTH_TEST)
        gl.depthMask(true)
        gl.disable(gl.BLEND)
        const p = useProg(progMesh, 4)
        gl.uniformMatrix4fv(p.u('uViewProj'), false, viewProj)
        gl.uniform3f(p.u('uLightDir'), state.light.x, state.light.y, state.light.z)
        gl.uniform3fv(p.u('uLightCol'), state.lightCol)
        gl.uniform3fv(p.u('uAmbTop'), state.ambTop)
        gl.uniform3fv(p.u('uAmbBot'), state.ambBot)
        gl.uniform3fv(p.u('uRimCol'), state.rimCol)
        gl.uniform3fv(p.u('uFogCol'), state.fogCol)
        gl.uniform1f(p.u('uFog'), state.fog)
        gl.uniform3f(p.u('uCamPos'), this.cam.pos.x, this.cam.pos.y, this.cam.pos.z)
      },

      /** Draw one mesh. Returns false if it was culled. */
      mesh (m, pos, quat, sc, opts) {
        if (!sphereVisible(pos, m.radius * sc)) return false
        const p = useProg(progMesh, 4)
        G.mmodel(model, pos, quat || IDENT_Q, sc)
        G.mnormal(normalMat, model, 1 / sc)
        gl.uniformMatrix4fv(p.u('uModel'), false, model)
        gl.uniformMatrix3fv(p.u('uNormalMat'), false, normalMat)
        const o = opts || EMPTY
        gl.uniform3fv(p.u('uTint'), o.tint || WHITE)
        gl.uniform1f(p.u('uFlash'), o.flash || 0)
        gl.uniform1f(p.u('uEmit'), o.emit || 0)
        gl.uniform1f(p.u('uAlpha'), o.alpha === undefined ? 1 : o.alpha)
        bindMeshAttribs(m.vbo)
        gl.drawArrays(gl.TRIANGLES, 0, m.count)
        return true
      },

      /** Meshes that are already positioned in world space (trench chunks). */
      staticMesh (m, pos) {
        return R.mesh(m, pos, IDENT_Q, 1, EMPTY)
      },

      /** Same as mesh(), with a per-axis scale. */
      meshScaled (m, pos, quat, sx, sy, sz, opts) {
        const big = Math.max(sx, sy, sz)
        if (!sphereVisible(pos, m.radius * big)) return false
        const p = useProg(progMesh, 4)
        G.mmodel3(model, pos, quat || IDENT_Q, sx, sy, sz)
        G.mnormal3(normalMat, model, sx, sy, sz)
        gl.uniformMatrix4fv(p.u('uModel'), false, model)
        gl.uniformMatrix3fv(p.u('uNormalMat'), false, normalMat)
        const o = opts || EMPTY
        gl.uniform3fv(p.u('uTint'), o.tint || WHITE)
        gl.uniform1f(p.u('uFlash'), o.flash || 0)
        gl.uniform1f(p.u('uEmit'), o.emit || 0)
        gl.uniform1f(p.u('uAlpha'), o.alpha === undefined ? 1 : o.alpha)
        bindMeshAttribs(m.vbo)
        gl.drawArrays(gl.TRIANGLES, 0, m.count)
        return true
      },

      cullFront (on) { gl.cullFace(on ? gl.FRONT : gl.BACK) },

      /* -- effects -- */

      /** A camera-facing quad. */
      sprite (pos, size, r, g, b, a, spriteId, spin) {
        let rx = camRight.x, ry = camRight.y, rz = camRight.z
        let ux = camUp.x, uy = camUp.y, uz = camUp.z
        if (spin) {
          const c = Math.cos(spin), s = Math.sin(spin)
          const nrx = rx * c + ux * s, nry = ry * c + uy * s, nrz = rz * c + uz * s
          ux = ux * c - rx * s; uy = uy * c - ry * s; uz = uz * c - rz * s
          rx = nrx; ry = nry; rz = nrz
        }
        const h = size * 0.5
        rx *= h; ry *= h; rz *= h
        ux *= h; uy *= h; uz *= h
        pushSpriteVerts(
          pos.x - rx - ux, pos.y - ry - uy, pos.z - rz - uz,
          pos.x + rx - ux, pos.y + ry - uy, pos.z + rz - uz,
          pos.x + rx + ux, pos.y + ry + uy, pos.z + rz + uz,
          pos.x - rx + ux, pos.y - ry + uy, pos.z - rz + uz,
          spriteId, r, g, b, a)
      },

      /** A quad stretched between two points and rotated to face the camera:
          laser bolts, ion trails, the lot. */
      beam (from, to, width, r, g, b, a, spriteId) {
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
        // Perpendicular to both the beam and the view, which keeps the bolt
        // readable from every angle including head-on.
        const vx = (from.x + to.x) * 0.5 - this.cam.pos.x
        const vy = (from.y + to.y) * 0.5 - this.cam.pos.y
        const vz = (from.z + to.z) * 0.5 - this.cam.pos.z
        let px = dy * vz - dz * vy
        let py = dz * vx - dx * vz
        let pz = dx * vy - dy * vx
        const len = Math.hypot(px, py, pz)
        if (len < 1e-6) {
          // Looking straight down the bolt: fall back to a camera-facing dot.
          px = camRight.x; py = camRight.y; pz = camRight.z
        } else {
          px /= len; py /= len; pz /= len
        }
        const h = width * 0.5
        px *= h; py *= h; pz *= h
        pushSpriteVerts(
          from.x - px, from.y - py, from.z - pz,
          from.x + px, from.y + py, from.z + pz,
          to.x + px, to.y + py, to.z + pz,
          to.x - px, to.y - py, to.z - pz,
          spriteId === undefined ? G.SPRITE.DOT : spriteId, r, g, b, a)
      },

      /** Flush the effects batch. Additive, depth tested but not depth written,
          so glows sit correctly behind hulls without ever occluding anything. */
      flushFx () {
        if (fxCount === 0) return
        const p = useProg(progFx, 3)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE)
        gl.depthMask(false)
        gl.enable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)

        gl.bindBuffer(gl.ARRAY_BUFFER, fxBuf)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, fxData.subarray(0, fxCount * FX_FLOATS))
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FX_FLOATS * 4, 0)
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FX_FLOATS * 4, 12)
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FX_FLOATS * 4, 20)
        gl.uniformMatrix4fv(p.u('uViewProj'), false, viewProj)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, atlasTex)
        gl.uniform1i(p.u('uTex'), 0)
        gl.drawArrays(gl.TRIANGLES, 0, fxCount)

        gl.enable(gl.CULL_FACE)
        gl.disable(gl.BLEND)
        gl.depthMask(true)
        fxCount = 0
      },

      /** Project a world point to canvas pixels, for the 2D HUD overlay.
          Returns false when the point is behind the camera. */
      project (world, out) {
        const w = G.mpoint(tmpV2, viewProj, world)
        if (w <= 0.0001) return false
        out.x = (tmpV2.x / w * 0.5 + 0.5) * width
        out.y = (0.5 - tmpV2.y / w * 0.5) * height
        out.z = w
        return true
      },

      /* -- post -- */

      end (time) {
        R.flushFx()
        if (state.quality <= 0) return

        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.BLEND)
        gl.disable(gl.CULL_FACE)
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

        const bw = bloomA.w, bh = bloomA.h

        // Bright pass into the quarter-size target.
        let p = useProg(progBright, 1)
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb)
        gl.viewport(0, 0, bw, bh)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex)
        gl.uniform1i(p.u('uTex'), 0)
        gl.uniform2f(p.u('uTexel'), 1 / rtW, 1 / rtH)
        gl.uniform1f(p.u('uThreshold'), 0.74)
        gl.drawArrays(gl.TRIANGLES, 0, 3)

        // Two blur passes, twice, for a wider and softer falloff.
        p = useProg(progBlur, 1)
        gl.uniform1i(p.u('uTex'), 0)
        const blur = (src, dst, dx, dy) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
          gl.viewport(0, 0, dst.w, dst.h)
          gl.bindTexture(gl.TEXTURE_2D, src.tex)
          gl.uniform2f(p.u('uDir'), dx / bw, dy / bh)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }
        blur(bloomA, bloomB, 1, 0)
        blur(bloomB, bloomA, 0, 1)
        blur(bloomA, bloomB, 2.4, 0)
        blur(bloomB, bloomA, 0, 2.4)

        // Composite to the canvas.
        p = useProg(progComposite, 1)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex)
        gl.uniform1i(p.u('uScene'), 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex)
        gl.uniform1i(p.u('uBloom'), 1)
        gl.uniform1f(p.u('uBloomAmount'), state.bloom)
        gl.uniform1f(p.u('uAberration'), state.aberration)
        gl.uniform1f(p.u('uVignette'), state.vignette)
        gl.uniform1f(p.u('uGrain'), state.grain)
        gl.uniform1f(p.u('uTime'), time % 100)
        gl.uniform3fv(p.u('uTintCol'), state.tintCol)
        gl.uniform1f(p.u('uTintAmount'), state.tintAmount)
        gl.uniform1f(p.u('uFlash'), state.flash)
        gl.uniform1f(p.u('uWarp'), state.warp)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.activeTexture(gl.TEXTURE0)
        gl.enable(gl.CULL_FACE)
      },

      visible: sphereVisible
    }

    const IDENT_Q = G.qid()
    const WHITE = new Float32Array([1, 1, 1])
    const EMPTY = {}

    return R
  })()
})(window)
