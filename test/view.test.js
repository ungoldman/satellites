import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import {
  ACTIONS,
  apply,
  between,
  contourStep,
  DISTANCE,
  DRAG,
  facing,
  fit,
  fling,
  grip,
  ground,
  hidden,
  hit,
  IDENTITY,
  invert,
  KEYS,
  keep,
  LIMB,
  MAX_SPIN,
  multiply,
  normalize,
  PICK_KEYS,
  parallels,
  pixels,
  project,
  RATE_KEYS,
  RATES,
  STILL,
  slow,
  spinBy,
  steer,
  toScreen,
  turn,
  unkeep,
  ZOOM,
  ZOOM_KEYS,
  zoomBy
} from '../src/view.js'

const near = (a, b, tolerance = 1e-9, label = '') =>
  assert.ok(Math.abs(a - b) <= tolerance, `${label} ${a} vs ${b}`)
const nearAll = (a, b, tolerance) => {
  for (const [i, c] of a.entries()) near(c, b[i], tolerance, `[${i}]`)
}
const angle = fc.double({ min: -360, max: 360, noNaN: true })

test('turns stay unit length', () => {
  fc.assert(
    fc.property(angle, angle, angle, (x, y, z) => {
      near(Math.hypot(...turn(IDENTITY, x, y, z)), 1, 1e-12)
      near(Math.hypot(...turn(IDENTITY, x, y)), 1, 1e-12)
    })
  )
})

test('identity changes nothing', () => {
  assert.deepEqual(apply(IDENTITY, [1, 2, 3]), [1, 2, 3])
  assert.deepEqual(multiply(IDENTITY, [0.5, 0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 0.5])
})

test('a turn about the screen y moves x toward z', () => {
  nearAll(apply(turn(IDENTITY, 0, 90), [1, 0, 0]), [0, 0, -1], 1e-12)
})

test('north is up at identity', () => {
  nearAll(toScreen(IDENTITY, [0, 0, 1]), [0, -1, 0], 1e-12)
  nearAll(toScreen(IDENTITY, [0, -1, 0]), [0, 0, -1], 1e-12)
})

test('facing brings a direction on the equator to the eye', () => {
  fc.assert(
    fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (a) => {
      nearAll(toScreen(facing(a), [Math.cos(a), Math.sin(a), 0]), [0, 0, -1], 1e-9)
    })
  )
})

test('tilt brings the latitude to the eye and the north toward it', () => {
  const lat = (30 * Math.PI) / 180
  const p = [Math.cos(lat), 0, Math.sin(lat)]
  nearAll(toScreen(facing(0, 30), p), [0, 0, -1], 1e-9)
  assert.ok(toScreen(facing(0, 20), [0, 0, 1])[2] < 0)
})

test('fling follows the drag, capped', () => {
  const [x, y, z] = fling(10, 0, 100)
  assert.equal(x, 0)
  assert.ok(y < 0)
  assert.equal(z, 0)
  near(Math.hypot(...fling(10000, 10000, 1)), MAX_SPIN)
  assert.ok(fling(0, 10, 0)[0] > 0)
})

test('friction slows a spin to a stop', () => {
  const spin = [2, 0, 0]
  const later = slow(spin, 1000 / 60)
  assert.ok(later[0] < 2 && later[0] > 1.9)
  assert.equal(slow([0.005, 0, 0], 16), STILL)
  let s = spin
  for (let k = 0; k < 400 && s !== STILL; k++) s = slow(s, 1000 / 60)
  assert.equal(s, STILL)
})

test('zoom stays in range', () => {
  assert.equal(zoomBy(1, 1e6), ZOOM[1])
  assert.equal(zoomBy(1, 0.001), ZOOM[0])
  assert.equal(zoomBy(1, 2), 2)
})

test('fit puts the reach at the same share of the view', () => {
  const [w, h] = [1000, 600]
  for (const reach of [1.5, 2.7, 6.6]) {
    const [x] = project([reach, 0, 0], w, h, fit(reach))
    near(x - w / 2, 0.42 * h, 1e-9, String(reach))
  }
  near(pixels(w, h, 1), h / DISTANCE)
  assert.deepEqual(project([0, 0, 0], w, h, 1), [w / 2, h / 2])
})

test('a ray through the center meets the near pole', () => {
  nearAll(hit(0, 0), [0, 0, -1], 1e-12)
  assert.ok(hit(0.99, 0))
  assert.equal(hit(1.01, 0), null)
})

test('a hit projects back to where the ray started', () => {
  const [w, h] = [800, 800]
  const r = pixels(w, h, 1)
  fc.assert(
    fc.property(
      fc.double({ min: -1.1, max: 1.1, noNaN: true }),
      fc.double({ min: -1.1, max: 1.1, noNaN: true }),
      (sx, sy) => {
        const p = hit(sx, sy)
        if (!p) return
        near(Math.hypot(...p), 1, 1e-9)
        const [x, y] = project(p, w, h, 1)
        near((x - w / 2) / r, sx, 1e-9)
        near((y - h / 2) / r, sy, 1e-9)
      }
    )
  )
})

test('the Earth hides what is behind it and nothing else', () => {
  assert.ok(hidden([0, 0, 3]))
  assert.ok(hidden([0.5, 0, 1]))
  assert.ok(!hidden([0, 0, -3]))
  assert.ok(!hidden([3, 0, 3]))
  // behind the eye
  assert.ok(!hidden([0, 0, -DISTANCE - 5]))
  // the near and far poles of the surface
  assert.ok(!hidden([0, 0, -1]))
  assert.ok(hidden([0, 0, 1]))
  // any point on the near side of the surface, whatever the rounding
  fc.assert(
    fc.property(
      fc.double({ min: -0.9, max: 0.9, noNaN: true }),
      fc.double({ min: -0.9, max: 0.9, noNaN: true }),
      (sx, sy) => {
        const p = hit(sx, sy)
        if (p) assert.ok(!hidden(p))
      }
    )
  )
})

test('keys map to known moves', () => {
  for (const v of Object.values(KEYS)) assert.equal(Math.hypot(...v), 1)
  assert.deepEqual(Object.keys(KEYS).sort(), ['KeyA', 'KeyD', 'KeyS', 'KeyW'])
  for (const v of Object.values(PICK_KEYS)) assert.equal(Math.abs(v), 1)
  for (const v of Object.values(RATE_KEYS)) assert.equal(Math.abs(v), 1)
  near(ZOOM_KEYS.Equal * ZOOM_KEYS.Minus, 1)
  assert.deepEqual(new Set(Object.values(ACTIONS)).size, Object.keys(ACTIONS).length)
  assert.equal(RATES[0], 1)
  assert.deepEqual(
    RATES,
    [...RATES].sort((a, b) => a - b)
  )
})

test('invert takes a screen point back to the Earth frame', () => {
  fc.assert(
    fc.property(angle, angle, angle, fc.double({ min: 0, max: 7, noNaN: true }), (x, y, z, g) => {
      const q = turn(IDENTITY, x, y, z)
      const e = [0.6, -0.48, 0.64]
      const inertial = [
        e[0] * Math.cos(g) - e[1] * Math.sin(g),
        e[0] * Math.sin(g) + e[1] * Math.cos(g),
        e[2]
      ]
      const p = toScreen(q, inertial)
      const [c0, c1, c2] = invert(q, g)
      nearAll(
        [0, 1, 2].map((i) => p[0] * c0[i] + p[1] * c1[i] + p[2] * c2[i]),
        e,
        1e-9
      )
    })
  )
})

const RAD = Math.PI / 180

test('normalize makes a unit quaternion', () => {
  nearAll(normalize([2, 0, 0, 0]), [1, 0, 0, 0], 1e-12)
  near(Math.hypot(...normalize([1, 2, 3, 4])), 1, 1e-12)
})

test('a view kept with the Earth faces the same ground as it turns', () => {
  // a point fixed on the Earth, carried round by sidereal angle g
  const ground0 = [0.3, 0.5, Math.sqrt(1 - 0.34)]
  const carried = (g) => [
    ground0[0] * Math.cos(g) - ground0[1] * Math.sin(g),
    ground0[0] * Math.sin(g) + ground0[1] * Math.cos(g),
    ground0[2]
  ]
  const q0 = facing(0.7, 20)
  const kept = keep(q0, 0.4)
  for (const g of [0.4, 1.9, 4, -2]) {
    nearAll(toScreen(unkeep(kept, g), carried(g)), toScreen(q0, carried(0.4)), 1e-12)
  }
  // turning by spinBy each frame does the same as unkeep
  nearAll(multiply(q0, spinBy(0.3)), unkeep(keep(q0, 0), 0.3), 1e-12)
  near(Math.hypot(...unkeep([2, 0, 0, 0], 1)), 1, 1e-12)
})

test('between turns one direction onto another the short way', () => {
  fc.assert(
    fc.property(angle, angle, angle, angle, (a1, a2, b1, b2) => {
      const a = apply(turn(IDENTITY, a1, a2), [0, 0, 1])
      const b = apply(turn(IDENTITY, b1, b2), [0, 0, 1])
      const q = between(a, b)
      if (!q) return
      nearAll(apply(q, a), b, 1e-9)
      assert.ok(q[0] >= -1e-12, 'short way')
    })
  )
  assert.equal(between([1, 0, 0], [1, 0, 0]), null)
})

test('grip is the set rate far out and tracks the ground close in', () => {
  assert.equal(grip(10), DRAG)
  // 1000 px per radius: a pixel is a thousandth of a radian
  near(grip(1000), 180 / Math.PI / 1000, 1e-12)
  assert.ok(grip(1e5) < grip(1e4))
})

test('contours close in as the zoom does', () => {
  assert.equal(contourStep(130), 250)
  assert.equal(contourStep(2e5), 20)
  assert.equal(contourStep(1e7), 5)
  let last = Infinity
  for (let px = 100; px < 1e7; px *= 2) {
    const step = contourStep(px)
    assert.ok(step <= last)
    last = step
  }
})

test('the ground at the center is the point faced', () => {
  for (const [lon, lat, g] of [
    [0, 0, 0],
    [-122.68, 45.52, 1.3],
    [140, -33, 5]
  ]) {
    const q = facing(lon * RAD + g, lat)
    const c = ground(q, g, 0, 0)
    near(c.lat, lat, 1e-9, 'lat')
    near((((c.lon - lon + 540) % 360) + 360) % 360, 180, 1e-9, 'lon')
  }
  assert.equal(ground(IDENTITY, 0, 2, 0), null)
})

test('the edge of the globe sits just past one radius', () => {
  near(LIMB, DISTANCE / Math.sqrt(DISTANCE ** 2 - 1), 1e-15)
  assert.ok(hit(LIMB * 0.999, 0))
  assert.equal(hit(LIMB * 1.001, 0), null)
})

test('the equator meets the edge on both sides when it is faced', () => {
  const rings = parallels(facing(0, 0), 0)
  const eq = rings.find((r) => r.v === 0)
  assert.equal(eq.angles.length, 2)
  assert.equal(eq.fade, 1)
  // on the left and right of the screen
  const sides = eq.angles.map((a) => Math.round(Math.cos(a))).sort()
  assert.deepEqual(sides, [-1, 1])
  // the parallels seen are the same on each side
  for (const r of rings) assert.equal(r.angles.length, 2, `${r.v}`)
  assert.deepEqual(
    rings.map((r) => r.v).sort((a, b) => a - b),
    [-80, -70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70, 80]
  )
})

test('a parallel fades as it turns to graze the edge', () => {
  // tipped 33° north the edge dips just past 50° south, so that parallel
  // crosses it twice close together and is fading
  const rings = parallels(facing(0, 33), 0)
  const graze = rings.find((r) => r.v === -50)
  assert.equal(graze.angles.length, 2)
  assert.ok(graze.fade > 0 && graze.fade < 1, `${graze.fade}`)
  assert.equal(rings.find((r) => r.v === 0).fade, 1)
  assert.equal(
    rings.find((r) => r.v === -60),
    undefined
  )
  // straight down on a pole the edge is one parallel all round, so none cross
  assert.deepEqual(parallels(facing(0, 90), 0), [])
})

test('steering moves the center over the ground with north up', () => {
  const g = 1.1
  const start = facing(-122.68 * RAD + g, 45.52)
  const north = ground(steer(start, g, 2, 0), g, 0, 0)
  near(north.lat, 47.52, 1e-9, 'north')
  near(north.lon, -122.68, 1e-9, 'lon kept')
  const east = ground(steer(start, g, 0, 3), g, 0, 0)
  near(east.lat, 45.52, 1e-9, 'lat kept')
  near(east.lon, -122.68 + 3, 1e-9, 'east')
  // the same turn in longitude near a pole, never faster
  const polar = facing(10 * RAD + g, 85)
  near(ground(steer(polar, g, 0, 3), g, 0, 0).lon, 13, 1e-6, 'polar east')
  // north stays up: the north pole projects straight above the center
  const up = toScreen(steer(start, g, 0, 3), [0, 0, 1])
  near(up[0], 0, 1e-12, 'no roll')
  assert.ok(up[1] < 0)
  // the center stops short of the poles
  near(ground(steer(start, g, 80, 0), g, 0, 0).lat, 89, 1e-9, 'pole')
  near(ground(steer(start, g, -200, 0), g, 0, 0).lat, -89, 1e-9, 'pole')
})
