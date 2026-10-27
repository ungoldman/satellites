// Orbits from CelesTrak's mean elements, the Earth's turn, and the Sun. No
// DOM, so it runs in Node too. Distances are km unless named in Earth radii.

// WGS 84
export const MU = 398600.4418
export const RE = 6378.137
const FLAT = 1 / 298.257223563
const J2 = 1.08262668e-3

const TAU = 2 * Math.PI
const RAD = Math.PI / 180
const DAY = 86400000

const wrap = (a) => ((a % TAU) + TAU) % TAU

// one CelesTrak OMM record, angles in radians and mean motion per minute
export function elements(omm) {
  const n = (omm.MEAN_MOTION * TAU) / 1440
  return {
    id: omm.NORAD_CAT_ID,
    name: omm.OBJECT_NAME,
    epoch: Date.parse(`${omm.EPOCH}Z`),
    n,
    a: Math.cbrt(MU / (n / 60) ** 2),
    e: omm.ECCENTRICITY,
    i: omm.INCLINATION * RAD,
    node: omm.RA_OF_ASC_NODE * RAD,
    peri: omm.ARG_OF_PERICENTER * RAD,
    m: omm.MEAN_ANOMALY * RAD,
    // half the rate of change of mean motion, revolutions per day squared
    ndot: omm.MEAN_MOTION_DOT
  }
}

// minutes per revolution
export const period = (el) => TAU / el.n

export function kepler(m, e) {
  let E = e < 0.8 ? m : Math.PI
  for (let k = 0; k < 12; k++) {
    const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E))
    E -= step
    if (Math.abs(step) < 1e-12) break
  }
  return E
}

// Position in the inertial frame at ms, km. Two-body motion plus the drift
// that the Earth's bulge (J2) gives the node and perigee, plus the decay
// in the elements. SGP4 also models drag, resonance, and the Sun and Moon.
// This stays within tens of km of it over a few days, under a pixel at
// globe scale.
export function position(el, ms) {
  const t = (ms - el.epoch) / 60000
  const p = el.a * (1 - el.e ** 2)
  const k = 1.5 * J2 * (RE / p) ** 2 * el.n
  const cos = Math.cos(el.i)
  const node = el.node - k * cos * t
  const peri = el.peri + k * (2 - 2.5 * Math.sin(el.i) ** 2) * t
  const days = t / 1440
  const m = wrap(el.m + el.n * t + TAU * el.ndot * days ** 2)
  const E = kepler(m, el.e)
  const x = el.a * (Math.cos(E) - el.e)
  const y = el.a * Math.sqrt(1 - el.e ** 2) * Math.sin(E)
  return rotate([x, y, 0], peri, el.i, node)
}

// perifocal to inertial: turned by perigee about z, inclination about x,
// node about z
function rotate([x, y], peri, i, node) {
  const cp = Math.cos(peri)
  const sp = Math.sin(peri)
  const ci = Math.cos(i)
  const si = Math.sin(i)
  const cn = Math.cos(node)
  const sn = Math.sin(node)
  const xp = x * cp - y * sp
  const yp = x * sp + y * cp
  const yi = yp * ci
  return [xp * cn - yi * sn, xp * sn + yi * cn, yp * si]
}

// km per second at distance r, vis-viva
export const speed = (el, r) => Math.sqrt(MU * (2 / r - 1 / el.a))

export const length = (v) => Math.hypot(...v)

// Greenwich mean sidereal time at ms, radians, IAU 1982
export function gmst(ms) {
  const T = (ms / DAY + 2440587.5 - 2451545) / 36525
  const s = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T ** 2 - 6.2e-6 * T ** 3
  return wrap(((s % 86400) / 240) * RAD)
}

// latitude and longitude in degrees and height above the WGS 84 ellipsoid
export function geodetic([x, y, z], ms) {
  const lon = ((((Math.atan2(y, x) - gmst(ms)) / RAD + 540) % 360) + 360) % 360
  const e2 = FLAT * (2 - FLAT)
  const r = Math.hypot(x, y)
  let lat = Math.atan2(z, r)
  let c = 1
  for (let k = 0; k < 5; k++) {
    c = 1 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
    lat = Math.atan2(z + RE * c * e2 * Math.sin(lat), r)
  }
  return { lat: lat / RAD, lon: lon - 180, alt: r / Math.cos(lat) - RE * c }
}

// Unit vector toward the Sun in the inertial frame at ms, good to about a
// hundredth of a degree. Astronomical Almanac low-precision formula.
export function sun(ms) {
  const n = ms / DAY + 2440587.5 - 2451545
  const g = (357.528 + 0.9856003 * n) * RAD
  const l = (280.46 + 0.9856474 * n) * RAD + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const tilt = (23.439 - 4e-7 * n) * RAD
  return [Math.cos(l), Math.cos(tilt) * Math.sin(l), Math.sin(tilt) * Math.sin(l)]
}

// a latitude and longitude in degrees on the unit sphere, inertial frame at ms
export function surface(lat, lon, ms) {
  const a = lon * RAD + gmst(ms)
  const c = Math.cos(lat * RAD)
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(lat * RAD)]
}

// geostationary: about one turn a sidereal day
export const stationary = (el) => Math.abs(period(el) - 1436.07) < 30

// How far out a point at r km is drawn, in Earth radii. True scale puts
// geostationary 6.6 radii out and the polar imagers just above the surface,
// so compressed scale takes a log of the height to fit both.
export const SCALES = {
  true: (r) => r / RE,
  compressed: (r) => 1 + 0.9 * Math.log(r / RE)
}

export function scaled(v, scale) {
  const r = length(v)
  const k = SCALES[scale](r) / r
  return v.map((c) => c * k)
}

// points along the orbit over one turn from ms, for drawing its path
export function track(el, ms, steps = 120) {
  const step = (period(el) * 60000) / steps
  return Array.from({ length: steps + 1 }, (_, k) => position(el, ms + k * step))
}
