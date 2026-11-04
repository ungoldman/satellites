import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  box,
  FLEET,
  FRESH,
  GOES_LAG,
  GROUPS,
  goes,
  groupUrl,
  HIMAWARI_LAG,
  himawari,
  MINUTE,
  pick,
  picture,
  SLIDER_LAG,
  slider,
  slot,
  wikiUrl,
  yesterday
} from '../src/fleet.js'

const GP = JSON.parse(readFileSync(new URL('fixtures/gp.json', import.meta.url)))
const byName = (name) => FLEET.find((sat) => sat.name === name)
const MS = Date.UTC(2026, 9, 27, 4, 36, 21)

test('the fleet has one entry per satellite', () => {
  assert.equal(new Set(FLEET.map((sat) => sat.id)).size, FLEET.length)
  assert.equal(new Set(FLEET.map((sat) => sat.name)).size, FLEET.length)
})

test('every satellite links to its Wikipedia article', () => {
  for (const sat of FLEET) assert.match(sat.wiki, /^[\w().-]+$/, sat.name)
  assert.equal(wikiUrl(byName('Terra')), 'https://en.wikipedia.org/wiki/Terra_(satellite)')
  assert.equal(wikiUrl(byName('GK-2A')), 'https://en.wikipedia.org/wiki/Chollian-2A')
})

test('groups are fetched as JSON no more than CelesTrak asks', () => {
  assert.deepEqual(GROUPS, ['weather', 'resource'])
  assert.equal(
    groupUrl('weather'),
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json'
  )
  assert.ok(FRESH >= 2 * 3600000)
})

test('pick finds the whole fleet in order', () => {
  const sats = pick(GP)
  assert.deepEqual(
    sats.map((sat) => sat.id),
    FLEET.map((sat) => sat.id)
  )
  for (const sat of sats) assert.equal(sat.omm.NORAD_CAT_ID, sat.id)
})

test('pick skips what the groups lack', () => {
  const sats = pick([GP[0].slice(1), []])
  assert.equal(sats.length, GP[0].length - 1)
})

test('himawari steps back by ten-minute slots behind the lag', () => {
  // 04:36 less half an hour is 04:06, slot 04:00
  assert.equal(
    himawari(MS),
    'https://himawari8.nict.go.jp/img/D531106/1d/550/2026/10/27/040000_0_0.png'
  )
  assert.match(himawari(MS, 1), /2026\/10\/27\/035000_0_0/)
  // across midnight
  assert.match(himawari(Date.UTC(2026, 0, 1, 0, 20)), /2025\/12\/31\/235000_0_0/)
  assert.equal(HIMAWARI_LAG, 30 * MINUTE)
})

test('slots round down to the cadence', () => {
  // 04:36 less 40 minutes is 03:56, slot 03:45 every 15 minutes
  assert.deepEqual(slot(MS, 15, SLIDER_LAG), {
    ms: Date.UTC(2026, 9, 27, 3, 45),
    day: '2026/10/27',
    time: '034500'
  })
  assert.deepEqual(slot(MS, 15, SLIDER_LAG, 2), {
    ms: Date.UTC(2026, 9, 27, 3, 15),
    day: '2026/10/27',
    time: '031500'
  })
  assert.equal(slot(MS, 10, SLIDER_LAG).time, '035000')
})

test('SLIDER tiles name the day, the satellite, and the stamp', () => {
  assert.equal(
    slider('meteosat-0deg', 15, MS),
    'https://slider.cira.colostate.edu/data/imagery/2026/10/27/meteosat-0deg---full_disk/geocolor/20261027034500/00/000_000.png'
  )
  const p = picture(byName('GK-2A'), { lat: 0, lon: 128 }, MS, 1)
  assert.equal(p.src, slider('gk2a', 10, MS, 1))
  // 03:56 is slot 03:50, one back is 03:40
  assert.equal(p.taken, Date.UTC(2026, 9, 27, 3, 40))
  assert.equal(
    p.href,
    'https://slider.cira.colostate.edu/?sat=gk2a&sec=full_disk&p%5B0%5D=geocolor'
  )
  assert.ok(p.steps)
})

test('yesterday is the last whole UTC day', () => {
  assert.equal(yesterday(MS), '2026-10-26')
  assert.equal(yesterday(Date.UTC(2026, 0, 1)), '2025-12-31')
})

test('a box stays inside the map', () => {
  assert.deepEqual(box(45.5, -122.7), [35.5, -137.7, 55.5, -107.7])
  assert.deepEqual(box(89, 179), [70, 150, 90, 180])
  assert.deepEqual(box(-89, -179), [-90, -180, -70, -150])
})

test('GOES files are named by year, day of year, and time', () => {
  // 04:36 less 20 minutes is 04:16, slot 04:10, day 300 of 2026
  assert.deepEqual(goes('GOES19', MS), {
    src: 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/GEOCOLOR/20263000410_GOES19-ABI-FD-GEOCOLOR-678x678.jpg',
    taken: Date.UTC(2026, 9, 27, 4, 10)
  })
  assert.match(goes('GOES18', MS, 2).src, /GOES18\/.+\/20263000350_GOES18-/)
  // the first slot of a year is day 001, and the last of the one before is 365
  assert.match(goes('GOES19', Date.UTC(2026, 0, 1, 0, 25)).src, /\/20260010000_/)
  assert.match(goes('GOES19', Date.UTC(2026, 0, 1, 0, 15)).src, /\/20253652350_/)
  assert.equal(GOES_LAG, 20 * MINUTE)
})

test('GOES gets the NOAA STAR full disk and steps back', () => {
  const p = picture(byName('GOES-19'), { lat: 0, lon: -75 }, MS, 1)
  assert.equal(p.src, goes('GOES19', MS, 1).src)
  assert.equal(p.taken, Date.UTC(2026, 9, 27, 4, 0))
  assert.equal(p.href, 'https://www.star.nesdis.noaa.gov/GOES/fulldisk.php?sat=G19')
  assert.match(p.caption, /NOAA STAR/)
  assert.ok(p.steps)
})

test('Himawari gets the NICT full disk', () => {
  const p = picture(byName('Himawari-9'), { lat: 0, lon: 140.8 }, MS, 2)
  assert.equal(p.src, himawari(MS, 2))
  // 04:06 is slot 04:00, two back is 03:40
  assert.equal(p.taken, Date.UTC(2026, 9, 27, 3, 40))
  assert.equal(p.href, 'https://himawari8.nict.go.jp/')
  assert.ok(p.steps)
})

test('the polar imagers get Worldview below them', () => {
  const p = picture(byName('NOAA-20'), { lat: 45.5, lon: -122.7 }, MS)
  const url = new URL(p.src)
  assert.equal(url.origin + url.pathname, 'https://wvs.earthdata.nasa.gov/api/v1/snapshot')
  assert.equal(url.searchParams.get('LAYERS'), 'VIIRS_NOAA20_CorrectedReflectance_TrueColor')
  assert.equal(url.searchParams.get('TIME'), '2026-10-26')
  assert.equal(url.searchParams.get('BBOX'), '35.5,-137.7,55.5,-107.7')
  assert.equal(
    p.href,
    'https://worldview.earthdata.nasa.gov/?l=VIIRS_NOAA20_CorrectedReflectance_TrueColor&t=2026-10-26&v=-137.7,35.5,-107.7,55.5'
  )
  // a daily composite has no one time: the day, and the middle of the box
  // so the pass over it can be timed
  assert.equal(p.day, '2026-10-26')
  assert.ok(Math.abs(p.over.lat - 45.5) < 1e-9 && Math.abs(p.over.lon + 122.7) < 1e-9)
  assert.equal(p.taken, undefined)
  assert.match(p.caption, /NASA Worldview/)
  assert.match(
    picture(byName('Aqua'), { lat: 0, lon: 0 }, MS).src,
    /MODIS_Aqua_CorrectedReflectance/
  )
})

test('the rest link out to their agency', () => {
  const p = picture(byName('Landsat 9'), { lat: 0, lon: 0 }, MS)
  assert.equal(p.src, null)
  assert.equal(p.href, 'https://landsatlook.usgs.gov/')
  assert.equal(p.caption, 'Imagery on LandsatLook')
})
