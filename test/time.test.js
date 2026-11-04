import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { away, DAY, gap, midnights, SPEEDS, share, utc, WEEK, within } from '../src/time.js'
import { RATES } from '../src/view.js'

const MIN = 60000
const NOW = Date.UTC(2026, 10, 4, 6, 30, 15)

test('utc reads the clock to the minute or the second', () => {
  assert.equal(utc(NOW), '2026-11-04 06:30 UTC')
  assert.equal(utc(NOW, true), '2026-11-04 06:30:15 UTC')
})

test('away says how far off now, in the largest two units', () => {
  assert.equal(away(0), 'now')
  // under a minute and a half reads as now
  assert.equal(away(-89000), 'now')
  assert.equal(away(-90000), '2 min behind')
  assert.equal(away(5 * MIN), '5 min ahead')
  assert.equal(away(-35 * MIN), '35 min behind')
  assert.equal(away(2 * 60 * MIN), '2 h ahead')
  assert.equal(away(-(3 * 60 + 20) * MIN), '3 h 20 min behind')
  assert.equal(away(2 * DAY), '2 d ahead')
  assert.equal(away(2 * DAY + 4 * 60 * MIN), '2 d 4 h ahead')
})

test('gap is the same, signed and short', () => {
  assert.equal(gap(30000), '')
  assert.equal(gap(2 * DAY + 4 * 60 * MIN), '+2 d 4 h')
  assert.equal(gap(-30 * 60 * MIN), '−1 d 6 h')
})

test('within keeps a clock a week either side of now', () => {
  assert.equal(within(NOW + DAY, NOW), NOW + DAY)
  assert.equal(within(NOW + 2 * WEEK, NOW), NOW + WEEK)
  assert.equal(within(NOW - 2 * WEEK, NOW), NOW - WEEK)
})

test('share puts now in the middle and the ends at a week', () => {
  assert.equal(share(0), 0.5)
  assert.equal(share(-WEEK), 0)
  assert.equal(share(WEEK), 1)
  fc.assert(
    fc.property(fc.integer({ min: -WEEK, max: WEEK }), (off) => {
      const s = share(off)
      assert.ok(s >= 0 && s <= 1)
    })
  )
})

test('midnights mark each UTC day on the bar, in order', () => {
  const marks = midnights(NOW)
  assert.equal(marks.length, 14)
  assert.equal(marks[0].label, 'Oct 29')
  assert.equal(marks.at(-1).label, 'Nov 11')
  for (const [k, m] of marks.entries()) {
    assert.ok(m.at > 0 && m.at < 1)
    if (k) near(m.at - marks[k - 1].at, 1 / 14)
  }
  // a now on midnight itself puts one at each end and one in the middle
  const exact = midnights(Date.UTC(2026, 10, 4))
  assert.equal(exact[0].at, 0)
  assert.equal(exact.length, 14)
  assert.equal(exact[7].at, 0.5)
})

test('every speed has a label', () => {
  assert.equal(SPEEDS.length, RATES.length)
})

function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`)
}
