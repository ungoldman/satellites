// The Earth, ray-cast per screen pixel in WebGL2. Land, sea floor, contours,
// grid, and the terminator are all worked out in the fragment shader from a
// height texture, so lines stay one device pixel wide at any zoom.

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`

export const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr, uR, uD, uSeenCos, uCoast;
uniform mat3 uInv;
uniform vec3 uLight, uInk, uBg, uSeenU, uSeenInk;
uniform vec3 uOceanShallow, uOceanDeep, uLandLow, uLandHigh, uNight;
uniform float uNightMix, uMonoDay, uMonoNight;
uniform sampler2D uHeight, uMask;
// metres between fine contours, closer as the view zooms in
uniform float uStep;
uniform bool uHasHeight;
uniform int uLook;
out vec4 o;
const float PI = 3.14159265;

// distance in device px to the nearest whole value of f
float px(float f) { return abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-6); }
float line(float f, float w) { return clamp(0.5 * w * uDpr + 0.5 - px(f), 0.0, 1.0); }
float level(float f, float at, float w) {
  return clamp(0.5 * w * uDpr + 0.5 - abs(f - at) / max(fwidth(f), 1e-6), 0.0, 1.0);
}

// cubic B-spline from four bilinear taps, so contours run smooth between
// texels. The gradients pick the mip level, see gradOf.
float smoothHeight(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p);
  p -= f;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (p - 0.5 + w1 / g0) / size;
  vec2 h1 = (p + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureGrad(tex, h0, dx, dy).r + g1.x * textureGrad(tex, vec2(h1.x, h0.y), dx, dy).r)
    + g1.y * (g0.x * textureGrad(tex, vec2(h0.x, h1.y), dx, dy).r + g1.x * textureGrad(tex, h1, dx, dy).r);
}

// A texture coordinate's change across one pixel. Longitude wraps at the date
// line, where u jumps a whole turn, which would otherwise read as the whole
// texture in one pixel and sample the coarsest mip.
mat2 gradOf(vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= round(dx.x);
  dy.x -= round(dy.x);
  return mat2(dx, dy);
}

// Sky illuminance in lux with the Sun at altitude a degrees, after USNO
// Circular 171 (Janiczek and DeYoung 1987). Refraction lifts the Sun near the
// horizon, and starlight and airglow leave 0.0005 lux once it has set.
float lux(float a) {
  if (a > -5.0 / 6.0) a += 1.0 / tan(radians(a + 8.6 / (a + 4.42))) / 60.0;
  float u = sin(radians(a));
  float x = 753.66156;
  float c = cos(asin(x * cos(radians(a)) / (x + 1.0)));
  float m = x * (c - u) + c;
  float sky = exp(-0.21 * m) * u + 0.0289 * exp(-0.042 * m) * (1.0 + (a + 90.0) * u / 57.29577951);
  return 133775.0 * max(sky, 0.0) + 0.0005;
}

// how light the ground looks, 0 at full night to 1 under an overhead Sun, on a
// log scale of illuminance since the eye adapts across it
float daylight(float a) {
  return clamp((log(lux(a)) + 7.6009) / (11.7263 + 7.6009), 0.0, 1.0);
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr - 0.5 * uRes;
  float limb = uR * uD / sqrt(uD * uD - 1.0);
  float cover = clamp(limb - length(s) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) { o = vec4(0.0); return; }
  float dx = s.x / uR / uD;
  float dy = s.y / uR / uD;
  float a = dx * dx + dy * dy + 1.0;
  float b = -2.0 * uD;
  float c = uD * uD - 1.0;
  float t = (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  vec3 p = normalize(vec3(dx * t, dy * t, t - uD));
  vec3 e = uInv * p;
  float lat = asin(clamp(e.z, -1.0, 1.0));
  float lon = atan(e.y, e.x);
  float u = lon / (2.0 * PI) + 0.5;

  vec2 muv = vec2(u, 0.5 - lat / PI);
  mat2 mg = gradOf(muv);
  float m = textureGrad(uMask, muv, mg[0], mg[1]).r;
  float h = mix(-3000.0, 300.0, m);
  float v = 0.5 - log(tan(0.25 * PI + 0.5 * clamp(lat, -1.484, 1.484))) / (2.0 * PI);
  mat2 hg = gradOf(vec2(u, v));
  // sampled every pixel, since a branch would leave the lookups without
  // derivatives
  float base = smoothHeight(uHeight, vec2(u, v), hg[0], hg[1]);
  if (uHasHeight && abs(lat) < 1.484) h = base;

  // the Sun's altitude, and high ground sees past the sea-level horizon
  float sun = degrees(asin(clamp(dot(p, uLight), -1.0, 1.0)));
  float dip = degrees(acos(1.0 / (1.0 + max(h, 0.0) / 6371000.0)));
  float day = daylight(sun + dip);
  float face = -p.z;
  float latd = degrees(lat);
  float lond = degrees(lon);
  // a twin turned half round, so one of the two is smooth across each seam
  float lon2 = mod(lond + 360.0, 360.0) - 180.0;
  float pole = smoothstep(88.0, 80.0, abs(latd));
  #define LON(step, w) (min(line(lond / step, w), line(lon2 / step, w)) * pole)
  #define GRID(step, w) max(line(latd / step, w), LON(step, w))
  bool seen = dot(p, uSeenU) > uSeenCos;
  bool picking = uSeenCos < 1.5;
  // the coast as the zero height line, measured in px from the height's own
  // slope so a steep shore stays one smooth line. The floor on the slope, in
  // metres per px, keeps a flat shore from filling with line.
  float coast = clamp(0.5 * uDpr + 0.5 - abs(h) / max(fwidth(h), 0.5), 0.0, 1.0) * uCoast;

  // every line worked out up front, since derivatives need uniform flow
  float landFine = line(h / uStep, 0.45);
  float landMid = line(h / (2.0 * uStep), 0.5);
  float landMajor = line(h / (4.0 * uStep), 0.7);
  float seaFine = line(h / (2.0 * uStep), 0.4);
  float seaMajor = line(h / (8.0 * uStep), 0.6);
  float shelf = level(h, -200.0, 0.6);
  float grid5 = GRID(5.0, 0.45);
  float grid10 = GRID(10.0, 0.55);
  float grid30 = GRID(30.0, 0.7);
  float equator = level(latd, 0.0, 0.9);
  float dots = line(latd, 1.4) * LON(1.0, 1.4);
  // sunset at sea level, the Sun's upper limb on the horizon, then the ends
  // of civil, nautical, and astronomical twilight
  float terminator = level(sun, -0.833, 1.1);
  float twilight = max(level(sun, -6.0, 0.8), max(level(sun, -12.0, 0.8), level(sun, -18.0, 0.8)));
  float hatch = line((gl_FragCoord.x + gl_FragCoord.y) / (7.0 * uDpr), 0.8);
  // how much of the pixel is land, from the same distance to the coast
  float land = clamp(0.5 + h / max(fwidth(h), 0.5), 0.0, 1.0);
  float ink = 0.0;
  vec3 col;
  if (uLook == 0) {
    // colour: banded depth and height, fine contours over them
    float deep = floor(clamp(-h, 0.0, 5999.0) / 1000.0) / 5.0;
    float high = floor(clamp(h, 0.0, 3999.0) / 800.0) / 4.0;
    col = mix(mix(uOceanShallow, uOceanDeep, deep), mix(uLandLow, uLandHigh, high), land);
    col = mix(mix(col, uNight, uNightMix), col, day);
    float k = mix(0.45, 1.0, day);
    float contour = mix(
      max(shelf * 0.22, max(seaFine * 0.05, seaMajor * 0.12)),
      max(landMid * 0.12, landMajor * 0.22),
      land
    );
    ink = max(contour * k, coast * 0.85 * k);
    ink = max(ink, grid10 * 0.07);
    ink = max(ink, grid30 * 0.15);
    ink = max(ink, equator * 0.28);
    ink = max(ink, terminator * 0.12);
    ink = max(ink, twilight * 0.06);
    col = mix(col, uInk, ink);
    if (seen) col = mix(col, uSeenInk, 0.12);
    col = mix(uBg, col, 0.74 + 0.26 * face);
  } else {
    // mono: one ink, faint depth bands under dense lines
    float fill = mix(
      0.035 - 0.005 * floor(clamp(-h, 0.0, 5999.0) / 1000.0),
      0.06 + 0.02 * floor(clamp(h, 0.0, 3999.0) / 1000.0),
      land
    );
    // day and night each add their own share of ink, so the night side reads
    // on a light ground as well as a dark one
    col = mix(uBg, uInk, fill * mix(0.4, 1.0, day) + mix(uMonoNight, uMonoDay, day));
    ink = mix(max(seaFine * 0.08, seaMajor * 0.18), max(landFine * 0.18, landMajor * 0.4), land);
    ink = max(ink, coast);
    ink = max(ink, grid5 * 0.1);
    ink = max(ink, grid30 * 0.24);
    ink = max(ink, equator * 0.45);
    ink = max(ink, dots * 0.26);
    ink *= mix(0.3, 1.0, day);
    ink = max(ink, terminator * 0.16);
    ink = max(ink, twilight * 0.08);
    // the picked satellite's view stands out over day and night: its own
    // fill and hatch, brighter lines, the rest of the globe stepped back
    if (seen) {
      col = mix(col, uInk, 0.1);
      ink = max(ink * 1.6, hatch * 0.22);
    } else if (picking) ink *= 0.7;
    col = mix(col, uInk, clamp(ink, 0.0, 1.0));
    col = mix(uBg, col, 0.8 + 0.2 * face);
  }
  o = vec4(col * cover, cover);
}`

// every uniform the shader takes, set from here
export const UNIFORMS = [
  'uRes',
  'uDpr',
  'uR',
  'uD',
  'uInv',
  'uLight',
  'uInk',
  'uBg',
  'uSeenU',
  'uSeenInk',
  'uSeenCos',
  'uHeight',
  'uMask',
  'uHasHeight',
  'uLook',
  'uCoast',
  'uOceanShallow',
  'uOceanDeep',
  'uLandLow',
  'uLandHigh',
  'uNight',
  'uNightMix',
  'uMonoDay',
  'uMonoNight',
  'uStep'
]

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }
  return shader
}

function texture(gl, unit, internal, format, type, w, h, data) {
  const tex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

// each level half the last, averaged, since a float texture of this kind
// cannot make its own
export function levels(size, heights) {
  const out = [heights]
  for (let n = size / 2; n >= 1; n /= 2) {
    const prev = out.at(-1)
    const next = new Float32Array(n * n)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = 4 * y * n + 2 * x
        next[y * n + x] = (prev[k] + prev[k + 1] + prev[k + 2 * n] + prev[k + 2 * n + 1]) / 4
      }
    }
    out.push(next)
  }
  return out
}

export function createGlobe(canvas, mask, maskW, maskH) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program))
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(program, 'a')
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
  const loc = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])
  )
  const bytes = Uint8Array.from(mask, (v) => v * 255)
  texture(gl, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, maskW, maskH, bytes)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  // a placeholder until the heights arrive, each set of them replacing the last
  let heightTex = texture(gl, 0, gl.R16F, gl.RED, gl.FLOAT, 1, 1, new Float32Array([0]))
  gl.uniform1i(loc.uHeight, 0)
  gl.uniform1i(loc.uMask, 1)
  gl.uniform1i(loc.uHasHeight, 0)

  return {
    terrain({ size, heights }) {
      gl.deleteTexture(heightTex)
      heightTex = texture(gl, 0, gl.R16F, gl.RED, gl.FLOAT, size, size, heights)
      for (const [k, level] of levels(size, heights).entries()) {
        if (!k) continue
        const n = size >> k
        gl.texImage2D(gl.TEXTURE_2D, k, gl.R16F, n, n, 0, gl.RED, gl.FLOAT, level)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.uniform1i(loc.uHasHeight, 1)
    },
    draw({
      width,
      height,
      dpr,
      r,
      distance,
      inv,
      light,
      ink,
      bg,
      seen,
      look,
      coast,
      palette,
      step
    }) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(loc.uRes, width, height)
      gl.uniform1f(loc.uDpr, dpr)
      gl.uniform1f(loc.uR, r)
      gl.uniform1f(loc.uD, distance)
      gl.uniformMatrix3fv(loc.uInv, false, inv.flat())
      gl.uniform3fv(loc.uLight, light)
      gl.uniform3fv(loc.uInk, ink)
      gl.uniform3fv(loc.uBg, bg)
      gl.uniform3fv(loc.uSeenU, seen ? seen.u : [0, 0, 1])
      gl.uniform3fv(loc.uSeenInk, seen ? seen.ink : ink)
      gl.uniform1f(loc.uSeenCos, seen ? seen.cos : 2)
      gl.uniform1i(loc.uLook, look)
      gl.uniform1f(loc.uCoast, coast)
      gl.uniform1f(loc.uStep, step)
      for (const name of ['OceanShallow', 'OceanDeep', 'LandLow', 'LandHigh', 'Night']) {
        gl.uniform3fv(loc[`u${name}`], palette[name])
      }
      gl.uniform1f(loc.uNightMix, palette.nightMix)
      gl.uniform1f(loc.uMonoDay, palette.monoDay)
      gl.uniform1f(loc.uMonoNight, palette.monoNight)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
