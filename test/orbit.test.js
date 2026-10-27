import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import fc from 'fast-check'
import * as sgp4 from 'satellite.js'
import {
  elements,
  geodetic,
  gmst,
  kepler,
  length,
  MU,
  period,
  position,
  RE,
  SCALES,
  scaled,
  speed,
  stationary,
  sun,
  surface,
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
