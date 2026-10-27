import { LAND } from './coast.js'
import { FRESH, GROUPS, groupUrl, pick, picture, wikiUrl } from './fleet.js'
import {
  elements,
  geodetic,
  gmst,
  length,
  period,
  position,
  RE,
  SCALES,
  scaled,
  speed,
  stationary,
  sun,
  track
} from './orbit.js'
import {
  ACTIONS,
  DISTANCE,
  DRAG,
  facing,
  fit,
  fling,
  hidden,
  hit,
  invert,
  KEYS,
  PICK_KEYS,
  pixels,
  project,
  RATE_KEYS,
  RATES,
  STEER,
  STILL,
  slow,
  toScreen,
  turn,
  ZOOM_KEYS,
  zoomBy
} from './view.js'

const THEME_KEY = 'satellites-bg'
const CACHE_KEY = 'satellites-gp'
const FRAME = 1000 / 60
// a drag let go faster than this many px per ms, over the last stretch of
// ms before release, keeps turning
const FLICK = 0.2
const FLICK_TAIL = 90
// px a press may wander and still count as a click
const CLICK = 6
// px from a satellite a click still picks it
const REACH = 18
const WHEEL = 0.0015
const PINCH = 0.01
// most px across the ray-cast globe before it is scaled up
const GLOBE_RES = 360
// ms between card and readout updates, slow enough to read
const READOUT_EVERY = 250
// ms to turn the view onto a picked satellite
const SWING = 700
// the most Himawari slots to step back through when the newest is missing
const BACK = 6
// steps along the plumb line
const PLUMB = 24
const RAD = Math.PI / 180
const GEO_KM = 42164
// the geostationary belt
const BELT = Array.from({ length: 145 }, (_, k) => [
  GEO_KM * Math.cos(k * 2.5 * RAD),
  GEO_KM * Math.sin(k * 2.5 * RAD),
  0
])

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const credits = document.getElementById('credits')
const picker = document.getElementById('pick')
const rates = document.getElementById('rate')
const themeColor = document.querySelector('meta[name="theme-color"]')
const buttons = Object.fromEntries(
  [...document.querySelectorAll('[data-action]')].map((el) => [el.dataset.action, el])
)
const $ = (id) => document.getElementById(id)
const readout = {
  time: $('readout-time'),
  rate: $('readout-rate'),
  count: $('readout-count'),
  note: $('readout-note')
}
const card = {
  root: $('card'),
  name: $('card-name'),
  by: $('card-by'),
  orbit: $('card-orbit'),
  alt: $('card-alt'),
  speed: $('card-speed'),
  below: $('card-below'),
  link: $('card-link'),
  img: $('card-img'),
  caption: $('card-caption'),
  wiki: $('card-wiki')
}

let sats = []
let selected = -1
let sim = Date.now()
let rate = 0
let paused = false
let scale = 'compressed'
let zoom = 1
// opens on the morning side, the terminator in view
const toSun = sun(sim)
let orientation = facing(Math.atan2(toSun[1], toSun[0]) - 45 * RAD, 20)
let spin = STILL
let swing = null
let width = 0
let height = 0
let ink = {}
// screen positions from the last frame, for clicks
let marks = []
const held = new Set()
const pointers = new Map()
let span = 0
let press = null

const globe = document.createElement('canvas')
const globeCtx = globe.getContext('2d')

// coastlines and graticule as unit vectors in the Earth's own frame, turned
// into the inertial frame each frame by sidereal time
const unitAt = (lat, lon) => {
  const c = Math.cos(lat * RAD)
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)]
}
// a ring's edge runs along the map's seam and down to the South Pole where
// it wraps Antarctica, which is no coastline, so lines break there
const seam = (lon, lat) => Math.abs(lon) > 179.9 || lat < -89.9
const coast = LAND.flatMap((ring) => {
  const lines = [[]]
  for (let k = 0; k < ring.length; k += 2) {
    const [lon, lat] = [ring[k], ring[k + 1]]
    const prev = k ? [ring[k - 2], ring[k - 1]] : null
    if (prev && seam(lon, lat) && seam(...prev)) lines.push([])
    lines.at(-1).push(unitAt(lat, lon))
  }
  return lines.filter((line) => line.length > 1)
})

// land as a lat, lon raster the globe's pixels look up, painted once
const MASK_W = 1024
const MASK_H = 512
const mask = (() => {
  const c = document.createElement('canvas')
  c.width = MASK_W
  c.height = MASK_H
  const g = c.getContext('2d')
  g.beginPath()
  for (const ring of LAND) {
    for (let k = 0; k < ring.length; k += 2) {
      const x = ((ring[k] + 180) / 360) * MASK_W
      const y = ((90 - ring[k + 1]) / 180) * MASK_H
      if (k) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.closePath()
  }
  g.fillStyle = '#fff'
  g.fill('evenodd')
  const { data } = g.getImageData(0, 0, MASK_W, MASK_H)
  const out = new Uint8Array(MASK_W * MASK_H)
  for (let k = 0; k < out.length; k++) out[k] = data[k * 4 + 3] > 127 ? 1 : 0
  return out
})()
const graticule = [
  ...[-60, -30, 0, 30, 60].map((lat) =>
    Array.from({ length: 73 }, (_, k) => unitAt(lat, k * 5 - 180))
  ),
  ...Array.from({ length: 12 }, (_, m) =>
    Array.from({ length: 35 }, (_, k) => unitAt(k * 5 - 85, m * 30 - 180))
  )
]

// on a phone the card sits over the lower half, so the globe takes the space
// above it
const narrow = matchMedia('(max-width: 600px)')

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.style.height =
    narrow.matches && !card.root.hidden ? `${card.root.getBoundingClientRect().top}px` : ''
  width = canvas.clientWidth
  height = canvas.clientHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const view = () => zoom * fit(SCALES[scale](GEO_KM) * 1.05)

// the Earth's frame to the screen at sidereal angle g
function spun([x, y, z], g) {
  const c = Math.cos(g)
  const s = Math.sin(g)
  return toScreen(orientation, [x * c - y * s, x * s + y * c, z])
}

// Lit sphere, ray-cast per pixel at low resolution and scaled up, land and
// sea looked up from the mask. Night fades in across the terminator rather
// than cutting.
function drawGlobe(z, light, g) {
  const r = pixels(width, height, z)
  const limb = (r * DISTANCE) / Math.sqrt(DISTANCE ** 2 - 1)
  const side = Math.min(GLOBE_RES, Math.ceil(2 * limb))
  if (globe.width !== side) {
    globe.width = side
    globe.height = side
  }
  const image = globeCtx.createImageData(side, side)
  const px = (2 * limb) / side
  const [c0, c1, c2] = invert(orientation, g)
  const tones = [
    [ink.ocean, ink.oceanNight],
    [ink.land, ink.landNight]
  ]
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const p = hit(((i + 0.5) * px - limb) / r, ((j + 0.5) * px - limb) / r)
      if (!p) continue
      const ex = p[0] * c0[0] + p[1] * c1[0] + p[2] * c2[0]
      const ey = p[0] * c0[1] + p[1] * c1[1] + p[2] * c2[1]
      const ez = p[0] * c0[2] + p[1] * c1[2] + p[2] * c2[2]
      const mx = Math.floor(((Math.atan2(ey, ex) / Math.PI + 1) / 2) * MASK_W) % MASK_W
      const my = Math.min(MASK_H - 1, Math.floor((0.5 - Math.asin(ez) / Math.PI) * MASK_H))
      const [day, night] = tones[mask[my * MASK_W + mx]]
      const lit = p[0] * light[0] + p[1] * light[1] + p[2] * light[2]
      const t = Math.min(1, Math.max(0, (lit + 0.08) / 0.3))
      // limb darkening, so the ball reads as round
      const rim = 0.75 + 0.25 * -p[2]
      const o = (j * side + i) * 4
      image.data[o] = (night[0] + (day[0] - night[0]) * t) * rim
      image.data[o + 1] = (night[1] + (day[1] - night[1]) * t) * rim
      image.data[o + 2] = (night[2] + (day[2] - night[2]) * t) * rim
      image.data[o + 3] = 255
    }
  }
  globeCtx.putImageData(image, 0, 0)
  // a thin glow of air past the limb
  const air = ctx.createRadialGradient(
    width / 2,
    height / 2,
    limb,
    width / 2,
    height / 2,
    limb * 1.08
  )
  air.addColorStop(0, `rgb(${ink.air} / 0.35)`)
  air.addColorStop(1, `rgb(${ink.air} / 0)`)
  ctx.fillStyle = air
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, limb * 1.08, 0, 2 * Math.PI)
  ctx.fill()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(globe, width / 2 - limb, height / 2 - limb, 2 * limb, 2 * limb)
}

// lines on the near side of the globe, broken where they pass behind it
function drawLines(lines, g, z, style, lineWidth) {
  ctx.strokeStyle = style
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (const line of lines) {
    let down = false
    for (const v of line) {
      const p = spun(v, g)
      if (p[2] > -1 / DISTANCE) {
        down = false
        continue
      }
      const [x, y] = project(p, width, height, z)
      if (down) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      down = true
    }
  }
  ctx.stroke()
}

// a path through space, solid in front of the Earth and dashed behind it,
// or only the front part
function drawPath(points, z, style, behind = true) {
  const screen = points.map((v) => toScreen(orientation, scaled(v, scale)))
  ctx.strokeStyle = style
  ctx.lineWidth = 1
  for (const back of behind ? [true, false] : [false]) {
    ctx.setLineDash(back ? [2, 4] : [])
    ctx.globalAlpha = back ? 0.5 : 1
    ctx.beginPath()
    let down = false
    for (const p of screen) {
      if (hidden(p) !== back) {
        down = false
        continue
      }
      const [x, y] = project(p, width, height, z)
      if (down) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      down = true
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

// Those behind the Earth are left out, unless picked. A label that would
// overlap one already placed is skipped, the picked one placed first.
function drawSats() {
  ctx.font = `10px ${ink.mono}`
  ctx.textBaseline = 'middle'
  const placed = []
  const order = [...marks].sort((a, b) => (b.index === selected) - (a.index === selected))
  for (const m of order) {
    if (m.hidden && m.index !== selected) continue
    const sat = sats[m.index]
    const on = m.index === selected
    const color = sat.geo ? ink.geo : ink.leo
    ctx.globalAlpha = m.hidden ? 0.3 : 1
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(m.x, m.y, on ? 4 : 2.5, 0, 2 * Math.PI)
    ctx.fill()
    if (on) {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(m.x, m.y, 9, 0, 2 * Math.PI)
      ctx.stroke()
    }
    const x = m.x + (on ? 13 : 6)
    const label = [x - 2, m.y - 7, x + ctx.measureText(sat.name).width + 2, m.y + 7]
    if (
      placed.some((o) => label[0] < o[2] && o[0] < label[2] && label[1] < o[3] && o[1] < label[3])
    ) {
      continue
    }
    placed.push(label)
    ctx.fillStyle = on ? ink.fg : ink.dim
    ctx.fillText(sat.name, x, m.y)
  }
  ctx.globalAlpha = 1
}

function draw() {
  ctx.clearRect(0, 0, width, height)
  const z = view()
  const g = gmst(sim)
  const light = toScreen(orientation, sun(sim))
  marks = sats.map((sat, index) => {
    const p = toScreen(orientation, scaled(position(sat.el, sim), scale))
    const [x, y] = project(p, width, height, z)
    return { index, x, y, hidden: hidden(p) }
  })
  drawGlobe(z, light, g)
  drawLines(graticule, g, z, ink.grid, 1)
  drawLines(coast, g, z, ink.coast, 0.8)
  drawPath(BELT, z, ink.grid, false)
  if (selected >= 0) {
    const sat = sats[selected]
    if (!sat.geo) drawPath(track(sat.el, sim - period(sat.el) * 30000), z, ink.track)
    // a plumb line from the satellite down to the ground below it, in steps
    // so it can pass behind the limb partway
    const r = position(sat.el, sim)
    const ground = RE / length(r)
    drawPath(
      Array.from({ length: PLUMB + 1 }, (_, k) => {
        const f = 1 + ((ground - 1) * k) / PLUMB
        return r.map((c) => c * f)
      }),
      z,
      ink.track
    )
  }
  drawSats()
}

const fmt = (n, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const ns = (lat) => `${fmt(Math.abs(lat), 2)}° ${lat < -0.005 ? 'S' : 'N'}`
const ew = (lon) => `${fmt(Math.abs(lon), 2)}° ${lon < -0.005 ? 'W' : 'E'}`

function showReadout() {
  readout.time.textContent = `${new Date(sim).toISOString().slice(0, 19).replace('T', ' ')} UTC`
  const behind = Math.round((Date.now() - sim) / 60000)
  readout.rate.textContent = paused
    ? 'paused'
    : `${RATES[rate]}× ${Math.abs(behind) < 2 ? 'now' : behind > 0 ? `${fmt(behind)} min behind` : `${fmt(-behind)} min ahead`}`
  if (sats.length) readout.count.textContent = `${sats.length} satellites, ${scale} scale`
  if (selected < 0) return
  const sat = sats[selected]
  const r = position(sat.el, sim)
  const ground = geodetic(r, sim)
  card.alt.textContent = `${fmt(ground.alt)} km`
  card.speed.textContent = `${fmt(speed(sat.el, length(r)), 2)} km/s`
  card.below.textContent = `${ns(ground.lat)}, ${ew(ground.lon)}`
  card.orbit.textContent = sat.geo
    ? `geostationary, ${ew(ground.lon)}`
    : `polar, ${fmt(sat.omm.INCLINATION, 1)}°, ${fmt(period(sat.el))} min`
}

function showPicture(sat, back = 0) {
  const ground = geodetic(position(sat.el, sim), sim)
  const { src, href, caption, steps } = picture(sat, ground, Date.now(), back)
  card.link.href = href
  card.caption.textContent = caption
  card.img.hidden = !src
  card.img.alt = src ? `${sat.name} imagery` : ''
  card.img.dataset.back = steps ? String(back) : ''
  if (src) card.img.src = src
  else card.img.removeAttribute('src')
}

card.img.addEventListener('error', () => {
  const sat = sats[selected]
  const back = Number(card.img.dataset.back) + 1
  if (sat && card.img.dataset.back && back <= BACK) showPicture(sat, back)
  else card.img.hidden = true
})

// spherical interpolation, the short way round
function slerp(a, b, t) {
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

function select(index, center) {
  selected = index
  picker.value = index < 0 ? '' : String(index)
  const shown = !card.root.hidden
  card.root.hidden = index < 0
  if (shown !== index >= 0) resize()
  if (index < 0) return
  const sat = sats[index]
  card.name.textContent = sat.name
  card.by.textContent = sat.by
  card.wiki.href = wikiUrl(sat)
  card.wiki.textContent = `${decodeURIComponent(sat.wiki).replaceAll('_', ' ')} on Wikipedia`
  showPicture(sat)
  showReadout()
  if (center) {
    const r = position(sat.el, sim)
    const lat = Math.asin(r[2] / length(r)) / RAD
    // from a little above, so the belt shows as a ring
    swing = {
      from: orientation,
      to: facing(Math.atan2(r[1], r[0]), lat + 15),
      start: performance.now()
    }
  }
}

function step(index, by) {
  const n = sats.length
  if (!n) return
  select(index < 0 ? (by > 0 ? 0 : n - 1) : (index + by + n) % n, true)
}

function setRate(index) {
  rate = Math.min(RATES.length - 1, Math.max(0, index))
  rates.value = String(rate)
  showReadout()
}

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

const rgb = (s) => s.split(/\s+/).map(Number)

function setTheme(theme, save) {
  document.documentElement.dataset.theme = theme
  buttons.light.setAttribute('aria-pressed', String(theme === 'light'))
  const style = getComputedStyle(document.documentElement)
  const token = (name) => style.getPropertyValue(name).trim()
  themeColor.content = token('--bg')
  ink = {
    fg: token('--fg'),
    dim: token('--dim'),
    ocean: rgb(token('--ocean')),
    oceanNight: rgb(token('--ocean-night')),
    land: rgb(token('--land')),
    landNight: rgb(token('--land-night')),
    air: token('--air'),
    coast: token('--coast'),
    grid: token('--grid'),
    geo: token('--geo'),
    leo: token('--leo'),
    track: token('--track'),
    mono: token('--mono')
  }
  if (!save) return
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {}
}

const actions = {
  pause() {
    paused = !paused
    buttons.pause.setAttribute('aria-pressed', String(paused))
    showReadout()
  },
  now() {
    sim = Date.now()
    showReadout()
  },
  scale() {
    scale = scale === 'true' ? 'compressed' : 'true'
    buttons.scale.setAttribute('aria-pressed', String(scale === 'true'))
    showReadout()
  },
  light() {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true)
  },
  info() {
    credits.togglePopover()
  },
  deselect() {
    select(-1)
  }
}

for (const [name, el] of Object.entries(buttons)) el.addEventListener('click', actions[name])

picker.addEventListener('change', () => {
  select(picker.value === '' ? -1 : Number(picker.value), true)
  picker.blur()
})
rates.addEventListener('change', () => {
  setRate(Number(rates.value))
  rates.blur()
})

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target instanceof HTMLSelectElement) return
  const { code } = event
  if (KEYS[code]) {
    held.add(code)
    swing = null
  } else if (ZOOM_KEYS[code]) zoom = zoomBy(zoom, ZOOM_KEYS[code])
  else if (PICK_KEYS[code]) step(selected, PICK_KEYS[code])
  else if (RATE_KEYS[code]) setRate(rate + RATE_KEYS[code])
  else if (ACTIONS[code]) {
    if (code === 'Escape' && credits.matches(':popover-open')) return
    actions[ACTIONS[code]]()
  } else return
  event.preventDefault()
})
addEventListener('keyup', (event) => held.delete(event.code))
addEventListener('blur', () => held.clear())

function nearest(x, y) {
  let best = -1
  let gap = REACH
  for (const m of marks) {
    const d = Math.hypot(m.x - x, m.y - y)
    if (d < gap && (!m.hidden || m.index === selected)) {
      gap = d
      best = m.index
    }
  }
  return best
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  spin = STILL
  swing = null
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    span = Math.hypot(a.x - b.x, a.y - b.y)
    press = null
  } else {
    press = { x: event.clientX, y: event.clientY, moved: false, trail: [] }
  }
})

canvas.addEventListener('pointermove', (event) => {
  const last = pointers.get(event.pointerId)
  if (!last) {
    canvas.classList.toggle('over', nearest(event.clientX, event.clientY) >= 0)
    return
  }
  const dx = event.clientX - last.x
  const dy = event.clientY - last.y
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const next = Math.hypot(a.x - b.x, a.y - b.y)
    if (span) zoom = zoomBy(zoom, next / span)
    span = next
    return
  }
  if (!press) return
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK) press.moved = true
  orientation = turn(orientation, dy * DRAG, -dx * DRAG)
  const now = performance.now()
  press.trail.push({ x: event.clientX, y: event.clientY, at: now })
  while (press.trail.length && now - press.trail[0].at > FLICK_TAIL) press.trail.shift()
})

function release(event) {
  if (!pointers.delete(event.pointerId)) return
  span = 0
  if (!press) return
  if (!press.moved) {
    const index = nearest(event.clientX, event.clientY)
    if (index >= 0 || selected >= 0) select(index, false)
  } else if (press.trail.length > 1) {
    const first = press.trail[0]
    const last = press.trail.at(-1)
    const ms = last.at - first.at
    const dx = last.x - first.x
    const dy = last.y - first.y
    if (ms > 0 && Math.hypot(dx, dy) / ms > FLICK) spin = fling(dx, dy, ms)
  }
  press = null
}
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', release)

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    zoom = zoomBy(zoom, Math.exp(-event.deltaY * (event.ctrlKey ? PINCH : WHEEL)))
  },
  { passive: false }
)

let lastFrame = performance.now()
let lastReadout = 0

function frame(now) {
  const ms = Math.min(100, now - lastFrame)
  lastFrame = now
  if (!paused) sim += ms * RATES[rate]
  const turns = [...held].reduce(
    (sum, code) => sum.map((c, i) => c + KEYS[code][i] * STEER * (ms / FRAME)),
    [0, 0, 0]
  )
  if (turns.some(Boolean)) orientation = turn(orientation, ...turns)
  if (spin !== STILL) {
    orientation = turn(orientation, ...spin.map((c) => c * (ms / FRAME)))
    spin = slow(spin, ms)
  }
  if (swing) {
    const t = Math.min(1, (now - swing.start) / SWING)
    const eased = 1 - (1 - t) ** 3
    orientation = slerp(swing.from, swing.to, eased)
    if (t === 1) swing = null
  }
  draw()
  if (now - lastReadout > READOUT_EVERY) {
    lastReadout = now
    showReadout()
  }
  requestAnimationFrame(frame)
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY))
  } catch {
    return null
  }
}

async function load() {
  const cached = readCache()
  let groups = cached && Date.now() - cached.at < FRESH ? cached.groups : null
  if (!groups) {
    try {
      groups = await Promise.all(
        GROUPS.map(async (group) => {
          const res = await fetch(groupUrl(group))
          if (!res.ok) throw new Error(`${res.status}`)
          return res.json()
        })
      )
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), groups }))
      } catch {}
    } catch {
      groups = cached?.groups
      readout.note.textContent = groups
        ? 'CelesTrak unreachable, using older elements'
        : 'CelesTrak unreachable, no elements to show'
    }
  }
  if (!groups) return
  sats = pick(groups).map((sat) => {
    const el = elements(sat.omm)
    return { ...sat, el, geo: stationary(el) }
  })
  for (const [index, sat] of sats.entries()) picker.add(new Option(sat.name, String(index)))
  showReadout()
}

for (const [index, r] of RATES.entries()) {
  rates.add(new Option(r === 1 ? 'real time' : `${r}× speed`, String(index)))
}
setTheme(readTheme() ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
addEventListener('resize', resize)
resize()
setRate(0)
load()
requestAnimationFrame(frame)
