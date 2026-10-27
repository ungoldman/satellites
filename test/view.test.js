import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import {
  ACTIONS,
  apply,
  DISTANCE,
  facing,
  fit,
  fling,
  hidden,
  hit,
  IDENTITY,
  invert,
  KEYS,
  MAX_SPIN,
  multiply,
  PICK_KEYS,
  pixels,
  project,
  RATE_KEYS,
  RATES,
  STILL,
  slow,
  toScreen,
  turn,
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
  assert.equal(zoomBy(1, 100), ZOOM[1])
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
