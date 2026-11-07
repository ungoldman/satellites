// The camera: orientation, projection, zoom, and steering. No DOM, so it
// runs in Node too. Quaternion math follows ungoldman/shapes.

// Each key's move over the ground, as degrees north and east: see steer.
export const KEYS = {
  KeyW: [1, 0],
  KeyS: [-1, 0],
  KeyA: [0, -1],
  KeyD: [0, 1]
}

// degrees of ground per frame at 60 fps while a key is held, before zoom
export const STEER = 1.6

// degrees turned per pixel dragged, and the share of the drag's own speed a
// fling carries on at
export const DRAG = 0.3
export const FLING = 0.4
// a fling spins down to a stop, losing this share of its speed per frame
export const FRICTION = 0.04
export const MAX_SPIN = 8

const size = (v) => Math.hypot(...v)
const times = (v, k) => v.map((c) => c * k)
export const STILL = Object.freeze([0, 0, 0])

// the spin a drag leaves when let go while moving dx, dy px over ms, in
// degrees per frame at 60 fps
export function fling(dx, dy, ms) {
  const k = (FLING * DRAG * (1000 / 60)) / Math.max(1, ms)
  const spin = [dy * k, -dx * k, 0]
  const n = size(spin)
  return n > MAX_SPIN ? times(spin, MAX_SPIN / n) : spin
}

// spin after ms of friction, the same at any frame rate
export function slow(spin, ms) {
  const k = (1 - FRICTION) ** (ms / (1000 / 60))
  return size(spin) * k < 0.01 ? STILL : times(spin, k)
}

// Orientation is a unit quaternion [w, x, y, z], renormalized each step so
// it stays a pure rotation.
export const IDENTITY = [1, 0, 0, 0]

export function multiply([aw, ax, ay, az], [bw, bx, by, bz]) {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw
  ]
}

function about(axis, degrees) {
  const half = (degrees * Math.PI) / 360
  const s = Math.sin(half)
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s]
}

// turned about the screen's x axis, then its y, then its z, in degrees
export function turn(q, ax, ay, az = 0) {
  const next = multiply(
    about([0, 0, 1], az),
    multiply(about([0, 1, 0], ay), multiply(about([1, 0, 0], ax), q))
  )
  const n = Math.hypot(...next)
  return next.map((c) => c / n)
}

export function apply([w, x, y, z], [vx, vy, vz]) {
  // v + 2w(u × v) + 2u × (u × v), with u the vector part
  const cx = y * vz - z * vy
  const cy = z * vx - x * vz
  const cz = x * vy - y * vx
  return [
    vx + 2 * (w * cx + y * cz - z * cy),
    vy + 2 * (w * cy + z * cx - x * cz),
    vz + 2 * (w * cz + x * cy - y * cx)
  ]
}

// World has z through the north pole. Screen has y down and z into it. At
// identity north is up and the eye looks along the world's +y.
export const toScreen = (q, [x, y, z]) => apply(q, [x, -z, y])

// Facing the inertial direction at angle a round the equator, in radians,
// tipped toward the north by tilt degrees.
export function facing(a, tilt = 0) {
  return turn(turn(IDENTITY, 0, ((a + Math.PI / 2) * 180) / Math.PI), tilt, 0)
}

// how far the eye sits from the Earth's center, in Earth radii
export const DISTANCE = 12

// how far in and out a zoom may go, against the fit for the scale, in as
// far as a region, past which the world's heights hold no more detail
export const ZOOM = [0.5, 100]

export function zoomBy(zoom, factor) {
  return Math.min(ZOOM[1], Math.max(ZOOM[0], zoom * factor))
}

// zoom that fits a scene reaching out to reach Earth radii in the view
export const fit = (reach) => (0.42 * DISTANCE) / reach

// px per Earth radius at the center's depth
export const pixels = (width, height, zoom) => (zoom * Math.min(width, height)) / DISTANCE

// perspective onto a width by height view, its field of view the shorter side
export function project([x, y, z], width, height, zoom) {
  const f = (zoom * Math.min(width, height)) / (DISTANCE + z)
  return [x * f + width / 2, y * f + height / 2]
}

// Where the ray through a screen point meets the unit sphere, in screen
// space, or null. sx and sy are px from the center over px per radius at
// the center's depth.
export function hit(sx, sy) {
  // the ray is eye + t (sx / d, sy / d, 1) with the eye at z = -d
  const dx = sx / DISTANCE
  const dy = sy / DISTANCE
  const b = -2 * DISTANCE
  const a = dx * dx + dy * dy + 1
  const c = DISTANCE * DISTANCE - 1
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  return [dx * t, dy * t, t - DISTANCE]
}

// whether the Earth stands between the eye and a point in screen space
export function hidden([x, y, z]) {
  const d = [x, y, z + DISTANCE]
  const a = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  const b = -2 * DISTANCE * d[2]
  const c = DISTANCE * DISTANCE - 1
  const disc = b * b - 4 * a * c
  if (disc <= 0) return false
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  // a point on the surface meets the sphere at t = 1 itself, which rounding
  // would put either side
  return t > 0 && t < 1 - 1e-6
}

// The matrix taking a screen point back to the Earth's own frame, given
// the view and sidereal angle g, as its three columns.
export function invert([w, x, y, z], g) {
  const back = [w, -x, -y, -z]
  const c = Math.cos(g)
  const s = Math.sin(g)
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ].map((v) => {
    // undo the view, then the screen axes, then the Earth's turn
    const [ux, uy, uz] = apply(back, v)
    const [ix, iy, iz] = [ux, uz, -uy]
    return [ix * c + iy * s, -ix * s + iy * c, iz]
  })
}

// zoom factor per press
export const ZOOM_KEYS = {
  Equal: 1.15,
  Minus: 1 / 1.15
}

// step through the satellites, and through time's speed
export const PICK_KEYS = {
  BracketLeft: -1,
  BracketRight: 1
}
export const RATE_KEYS = {
  Comma: -1,
  Period: 1
}
// and along the time bar, a step of it at a time
export const TIME_KEYS = {
  ArrowLeft: -1,
  ArrowRight: 1
}

export const ACTIONS = {
  Space: 'pause',
  KeyT: 'scale',
  KeyN: 'now',
  KeyL: 'light',
  KeyI: 'info',
  KeyM: 'style',
  KeyR: 'home',
  KeyG: 'locate',
  Escape: 'deselect'
}

// time's speed, in seconds per second
export const RATES = [1, 10, 60, 300, 1800, 3600]

export const normalize = (q) => q.map((c) => c / Math.hypot(...q))

// spherical interpolation from a to b by t, the short way round
export function slerp(a, b, t) {
  let d = a.reduce((s, c, i) => s + c * b[i], 0)
  const to = d < 0 ? b.map((c) => -c) : b
  d = Math.abs(d)
  if (d > 0.9995) return a.map((c, i) => c + (to[i] - c) * t)
  const th = Math.acos(d)
  const s = Math.sin(th)
  const ka = Math.sin((1 - t) * th) / s
  const kb = Math.sin(t * th) / s
  return a.map((c, i) => c * ka + to[i] * kb)
}

// whether two screen boxes, [left, top, right, bottom], overlap
export const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

// A callout from point m to a box to its right or below it: a 45° leg, then
// straight into the box's nearest edge, pad in from its corners. The leg is
// null when the point already lines up. Null when the box is not clear of
// the point, or the line would be too short to read.
export function leader(m, box, pad = 14) {
  let elbow
  let end
  if (m.x < box.left - 24) {
    const y = Math.min(box.bottom - pad, Math.max(box.top + pad, m.y))
    end = [box.left, y]
    elbow = [Math.min(m.x + Math.abs(y - m.y), box.left - 16), y]
  } else if (m.y < box.top - 24) {
    const x = Math.min(box.right - pad, Math.max(box.left + pad, m.x))
    end = [x, box.top]
    elbow = [x, Math.min(m.y + Math.abs(x - m.x), box.top - 16)]
  } else return null
  const lead = Math.hypot(elbow[0] - m.x, elbow[1] - m.y) > 1 ? elbow : end
  const d = Math.hypot(lead[0] - m.x, lead[1] - m.y)
  if (d < 20) return null
  // starts clear of the glyph
  const start = [m.x + ((lead[0] - m.x) / d) * 19, m.y + ((lead[1] - m.y) / d) * 19]
  return { start, elbow: lead === elbow ? elbow : null, end }
}

// A turn by angle a about the Earth's axis, as the view sees it. Applied
// after the view, the camera turns with the Earth: see keep and unkeep.
export const spinBy = (a) => [Math.cos(a / 2), 0, Math.sin(a / 2), 0]

// the view with the Earth's turn at sidereal angle g taken out, so it names
// ground rather than sky, and back again at another g
export const keep = (q, g) => multiply(q, spinBy(-g))
export const unkeep = (q, g) => normalize(multiply(q, spinBy(g)))

// the turn carrying unit vector a onto b the short way, or null when they
// already agree
export function between(a, b) {
  const axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const s = size(axis)
  if (s < 1e-12) return null
  const angle = Math.atan2(s, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
  const k = Math.sin(angle / 2) / s
  return [Math.cos(angle / 2), axis[0] * k, axis[1] * k, axis[2] * k]
}

// degrees a pixel of drag turns for a globe px across per radius: the set
// rate far out, and close in whatever keeps the ground with the pointer
export const grip = (px) => Math.min(DRAG, 180 / Math.PI / px)

// metres between fine contours for a globe px across per radius, finer as
// each pixel covers less ground
export function contourStep(px) {
  const want = (6378137 / px) * 0.6
  return [5, 10, 20, 25, 50, 100, 250].find((m) => m >= want) ?? 250
}

// latitude and longitude in degrees of the ground at screen point sx, sy, in
// radii from the center, under view q at sidereal angle g, or null off the
// globe
export function ground(q, g, sx, sy) {
  const p = hit(sx, sy)
  if (!p) return null
  const [c0, c1, c2] = invert(q, g)
  const e = [0, 1, 2].map((i) => p[0] * c0[i] + p[1] * c1[i] + p[2] * c2[i])
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180) / Math.PI,
    lon: (Math.atan2(e[1], e[0]) * 180) / Math.PI
  }
}

// The edge of the globe in radii from the center.
export const LIMB = DISTANCE / Math.sqrt(DISTANCE ** 2 - 1)

// The view moved over the ground under view q at sidereal angle g: the point
// at the center goes north and east by degrees, and north comes back up. East
// is a steady turn in longitude, which near a pole spins the view about it at
// the same rate as anywhere else. The center stops short of a pole.
export function steer(q, g, north, east) {
  const c = ground(q, g, 0, 0)
  const lat = Math.max(-89, Math.min(89, c.lat + north))
  const lon = c.lon + east
  return facing((lon * Math.PI) / 180 + g, lat)
}
