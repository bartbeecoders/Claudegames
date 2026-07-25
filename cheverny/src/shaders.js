/* GLSL. Every surface in the scene is textured procedurally — the ashlar
   coursing of the tuffeau, the slate of the roofs, the gravel of the
   courtyard and the leaves of the cedars are all noise, evaluated per
   fragment, so the project ships without a single image file. */
(function (global) {
  'use strict'

  const CH = global.CH

  /* --- shared chunks ------------------------------------------------------ */

  const NOISE = `
float hash13 (vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float hash12 (vec2 p) { return hash13(vec3(p, 1.7)); }

float noise3 (vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm (vec3 p, int octaves) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    s += a * noise3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
`

  const SKY = `
uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uTime;
uniform float uCloudiness;

vec3 skyDome (vec3 d) {
  float up = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.62));
  float mu = max(dot(d, uSunDir), 0.0);
  // Forward scattering: a broad halo plus a tight one around the sun.
  col += uSunTint * (pow(mu, 5.0) * 0.10 + pow(mu, 60.0) * 0.55);
  // Haze thickens towards, and just below, the horizon.
  col = mix(col, uHorizon * 1.06 + uSunTint * 0.04, smoothstep(0.14, -0.06, d.y));
  return col;
}

/* Two cloud decks projected onto flat planes: soft cumulus low down and a
   thin sheet of cirrus above them. */
vec3 clouds (vec3 d, vec3 col) {
  if (d.y < 0.008) return col;
  float drift = uTime * 0.004;

  vec2 pc = d.xz / d.y * 0.0009 + vec2(drift, drift * 0.35);
  float f = fbm(vec3(pc * 3.0, 11.0), 5);
  float cover = smoothstep(0.60 - uCloudiness * 0.34, 0.86 - uCloudiness * 0.28, f);
  float shade = smoothstep(0.42, 0.95, fbm(vec3(pc * 6.5, 4.0), 4));
  cover *= smoothstep(0.012, 0.16, d.y);

  vec3 lit = mix(vec3(0.72, 0.74, 0.80), vec3(1.10, 1.08, 1.04), shade);
  lit *= 0.55 + 0.75 * max(dot(uSunDir, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0);
  lit += uSunTint * pow(max(dot(d, uSunDir), 0.0), 8.0) * 0.35;
  col = mix(col, lit, cover * 0.92);

  vec2 pf = d.xz / d.y * 0.00042 + vec2(drift * 2.1, -drift);
  float cir = fbm(vec3(pf * vec2(2.0, 7.0), 3.0), 4);
  cir = smoothstep(0.52, 0.80, cir) * smoothstep(0.05, 0.35, d.y) * (1.0 - cover);
  col = mix(col, vec3(1.02, 1.01, 1.0), cir * 0.34 * (0.4 + 0.6 * uCloudiness));
  return col;
}

vec3 skyFull (vec3 d) {
  vec3 col = clouds(d, skyDome(d));
  float mu = dot(d, uSunDir);
  col += uSunTint * smoothstep(0.99965, 0.99990, mu) * 26.0;
  return col;
}
`

  const TONEMAP = `
vec3 aces (vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`

  /* --- main pass ---------------------------------------------------------- */

  const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
out vec2 vUv;
void main () {
  vPos = aPos;
  vNormal = aNormal;
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

  const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vPos;
in vec3 vNormal;
in vec2 vUv;

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAmbient;

uniform vec3 uCam;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundBounce;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uStoreScale;

uniform mat4 uShadowMat;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;

uniform vec3 uBaseColor;
uniform vec3 uAltColor;
uniform float uRough;
uniform float uSpecular;
uniform int uPattern;
uniform float uTexScale;
uniform float uBump;

${NOISE}
${SKY}

/* Bump mapping from an arbitrary procedural height, without a UV
   parameterisation (after Mikkelsen). */
vec3 perturb (vec3 N, float h, vec3 P) {
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - grad);
}

/* Horizontal coordinate along a wall, whichever way it faces. */
float alongWall (vec3 p, vec3 n) {
  return abs(n.x) > abs(n.z) ? p.z : p.x;
}

float ashlarHeight (vec3 p, vec3 n, float course, float block, out float blockId) {
  float h = alongWall(p, n);
  float cy = p.y / course;
  float row = floor(cy);
  float fy = fract(cy);
  float bx = (h + fract(row * 0.5) * block) / block;
  blockId = hash12(vec2(floor(bx), row));
  float fx = fract(bx);
  float j = min(min(fy, 1.0 - fy) * course, min(fx, 1.0 - fx) * block);
  return smoothstep(0.0, 0.022, j);
}

void main () {
  vec3 N = normalize(vNormal);
  vec3 P = vPos;
  vec3 V = normalize(uCam - P);
  float dist = length(uCam - P);

  vec3 albedo = uBaseColor;
  float rough = uRough;
  float spec = uSpecular;
  float bumpH = 0.0;
  float ao = 1.0;

  /* How many metres of world one pixel covers. Fine detail is faded out as
     that grows, otherwise the gravel and the roof slates boil at a distance
     — there is no mip chain to do it for us. */
  float fw = max(length(dFdx(P)), length(dFdy(P)));
  float fine = 1.0 - smoothstep(0.010, 0.16, fw);
  float mid = 1.0 - smoothstep(0.05, 0.40, fw);

  if (uPattern == 1) {                                  // tuffeau ashlar
    float id;
    float joint = mix(1.0, ashlarHeight(P, N, 0.44, 1.05, id), mid);
    bumpH = joint * 0.012 + mix(0.5, fbm(P * 9.0, 3), fine) * 0.004;
    albedo *= 0.93 + 0.14 * id;
    albedo *= mix(0.72, 1.0, joint);
    // Vertical weathering streaks and a grimy plinth.
    float streak = fbm(vec3(P.x * 2.6, P.y * 0.14, P.z * 2.6), 4);
    albedo *= mix(1.0, 0.80, smoothstep(0.52, 0.86, streak) * (1.0 - abs(N.y)) * 0.85);
    albedo *= mix(0.88, 1.0, smoothstep(0.6, 3.4, P.y));
    albedo *= 0.94 + 0.10 * fbm(P * 2.1, 3);
    rough *= 0.94 + 0.12 * id;
  } else if (uPattern == 2) {                           // slate roofing
    float along = alongWall(P, N);
    float row = P.y / 0.20 + along * 0.02;
    float fy = mix(0.5, fract(row), mid);
    float col = mix(0.5, fract(along / 0.26 + floor(row) * 0.5), mid);
    bumpH = (smoothstep(0.0, 0.13, fy) * 0.6 + smoothstep(0.0, 0.06, col) * 0.4) * 0.010;
    float id = mix(0.5, hash12(vec2(floor(along / 0.26), floor(row))), mid);
    albedo = mix(uBaseColor, uAltColor, id * 0.85);
    albedo *= 0.86 + 0.22 * smoothstep(0.0, 0.35, fy);
    albedo *= 0.95 + 0.12 * mix(0.5, fbm(P * 3.3, 3), fine);
    rough *= 0.9 + 0.2 * id;
  } else if (uPattern == 3) {                           // gravel
    float n = mix(0.5, fbm(P * 26.0, 3), fine);
    float n2 = mix(0.5, fbm(P * 3.2, 4), mid);
    bumpH = n * 0.010;
    albedo = mix(uBaseColor, uAltColor, smoothstep(0.35, 0.75, n));
    albedo *= 0.88 + 0.24 * n2;
  } else if (uPattern == 4) {                           // mown lawn
    float blade = mix(0.5, fbm(P * 21.0, 3), fine);
    float mottle = fbm(P * 0.55, 4);
    float stripe = sin(P.x * 0.30) * 0.5 + 0.5;
    bumpH = blade * 0.006;
    albedo = mix(uBaseColor, uAltColor, smoothstep(0.30, 0.78, mottle));
    albedo *= 0.90 + 0.20 * blade;
    albedo *= 0.94 + 0.11 * stripe;
  } else if (uPattern == 5) {                           // glazing bars + glass
    vec2 g = vUv / vec2(0.30, 0.36);
    vec2 f = abs(fract(g) - 0.5);
    float bar = mix(0.35, smoothstep(0.40, 0.47, max(f.x, f.y)), mid);
    float pane = mix(0.5, hash12(floor(g)), mid);
    albedo = mix(uBaseColor * (0.72 + 0.55 * pane), uAltColor, bar);
    rough = mix(0.06, 0.55, bar);
    spec = mix(1.0, 0.25, bar);
    bumpH = bar * 0.004;
  } else if (uPattern == 6) {                           // foliage
    float n = fbm(P * 1.7, 4);
    float leaf = fbm(P * 9.0, 3);
    if (leaf + n * 0.5 < 0.52) discard;                 // lacy canopy edges
    albedo = mix(uBaseColor, uAltColor, smoothstep(0.35, 0.72, n));
    albedo *= 0.78 + 0.32 * leaf;
    bumpH = leaf * 0.05;
    ao = 0.55 + 0.45 * smoothstep(0.3, 0.7, leaf);
  } else if (uPattern == 7) {                           // louvred shutters
    float s = mix(0.5, fract(vUv.y / 0.075), mid);
    bumpH = s * 0.004;
    albedo *= 0.80 + 0.30 * smoothstep(0.1, 0.9, s);
    float frame = smoothstep(0.0, 0.06, min(abs(vUv.x), 1.0));
    albedo *= 0.96 + 0.06 * frame;
  } else if (uPattern == 8) {                           // lead / slate dome
    // Seams run down the dome from its lantern; uTexScale is how far the
    // pavilions stand either side of the centre line.
    float band = fract(P.y / 0.42);
    float seam = fract((atan(P.z, abs(P.x) - uTexScale) + 3.14159) * 2.6);
    bumpH = (smoothstep(0.0, 0.09, band) * 0.5 + smoothstep(0.0, 0.05, seam) * 0.5) * 0.012;
    albedo *= 0.88 + 0.20 * hash12(vec2(floor(P.y / 0.42), floor(seam * 4.0)));
    albedo *= 0.93 + 0.14 * fbm(P * 2.6, 3);
  } else if (uPattern == 9) {                           // rendered panel
    albedo *= 0.94 + 0.11 * fbm(P * 3.4, 4);
    float streak = fbm(vec3(P.x * 2.2, P.y * 0.11, P.z * 2.2), 4);
    albedo *= mix(1.0, 0.86, smoothstep(0.55, 0.9, streak) * (1.0 - abs(N.y)));
    bumpH = fbm(P * 14.0, 2) * 0.003;
  } else if (uPattern == 10) {                          // sawn timber
    float grain = fbm(vec3(vUv.x * 3.0, vUv.y * 40.0, 2.0), 3);
    albedo = mix(uBaseColor, uAltColor, grain);
    bumpH = grain * 0.003;
  } else if (uPattern == 11) {                          // massed blossom
    float n = fbm(P * 7.0, 3);
    if (n < 0.42) discard;
    albedo = mix(uBaseColor, uAltColor, smoothstep(0.45, 0.8, n));
    bumpH = n * 0.03;
  } else {
    albedo *= 0.97 + 0.06 * fbm(P * 6.0, 2);
  }

  if (uBump > 0.0 && bumpH != 0.0) N = perturb(N, bumpH * uBump * fine, P);

  /* --- lighting --------------------------------------------------------- */

  float NoL = dot(N, uSunDir);
  float shade = 0.0;
  if (NoL > 0.0) {
    vec3 off = P + normalize(vNormal) * (0.05 + 0.30 * (1.0 - NoL));
    vec4 sc = uShadowMat * vec4(off, 1.0);
    vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
    if (c.x > 0.001 && c.x < 0.999 && c.y > 0.001 && c.y < 0.999 && c.z < 1.0) {
      float s = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          s += texture(uShadow, vec3(c.xy + vec2(float(x), float(y)) * uShadowTexel, c.z - 0.0012));
        }
      }
      shade = s / 9.0;
    } else {
      shade = 1.0;
    }
  }
  NoL = max(NoL, 0.0);

  vec3 H = normalize(uSunDir + V);
  float NoH = max(dot(N, H), 0.0);
  float NoV = max(dot(N, V), 0.001);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float dTerm = a2 / (3.14159265 * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  float k = a * 0.5;
  float vis = 1.0 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k) + 0.001);
  float f0 = 0.035 * spec;
  float fres = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);

  vec3 direct = uSunColor * NoL * shade * (albedo * 0.3183 + vec3(dTerm * vis * 0.25 * fres));

  // Sky light, plus a little bounce from the gravel and grass below.
  vec3 sky = mix(uGroundBounce, uSkyAmbient, N.y * 0.5 + 0.5);
  vec3 ambient = sky * albedo * ao;
  vec3 refl = reflect(-V, N);
  ambient += skyDome(refl) * fres * (1.0 - rough * 0.85) * ao;

  vec3 color = direct + ambient;

  float fog = 1.0 - exp(-dist * uFogDensity);
  fog *= fog;
  vec3 fogged = mix(color, uFogColor, fog);

  oColor = vec4(fogged * uStoreScale, 1.0);
  oAmbient = vec4(ambient * (1.0 - fog) * uStoreScale, 1.0);
}
`

  /* --- shadow pass -------------------------------------------------------- */

  const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
out vec3 vPos;
void main () {
  vPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

  const DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vPos;
uniform int uCutout;
${NOISE}
void main () {
  // Foliage is cut out the same way it is in the main pass, so trees throw
  // dappled shadows instead of solid blobs.
  if (uCutout == 1) {
    float n = fbm(vPos * 1.7, 4);
    float fine = fbm(vPos * 9.0, 3);
    if (fine + n * 0.5 < 0.52) discard;
  }
}
`

  /* --- sky ---------------------------------------------------------------- */

  const FS_TRI_VS = `#version 300 es
out vec2 vUv;
void main () {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0);
}
`

  const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAmbient;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform float uStoreScale;
${NOISE}
${SKY}
void main () {
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCam);
  oColor = vec4(skyFull(dir) * uStoreScale, 1.0);
  oAmbient = vec4(0.0);
}
`

  /* --- ambient occlusion -------------------------------------------------- */

  const SSAO_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uSize;
uniform float uRadius;
${NOISE}

vec3 viewPos (vec2 uv) {
  float d = texture(uDepth, uv).r * 2.0 - 1.0;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d, 1.0);
  return p.xyz / p.w;
}

void main () {
  vec3 P = viewPos(vUv);
  if (-P.z > 400.0) { oColor = vec4(1.0); return; }
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (dot(N, -normalize(P)) < 0.0) N = -N;

  float ang = hash12(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  const int SAMPLES = 12;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = ang + t * 6.2831853 * 3.0;
    float r = uRadius * sqrt(t);
    vec3 dirv = vec3(cos(a), sin(a), 0.0);
    vec3 s = P + (dirv + N * 0.9) * r;
    vec4 clip = uProj * vec4(s, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sceneZ = viewPos(suv).z;
    float diff = sceneZ - s.z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sceneZ), 0.001));
    occ += (diff > 0.02 ? 1.0 : 0.0) * range;
  }
  oColor = vec4(clamp(1.0 - occ / float(SAMPLES) * 1.15, 0.0, 1.0));
}
`

  const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main () {
  float s = 0.0;
  for (int i = -2; i <= 2; i++) s += texture(uTex, vUv + uStep * float(i)).r;
  oColor = vec4(s / 5.0);
}
`

  /* --- composite ---------------------------------------------------------- */

  const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uColor;
uniform sampler2D uAmbient;
uniform sampler2D uAO;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uStoreScale;
uniform float uAoStrength;
uniform int uSuper;
${TONEMAP}

vec3 fetch (sampler2D t) {
  vec3 c = texture(t, vUv).rgb;
  if (uSuper == 1) {
    c += texture(t, vUv + vec2(uTexel.x, 0.0)).rgb;
    c += texture(t, vUv + vec2(-uTexel.x, 0.0)).rgb;
    c += texture(t, vUv + vec2(0.0, uTexel.y)).rgb;
    c += texture(t, vUv + vec2(0.0, -uTexel.y)).rgb;
    c /= 5.0;
  }
  return c;
}

void main () {
  vec3 color = fetch(uColor) / uStoreScale;
  vec3 amb = fetch(uAmbient) / uStoreScale;
  float ao = texture(uAO, vUv).r;
  color -= amb * (1.0 - ao) * uAoStrength;
  color = max(color, vec3(0.0));

  color = aces(color * uExposure);

  // A whisper of vignette and film grain keeps the flat sky from banding.
  vec2 d = vUv - 0.5;
  color *= 1.0 - dot(d, d) * 0.30;
  color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.004;

  oColor = vec4(pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`

  CH.shaders = {
    MAIN_VS, MAIN_FS, DEPTH_VS, DEPTH_FS, FS_TRI_VS, SKY_FS, SSAO_FS, BLUR_FS, COMPOSITE_FS
  }
})(window)
