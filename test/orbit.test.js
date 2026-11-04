import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import fc from 'fast-check'
import * as sgp4 from 'satellite.js'
import {
  elements,
  geodetic,
  gmst,
  horizon,
  kepler,
  length,
  MU,
  passOver,
  period,
  position,
  RE,
  SCALES,
  scaled,
  speed,
  stationary,
  sun,
  sunlit,
  surface,
  toward,
  track
} from '../src/orbit.js'

const GP = JSON.parse(readFileSync(new URL('fixtures/gp.json', import.meta.url))).flat()
const DAY = 86400000
const near = (a, b, tolerance, label) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`)
const at = (id) => GP.find((omm) => omm.NORAD_CAT_ID === id)

test('elements read an OMM record into radians and minutes', () => {
  const el = elements(at(43013))
  assert.equal(el.id, 43013)
  assert.equal(el.name, 'NOAA 20 (JPSS-1)')
  assert.equal(el.epoch, Date.parse(`${at(43013).EPOCH}Z`))
  near(period(el), 1440 / at(43013).MEAN_MOTION, 1e-9, 'period')
  // Kepler's third law gives the semi-major axis back from the period
  near(2 * Math.PI * Math.sqrt(el.a ** 3 / MU), period(el) * 60, 1e-6, 'third law')
})

test('kepler solves the equation it is named for', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      fc.double({ min: 0, max: 0.95, noNaN: true }),
      (m, e) => {
        const E = kepler(m, e)
        near(E - e * Math.sin(E), m, 1e-9, 'M')
      }
    )
  )
})

test('positions stay within 60 km of SGP4 for three days', () => {
  for (const omm of GP) {
    const el = elements(omm)
    const rec = sgp4.json2satrec(omm)
    for (const days of [0, 0.5, 1, 2, 3]) {
      const ms = el.epoch + days * DAY
      const p = sgp4.propagate(rec, new Date(ms)).position
      const q = position(el, ms)
      const gap = Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2])
      assert.ok(gap < 60, `${omm.OBJECT_NAME} day ${days}: ${gap.toFixed(1)} km`)
    }
  }
})

test('speed matches SGP4 velocity', () => {
  for (const omm of GP) {
    const el = elements(omm)
    const { position: p, velocity: v } = sgp4.propagate(sgp4.json2satrec(omm), new Date(el.epoch))
    near(speed(el, Math.hypot(p.x, p.y, p.z)), Math.hypot(v.x, v.y, v.z), 0.01, omm.OBJECT_NAME)
  }
})

test('sidereal time matches SGP4', () => {
  for (const ms of [0, Date.UTC(2000, 0, 1, 12), Date.UTC(2026, 9, 27, 4, 30)]) {
    near(gmst(ms), sgp4.gstime(new Date(ms)), 1e-9, String(ms))
  }
})

test('geodetic matches SGP4 for every satellite', () => {
  for (const omm of GP) {
    const el = elements(omm)
    const ms = el.epoch + DAY / 3
    const p = sgp4.propagate(sgp4.json2satrec(omm), new Date(ms)).position
    const want = sgp4.eciToGeodetic(p, sgp4.gstime(new Date(ms)))
    const got = geodetic([p.x, p.y, p.z], ms)
    near(got.lat, sgp4.degreesLat(want.latitude), 1e-6, `${omm.OBJECT_NAME} lat`)
    near(got.lon, sgp4.degreesLong(want.longitude), 1e-6, `${omm.OBJECT_NAME} lon`)
    near(got.alt, want.height, 1e-3, `${omm.OBJECT_NAME} alt`)
  }
})

test('the Sun sits on the equinox and the solstice', () => {
  // March equinox 2026-03-20 14:46 UTC, June solstice 2026-06-21 08:24 UTC
  const march = sun(Date.UTC(2026, 2, 20, 14, 46))
  near(march[0], 1, 1e-6, 'march x')
  near(march[2], 0, 1e-3, 'march z')
  const june = sun(Date.UTC(2026, 5, 21, 8, 24))
  near(june[2], Math.sin((23.436 * Math.PI) / 180), 1e-4, 'june z')
  near(length(june), 1, 1e-12, 'unit')
})

test('surface points land back where they were placed', () => {
  const ms = Date.UTC(2026, 9, 27)
  for (const [lat, lon] of [
    [0, 0],
    [0, -122.7],
    [0, 179.9]
  ]) {
    const got = geodetic(
      surface(lat, lon, ms).map((c) => c * RE),
      ms
    )
    near(got.lat, lat, 1e-9, 'lat')
    near(got.lon, lon, 1e-9, 'lon')
    near(got.alt, 0, 1e-6, 'alt')
  }
})

test('geostationary is told from polar', () => {
  assert.ok(stationary(elements(at(60133))))
  assert.ok(stationary(elements(at(41836))))
  assert.ok(!stationary(elements(at(43013))))
  assert.ok(!stationary(elements(at(39084))))
})

test('scales keep the surface and the direction', () => {
  for (const name of Object.keys(SCALES)) near(SCALES[name](RE), 1, 1e-12, name)
  // compressed fits geostationary within three radii
  near(SCALES.compressed(42164), 2.7, 0.1, 'geo')
  assert.ok(SCALES.compressed(RE + 800) > 1.1)
  const v = [RE * 2, 0, RE * 2]
  for (const name of Object.keys(SCALES)) {
    const s = scaled(v, name)
    near(s[0], s[2], 1e-12, name)
    near(length(s), SCALES[name](length(v)), 1e-12, name)
  }
})

test('a track closes on itself after one turn', () => {
  const el = elements(at(43013))
  const points = track(el, el.epoch)
  assert.equal(points.length, 121)
  assert.deepEqual(points[0], position(el, el.epoch))
  // the Earth's bulge moves the orbit a little each turn
  assert.ok(Math.hypot(...points[0].map((c, i) => c - points[120][i])) < 100)
  assert.equal(track(el, el.epoch, 10).length, 11)
})

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

test('toward is surface before the Earth turns', () => {
  fc.assert(
    fc.property(
      fc.double({ min: -90, max: 90, noNaN: true }),
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.integer({ min: 0, max: 4e12 }),
      (lat, lon, ms) => {
        const v = toward(lat, lon)
        near(length(v), 1, 1e-12, 'unit')
        const g = gmst(ms)
        const turned = [
          v[0] * Math.cos(g) - v[1] * Math.sin(g),
          v[0] * Math.sin(g) + v[1] * Math.cos(g),
          v[2]
        ]
        for (const [i, c] of surface(lat, lon, ms).entries()) near(c, turned[i], 1e-9, `[${i}]`)
      }
    )
  )
})

test('a horizon is a closed ring on the ground at the tangent angle', () => {
  for (const r of [
    [42164, 0, 0],
    [3000, -4000, 5000],
    // over a pole, where the ring is built from another axis
    [10, 20, 7200]
  ]) {
    const ring = horizon(r, 48)
    assert.equal(ring.length, 49)
    for (const [i, c] of ring[0].entries()) near(c, ring.at(-1)[i], 1e-6, 'closed')
    const edge = RE / length(r)
    for (const p of ring) {
      near(length(p), RE, 1e-6, 'on the ground')
      near(dot(p, r) / (RE * length(r)), edge, 1e-9, 'tangent')
    }
  }
  assert.equal(horizon([0, 0, 8000]).length, 97)
})

test('a satellite is sunlit unless the Earth shades it', () => {
  const ms = Date.UTC(2026, 2, 20, 12)
  const s = sun(ms)
  const out = s.map((c) => c * 7000)
  assert.deepEqual(sunlit(out, ms), { shadow: false, day: true })
  assert.deepEqual(
    sunlit(
      s.map((c) => -c * 7000),
      ms
    ),
    { shadow: true, day: false }
  )
  // behind the Earth but beside its shadow
  const side = [-s[1], s[0], 0].map((c) => c / Math.hypot(s[0], s[1]))
  const beside = side.map((c, i) => c * 9000 - s[i] * 1000)
  assert.deepEqual(sunlit(beside, ms), { shadow: false, day: false })
})

test('a pass is the daylight moment a satellite came nearest a point', () => {
  const el = elements(at(43013))
  const day = at(43013).EPOCH.slice(0, 10)
  const [lat, lon] = [45.52, -122.68]
  const t = passOver(el, lat, lon, day)
  const start = Date.parse(`${day}T00:00:00Z`)
  assert.ok(t >= start && t < start + DAY)
  assert.ok(dot(sun(t), surface(lat, lon, t)) > 0, 'in daylight')
  // close enough to have imaged it, VIIRS seeing 1,500 km to each side
  const below = geodetic(position(el, t), t)
  const apart = Math.acos(dot(toward(below.lat, below.lon), toward(lat, lon))) * RE
  assert.ok(apart < 1500, `${apart} km`)
  // and nearer then than a minute either side
  for (const dt of [-60000, 60000]) {
    const g = geodetic(position(el, t + dt), t + dt)
    assert.ok(dot(toward(g.lat, g.lon), toward(lat, lon)) <= Math.cos(apart / RE) + 1e-12)
  }
})

test('there is no pass in a polar night', () => {
  const el = elements(at(43013))
  assert.equal(passOver(el, 89, 0, '2026-12-21'), null)
})
