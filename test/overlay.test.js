import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { pick } from '../src/fleet.js'
import { elements, GEO_KM, gmst, position, SCALES, stationary } from '../src/orbit.js'
import { createOverlay, markAll } from '../src/overlay.js'
import { facing, fit } from '../src/view.js'

const GP = JSON.parse(readFileSync(new URL('fixtures/gp.json', import.meta.url)))
const MS = Date.UTC(2026, 9, 27, 4, 36, 21)
const SATS = pick(GP).map((sat) => {
  const el = elements(sat.omm)
  return { ...sat, el, geo: stationary(el) }
})
const INK = Object.fromEntries(
  [
    'mono',
    'belt',
    'tick',
    'faint',
    'limb',
    'geo',
    'leo',
    'track',
    'bgCss',
    'fg',
    'dim',
    'coast'
  ].map((k) => [k, k])
)
const byName = (name) => SATS.findIndex((sat) => sat.name === name)

// A stand-in 2D context: every call is noted with its arguments and the
// styles set at the time, and text measures 6 px a character.
function fakeCtx() {
  const calls = []
  const state = { globalAlpha: 1 }
  const ctx = new Proxy(state, {
    get(target, name) {
      if (name === 'calls') return calls
      if (name in target) return target[name]
      if (name === 'measureText') return (text) => ({ width: text.length * 6 })
      return (...args) => {
        calls.push({
          name,
          args,
          alpha: target.globalAlpha,
          stroke: target.strokeStyle,
          dash: target.dash
        })
      }
    },
    set(target, name, value) {
      target[name] = value
      return true
    }
  })
  // keep the dash the way a context does, so a stroke can be checked for it
  state.setLineDash = (dash) => {
    state.dash = dash
  }
  return ctx
}

const of = (ctx, name) => ctx.calls.filter((c) => c.name === name)
const texts = (ctx) => of(ctx, 'fillText').map((c) => c.args[0])

// a scene looking at the inertial direction a, tipped north by tilt
function scene(a, tilt, over = {}) {
  const base = {
    width: 800,
    height: 600,
    orientation: facing(a, tilt),
    scale: 'compressed',
    z: 1.2 * fit(SCALES.compressed(GEO_KM) * 1.05),
    g: gmst(MS),
    sim: MS,
    ink: INK,
    look: 0,
    sats: SATS,
    selected: -1,
    hovered: -1,
    lines: [],
    box: null,
    here: null,
    cursor: null,
    ...over
  }
  return { ...base, marks: markAll(base) }
}

// facing the satellite at index, from above its ground
function facingSat(index, over) {
  const r = position(SATS[index].el, MS)
  return scene(Math.atan2(r[1], r[0]), (Math.asin(r[2] / Math.hypot(...r)) * 180) / Math.PI, over)
}

test('every satellite gets a mark, its label value by kind of orbit', () => {
  const marks = markAll(scene(0, 0))
  assert.equal(marks.length, SATS.length)
  for (const m of marks) {
    const sat = SATS[m.index]
    assert.match(m.value, sat.geo ? /°[EW]$/ : / km$/)
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.heading))
    assert.ok(m.kms > 1)
  }
})

test('the latitude ring and the belt are labelled', () => {
  const ctx = fakeCtx()
  const draw = createOverlay(ctx)
  draw(scene(gmst(MS), 0))
  const words = texts(ctx)
  assert.ok(words.includes('EQ'))
  assert.ok(words.some((w) => /^\d+°N$/.test(w)))
  assert.ok(words.some((w) => /^\d+°S$/.test(w)))
  assert.ok(words.includes('0°'))
  assert.ok(words.some((w) => /^\d+°W$/.test(w)))
  assert.ok(words.some((w) => /^\d+°E$/.test(w)))
})

test('lines in the Earth frame are drawn on the near side only', () => {
  const ring = Array.from({ length: 37 }, (_, k) => [Math.cos(k * 0.1745), Math.sin(k * 0.1745), 0])
  const ctx = fakeCtx()
  createOverlay(ctx)(
    scene(gmst(MS), 0, { lines: [{ lines: [ring], style: 'coast', width: 1, alpha: 0.5 }] })
  )
  const first = ctx.calls.findIndex((c) => c.name === 'stroke')
  const before = ctx.calls.slice(0, first)
  const moves = before.filter((c) => c.name === 'moveTo').length
  const lineTos = before.filter((c) => c.name === 'lineTo').length
  // the equator breaks where it goes behind, so it is drawn in pieces, and
  // fewer than all of its points are on screen
  assert.ok(moves >= 1)
  assert.ok(moves + lineTos < ring.length)
  assert.equal(ctx.calls[first].alpha, 0.5)
  assert.equal(ctx.globalAlpha, 1)
})

test('labels that would collide are left out, the picked one kept', () => {
  const geo = byName('GOES-19')
  const s = facingSat(geo, { selected: geo })
  const ctx = fakeCtx()
  createOverlay(ctx)(s)
  const labelled = s.marks.filter((m) => m.label)
  assert.ok(s.marks[geo].label, 'the picked satellite keeps its label')
  assert.ok(labelled.length < s.marks.filter((m) => !m.hidden).length, 'some labels give way')
  for (const m of s.marks) if (m.hidden && m.index !== geo) assert.equal(m.label, null)
})

test('a picked polar imager shows its track, plumb line, and view', () => {
  const leo = byName('Terra')
  for (const look of [0, 1]) {
    const s = facingSat(leo, { selected: leo, look })
    const ctx = fakeCtx()
    createOverlay(ctx)(s)
    // the track and plumb line dash where they pass behind the Earth
    assert.ok(of(ctx, 'stroke').some((c) => c.stroke === 'track' && c.dash?.[0] === 2))
    // the cone from the satellite to the edge of its view
    const cone = of(ctx, 'stroke').filter(
      (c) => c.stroke === 'leo' && c.alpha === (look ? 0.16 : 0.4)
    )
    assert.equal(cone.length, 1)
  }
})

test('a picked satellite on the far side shows no view cone', () => {
  const geo = byName('Himawari-9')
  const r = position(SATS[geo].el, MS)
  const s = scene(Math.atan2(r[1], r[0]) + Math.PI, 0, { selected: geo })
  assert.ok(s.marks[geo].hidden)
  const ctx = fakeCtx()
  createOverlay(ctx)(s)
  assert.ok(!of(ctx, 'stroke').some((c) => c.stroke === 'geo' && c.alpha === 0.4))
  // drawn faint behind the Earth, still labelled
  assert.ok(of(ctx, 'fill').some((c) => c.alpha === 0.3))
  assert.ok(s.marks[geo].label)
})

test('a leader runs to the card when there is room for one', () => {
  const geo = byName('GOES-19')
  const s = facingSat(geo, { selected: geo })
  const m = s.marks[geo]
  const draw = (box) => {
    const ctx = fakeCtx()
    createOverlay(ctx)({ ...s, box })
    return of(ctx, 'stroke').filter((c) => c.dash?.[0] === 2 && c.dash[1] === 3)
  }
  // a card off to the right, level with the satellite, and one below it
  assert.equal(
    draw({ left: m.x + 100, right: m.x + 300, top: m.y - 50, bottom: m.y + 50 }).length,
    1
  )
  assert.equal(
    draw({ left: m.x - 100, right: m.x + 100, top: m.y + 80, bottom: m.y + 200 }).length,
    1
  )
  // a card off to the right and lower takes a 45° leg first
  const legged = draw({ left: m.x + 100, right: m.x + 300, top: m.y + 30, bottom: m.y + 200 })
  assert.equal(legged.length, 1)
  // a polar imager's leader takes its colour
  const leo = byName('Terra')
  const ls = facingSat(leo, { selected: leo })
  const lm = ls.marks[leo]
  const lctx = fakeCtx()
  createOverlay(lctx)({
    ...ls,
    box: { left: lm.x + 100, right: lm.x + 300, top: lm.y - 50, bottom: lm.y + 50 }
  })
  assert.ok(
    of(lctx, 'stroke').some((c) => c.stroke === 'leo' && c.dash?.[0] === 2 && c.dash[1] === 3)
  )
  // no card, or a card the satellite sits over
  assert.equal(draw(null).length, 0)
  assert.equal(draw({ left: m.x - 10, right: m.x + 10, top: m.y - 10, bottom: m.y + 10 }).length, 0)
  // no leader to a satellite behind the Earth
  const r = position(SATS[geo].el, MS)
  const away = scene(Math.atan2(r[1], r[0]) + Math.PI, 0, { selected: geo })
  const ctx = fakeCtx()
  createOverlay(ctx)({ ...away, box: { left: 700, right: 790, top: 10, bottom: 590 } })
  assert.ok(!of(ctx, 'stroke').some((c) => c.dash?.[0] === 2 && c.dash[1] === 3 && c.alpha === 0.6))
})

test('hover rings a satellite unless it is the picked one', () => {
  const geo = byName('GOES-19')
  const rings = (over) => {
    const ctx = fakeCtx()
    createOverlay(ctx)(facingSat(geo, over))
    return of(ctx, 'arc').filter((c) => c.args[2] === 14).length
  }
  assert.equal(rings({ hovered: geo }), 1)
  assert.equal(rings({ hovered: geo, selected: geo }), 0)
  // mono outlines the glyphs and dashes their heading
  const ctx = fakeCtx()
  createOverlay(ctx)(facingSat(geo, { look: 1 }))
  assert.ok(of(ctx, 'stroke').some((c) => c.dash?.[0] === 2 && c.dash[1] === 3))
})

test('the viewer is marked while their place faces the view', () => {
  const marked = (a) => {
    const ctx = fakeCtx()
    createOverlay(ctx)(scene(a, 45, { here: { lat: 45.5, lon: -122.7 } }))
    return of(ctx, 'arc').filter((c) => c.args[2] === 6).length
  }
  const portland = gmst(MS) - (122.7 * Math.PI) / 180
  assert.equal(marked(portland), 1)
  assert.equal(marked(portland + Math.PI), 0)
})

test('the cursor gets crosshairs and the place under it', () => {
  const ctx = fakeCtx()
  createOverlay(ctx)(scene(0, 0, { cursor: { x: 400, y: 300, text: '1.00°N  2.00°E' } }))
  assert.ok(of(ctx, 'arc').some((c) => c.args[0] === 400 && c.args[2] === 7))
  assert.ok(texts(ctx).includes('1.00°N  2.00°E'))
  assert.equal(ctx.letterSpacing, '0px')
})
