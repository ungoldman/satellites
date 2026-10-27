// The camera: orientation, projection, zoom, and steering. No DOM, so it
// runs in Node too. Quaternion math follows ungoldman/shapes.

// Each key's direction, as a turn about the screen's x, y, and z. The z axis
// points into the screen, so a negative turn about it is counterclockwise.
export const KEYS = {
  KeyW: [-1, 0, 0],
  KeyS: [1, 0, 0],
  KeyA: [0, 1, 0],
  KeyD: [0, -1, 0],
  KeyQ: [0, 0, -1],
  KeyE: [0, 0, 1]
}

// degrees per frame at 60 fps while a key is held
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

// how far in and out a zoom may go, against the fit for the scale
export const ZOOM = [0.5, 8]

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

export const ACTIONS = {
  Space: 'pause',
  KeyT: 'scale',
  KeyN: 'now',
  KeyL: 'light',
  KeyI: 'info',
  Escape: 'deselect'
}

// time's speed, in seconds per second
export const RATES = [1, 10, 60, 300, 1800, 3600]
