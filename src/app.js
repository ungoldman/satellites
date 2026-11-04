import { LAND } from './coast.js'
import { fresh, pick, picture, STALE, snapshot, TRUSTED, wikiUrl } from './fleet.js'
import { createGlobe } from './globe.js'
import {
  elements,
  geodetic,
  gmst,
  horizon,
  length,
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
} from './orbit.js'
import { DETAIL_PX, loadTerrain, PHONE_ZOOM, TERRAIN_ZOOM } from './terrain.js'
import { away, gap as gapWords, midnights, SPEEDS, share, utc, WEEK, within } from './time.js'
import {
  ACTIONS,
  contourStep,
  DISTANCE,
  DRAG,
  facing,
  fit,
  fling,
  grip as gripFor,
  ground,
  hidden,
  hit,
  invert,
  KEYS,
  keep,
  LIMB,
  multiply,
  PICK_KEYS,
  parallels,
  pixels,
  project,
  RATE_KEYS,
  RATES,
  STEER,
  STILL,
  slow,
  spinBy,
  steer,
  TIME_KEYS,
  toScreen,
  unkeep,
  ZOOM_KEYS,
  zoomBy
} from './view.js'

const THEME_KEY = 'satellites-bg'
const STYLE_KEY = 'satellites-style'
// the view, zoom, time, and pick, kept across reloads
const VIEW_KEY = 'satellites-view'
const HOME_ZOOM = 1.2
const CACHE_KEY = 'satellites-gp'
const FRAME = 1000 / 60
// a drag let go faster than this many px per ms, over the last stretch of
// ms before release, keeps turning
const FLICK = 0.2
const FLICK_TAIL = 90
// px a press may wander and still count as a click
const CLICK = 6
// px from a satellite a press still picks it, more for a finger
const REACH = 24
const REACH_TOUCH = 32
const WHEEL = 0.0015
const PINCH = 0.01
// most px across the canvas globe, where WebGL2 is missing, before it is
// scaled up
const GLOBE_RES = 360
// ms between card and readout updates, slow enough to read
const READOUT_EVERY = 250
// ms to turn the view onto a picked satellite
const SWING = 700
// the most slots to step back through when the newest picture is missing
const BACK = 6
// steps along the plumb line
const PLUMB = 24
// samples in each trail
const TRAIL = 20
const RAD = Math.PI / 180
const GEO_KM = 42164
// the geostationary belt
const BELT = Array.from({ length: 145 }, (_, k) => [
  GEO_KM * Math.cos(k * 2.5 * RAD),
  GEO_KM * Math.sin(k * 2.5 * RAD),
  0
])

export function mount() {
  const teardown = new AbortController()
  const on = (type, listener) => addEventListener(type, listener, { signal: teardown.signal })
  // 0 colour, 1 mono
  let LOOK = 0
  const canvas = document.getElementById('canvas')
  const globeCanvas = document.getElementById('globe')
  const ctx = canvas.getContext('2d')
  const credits = document.getElementById('credits')
  const speeds = document.getElementById('speeds')
  const scrub = document.getElementById('scrub')
  const days = document.getElementById('days')
  const gap = document.getElementById('gap')
  const styles = document.getElementById('styles')
  const timebar = document.getElementById('timebar')
  const staleNote = document.getElementById('stale')
  const roster = document.getElementById('roster')
  const themeColor = document.querySelector('meta[name="theme-color"]')
  const buttons = Object.fromEntries(
    [...document.querySelectorAll('[data-action]:not([inert] *)')].map((el) => [
      el.dataset.action,
      el
    ])
  )
  const $ = (id) => document.getElementById(id)
  const readout = {
    time: $('readout-time'),
    rate: $('readout-rate'),
    count: $('readout-count'),
    cursor: $('readout-cursor'),
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
    sun: $('card-sun'),
    link: $('card-link'),
    img: $('card-img'),
    caption: $('card-caption'),
    wiki: $('card-wiki')
  }

  let sats = []
  let rows = []
  let selected = -1
  let sim = Date.now()
  let rate = 0
  let paused = false
  let scale = 'compressed'
  let zoom = HOME_ZOOM
  // the prime meridian, 20° north
  const homeView = () => facing(gmst(sim), 20)
  let orientation = homeView()
  let spin = STILL
  let swing = null
  let width = 0
  let height = 0
  let dpr = 1
  let ink = {}
  let marks = []
  let cursor = null
  let hovered = -1
  // where the viewer is, once they share it
  let here = null
  // the time of the data, when the only data there is is too old to trust
  let locked = null
  const held = new Set()
  const pointers = new Map()
  let span = 0
  let press = null

  const globe = document.createElement('canvas')
  const globeCtx = globe.getContext('2d')

  // coastlines and graticule as unit vectors in the Earth's own frame, turned
  // into the inertial frame each frame by sidereal time
  // a ring's edge runs along the map's seam and down to the South Pole where
  // it wraps Antarctica, which is no coastline, so lines break there
  const seam = (lon, lat) => Math.abs(lon) > 179.9 || lat < -89.9
  const coast = LAND.flatMap((ring) => {
    const lines = [[]]
    for (let k = 0; k < ring.length; k += 2) {
      const [lon, lat] = [ring[k], ring[k + 1]]
      const prev = k ? [ring[k - 2], ring[k - 1]] : null
      if (prev && seam(lon, lat) && seam(...prev)) lines.push([])
      lines.at(-1).push(toward(lat, lon))
    }
    return lines.filter((line) => line.length > 1)
  })

  const MASK_W = 1024
  const MASK_H = 512
  // land as a lat, lon raster, for the shader and the canvas globe
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
      Array.from({ length: 73 }, (_, k) => toward(lat, k * 5 - 180))
    ),
    ...Array.from({ length: 12 }, (_, m) =>
      Array.from({ length: 35 }, (_, k) => toward(k * 5 - 85, m * 30 - 180))
    )
  ]

  // the shader globe, or the slower canvas one where WebGL2 is missing
  let gl = null
  try {
    gl = createGlobe(globeCanvas, mask, MASK_W, MASK_H)
  } catch (err) {
    console.error(err)
  }
  // heights at zoom 2 for everyone, then zoom 3 once the globe is drawn large
  // enough to show it, never on a phone. A level only replaces a coarser one.
  const phone = matchMedia('(max-width: 600px)').matches
  let terrainLevel = 0
  let detailAsked = phone
  function terrainAt(level) {
    loadTerrain(teardown.signal, level)
      .then((t) => {
        if (level <= terrainLevel) return
        terrainLevel = level
        gl.terrain(t)
      })
      .catch(() => {})
  }
  if (gl) terrainAt(PHONE_ZOOM)

  const narrow = matchMedia('(max-width: 600px)')

  // where the canvases start down the page, so DOM boxes can be drawn against
  // them
  let canvasTop = 0

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1)
    // on a phone the globe sits between the header, or the count under it,
    // and the card, or the time bar while nothing is picked
    canvasTop = 0
    let h = ''
    if (narrow.matches) {
      const above = [$('controls').closest('header'), $('readout')]
      canvasTop = Math.max(...above.map((e) => e.getBoundingClientRect().bottom))
      const below = card.root.hidden ? $('timebar') : card.root
      h = `${below.getBoundingClientRect().top - canvasTop}px`
    }
    for (const c of [canvas, globeCanvas]) {
      c.style.top = canvasTop ? `${canvasTop}px` : ''
      c.style.height = h
    }
    width = canvas.clientWidth
    height = canvas.clientHeight
    for (const c of [canvas, globeCanvas]) {
      c.width = width * dpr
      c.height = height * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const view = () => zoom * fit(SCALES[scale](GEO_KM) * 1.05)

  function spun([x, y, z], g) {
    const c = Math.cos(g)
    const s = Math.sin(g)
    return toScreen(orientation, [x * c - y * s, x * s + y * c, z])
  }

  // a point in the inertial frame on screen, and whether the Earth hides it
  function at(v, z) {
    const p = toScreen(orientation, scaled(v, scale))
    const [x, y] = project(p, width, height, z)
    return { x, y, hidden: hidden(p) }
  }

  // px from the center to the edge of the globe
  const limbOf = (z) => pixels(width, height, z) * LIMB

  // Where WebGL2 is missing: the globe ray-cast per pixel at low resolution
  // and scaled up, land from the mask, lit by the Sun.
  function drawGlobe(z, light, g) {
    const r = pixels(width, height, z)
    const limb = limbOf(z)
    const side = Math.min(GLOBE_RES, Math.ceil(2 * limb))
    if (globe.width !== side) {
      globe.width = side
      globe.height = side
    }
    const image = globeCtx.createImageData(side, side)
    const px = (2 * limb) / side
    const [c0, c1, c2] = invert(orientation, g)
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const p = hit(((i + 0.5) * px - limb) / r, ((j + 0.5) * px - limb) / r)
        if (!p) continue
        const ex = p[0] * c0[0] + p[1] * c1[0] + p[2] * c2[0]
        const ey = p[0] * c0[1] + p[1] * c1[1] + p[2] * c2[1]
        const ez = p[0] * c0[2] + p[1] * c1[2] + p[2] * c2[2]
        const mx = Math.floor(((Math.atan2(ey, ex) / Math.PI + 1) / 2) * MASK_W) % MASK_W
        const my = Math.min(MASK_H - 1, Math.floor((0.5 - Math.asin(ez) / Math.PI) * MASK_H))
        const lit = p[0] * light[0] + p[1] * light[1] + p[2] * light[2]
        const t = Math.min(1, Math.max(0, (lit + 0.08) / 0.3))
        const a = (mask[my * MASK_W + mx] ? 0.2 : 0.07) * (0.4 + 0.6 * t)
        const o = (j * side + i) * 4
        for (let k = 0; k < 3; k++)
          image.data[o + k] = 255 * (ink.bg[k] + (ink.fg3[k] - ink.bg[k]) * a)
        image.data[o + 3] = 255
      }
    }
    globeCtx.putImageData(image, 0, 0)
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
  function drawPath(points, z, style, behind = true, dash = []) {
    const screen = points.map((v) => toScreen(orientation, scaled(v, scale)))
    ctx.strokeStyle = style
    ctx.lineWidth = 1
    for (const back of behind ? [true, false] : [false]) {
      ctx.setLineDash(back ? [2, 4] : dash)
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

  const lonLabel = (lon) =>
    lon === 0 || lon === 180 ? `${lon}°` : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`

  // the geostationary belt as a dial of longitude, turning with the Earth
  function drawBelt(z, g) {
    drawPath(BELT, z, ink.belt, false)
    ctx.font = `9px ${ink.mono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.letterSpacing = '0.12em'
    for (let k = 0; k < 36; k++) {
      const lon = k * 10 - 180
      const a = lon * RAD + g
      const u = [Math.cos(a), Math.sin(a), 0]
      const major = k % 3 === 0
      const from = at(
        u.map((c) => c * GEO_KM * 0.985),
        z
      )
      const to = at(
        u.map((c) => c * GEO_KM * (major ? 1.045 : 1.02)),
        z
      )
      if (from.hidden) continue
      ctx.strokeStyle = major ? ink.tick : ink.belt
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      if (!major) continue
      const l = at(
        u.map((c) => c * GEO_KM * 1.1),
        z
      )
      ctx.fillStyle = ink.faint
      ctx.fillText(lonLabel(lon), l.x, l.y)
    }
    ctx.textAlign = 'start'
    ctx.letterSpacing = '0px'
  }

  function drawLimb(z) {
    ctx.strokeStyle = ink.limb
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, limbOf(z), 0, 2 * Math.PI)
    ctx.stroke()
  }

  // a ring round the Earth that reads latitude where it meets the edge
  function drawBezel(z, g) {
    const cx = width / 2
    const cy = height / 2
    const r = limbOf(z) * 1.14 + 6
    ctx.lineWidth = 1
    ctx.strokeStyle = ink.belt
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.font = `9px ${ink.mono}`
    ctx.letterSpacing = '0.12em'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // a tick every 10°, a label every 30°, longitude being on the belt
    for (const { v, angles, fade } of parallels(orientation, g)) {
      ctx.globalAlpha = fade
      ctx.strokeStyle = ink.tick
      ctx.fillStyle = ink.faint
      const major = v % 30 === 0
      ctx.beginPath()
      for (const a of angles) {
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        ctx.lineTo(
          cx + Math.cos(a) * (r + (major ? 9 : 4)),
          cy + Math.sin(a) * (r + (major ? 9 : 4))
        )
      }
      ctx.stroke()
      if (!major) continue
      const text = v === 0 ? 'EQ' : `${Math.abs(v)}°${v > 0 ? 'N' : 'S'}`
      for (const a of angles)
        ctx.fillText(text, cx + Math.cos(a) * (r + 22), cy + Math.sin(a) * (r + 22))
    }
    ctx.globalAlpha = 1
    ctx.textAlign = 'start'
    ctx.letterSpacing = '0px'
  }

  // where each satellite has just been, fading out behind it
  function drawTrails(z) {
    for (const m of marks) {
      if (m.hidden) continue
      const sat = sats[m.index]
      // geostationary ones turn with the Earth, so a shorter tail keeps it off
      // the globe
      const reach = (period(sat.el) * 60000) / (sat.geo ? 48 : 12)
      let prev = m
      ctx.strokeStyle = sat.geo ? ink.geo : ink.leo
      ctx.lineWidth = m.index === selected ? 1.5 : 1
      for (let k = 1; k <= TRAIL; k++) {
        const p = at(position(sat.el, sim - (reach * k) / TRAIL), z)
        if (p.hidden) break
        ctx.globalAlpha = 0.55 * (1 - k / TRAIL)
        ctx.beginPath()
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        prev = p
      }
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
  }

  // a craft drawn along its heading: a chevron for the polar imagers, a body
  // with solar wings for geostationary
  function glyph(m, sat, on, hover) {
    const color = sat.geo ? ink.geo : ink.leo
    if (hover && !on) {
      ctx.save()
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.globalAlpha *= 0.14
      ctx.beginPath()
      ctx.arc(m.x, m.y, 14, 0, 2 * Math.PI)
      ctx.fill()
      ctx.globalAlpha /= 0.14 / 0.8
      ctx.stroke()
      ctx.restore()
    }
    const k = on ? 1.4 : 1
    ctx.save()
    ctx.translate(m.x, m.y)
    ctx.rotate(m.heading)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    if (sat.geo) {
      ctx.rect(-2.5 * k, -2.5 * k, 5 * k, 5 * k)
      ctx.rect(-1.5 * k, -10 * k, 3 * k, 6 * k)
      ctx.rect(-1.5 * k, 4 * k, 3 * k, 6 * k)
    } else {
      ctx.moveTo(6 * k, 0)
      ctx.lineTo(-4 * k, 4 * k)
      ctx.lineTo(-1.5 * k, 0)
      ctx.lineTo(-4 * k, -4 * k)
      ctx.closePath()
    }
    if (LOOK) {
      ctx.fillStyle = ink.bgCss
      ctx.fill()
      ctx.stroke()
    } else ctx.fill()
    if (sat.geo) {
      ctx.beginPath()
      ctx.moveTo(0, -4 * k)
      ctx.lineTo(0, 4 * k)
      ctx.stroke()
    }
    // the way it is heading, as long as it is fast
    const ahead = (LOOK ? 5 : 4) * m.kms
    ctx.globalAlpha = on ? 0.8 : 0.35
    ctx.setLineDash(LOOK ? [2, 3] : [])
    ctx.beginPath()
    ctx.moveTo(8 * k, 0)
    ctx.lineTo(8 * k + ahead, 0)
    if (!LOOK) {
      ctx.moveTo(8 * k + ahead - 3, -2)
      ctx.lineTo(8 * k + ahead, 0)
      ctx.lineTo(8 * k + ahead - 3, 2)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    if (!on) return
    ctx.strokeStyle = color
    ctx.beginPath()
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ]) {
      ctx.moveTo(m.x + sx * 15, m.y + sy * 9)
      ctx.lineTo(m.x + sx * 15, m.y + sy * 15)
      ctx.lineTo(m.x + sx * 9, m.y + sy * 15)
    }
    ctx.stroke()
  }

  // A callout from the picked satellite to the card: a 45° leg, then straight
  // into the card's nearest edge. Drawn under the satellites and labels.
  function drawLeader() {
    if (selected < 0 || card.root.hidden) return
    const m = marks[selected]
    if (!m || m.hidden) return
    const r = card.root.getBoundingClientRect()
    const box = {
      left: r.left,
      right: r.right,
      top: r.top - canvasTop,
      bottom: r.bottom - canvasTop
    }
    const pad = 14
    let elbow
    let end
    if (m.x < box.left - 24) {
      const y = Math.min(box.bottom - pad, Math.max(box.top + pad, m.y))
      end = [box.left, y]
      elbow = [Math.min(m.x + Math.abs(y - m.y), box.left - 16), y]
    } else if (m.y < box.top - 24) {
      const x = Math.min(box.right - pad, Math.max(box.left + pad, m.x))
      end = [x, box.top]
      elbow = [x, Math.min(m.y + Math.abs(x - m.x), box.top - 16)]
    } else return
    const lead = Math.hypot(elbow[0] - m.x, elbow[1] - m.y) > 1 ? elbow : end
    const d = Math.hypot(lead[0] - m.x, lead[1] - m.y)
    if (d < 20) return
    const start = [m.x + ((lead[0] - m.x) / d) * 19, m.y + ((lead[1] - m.y) / d) * 19]
    const color = sats[selected].geo ? ink.geo : ink.leo
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.6
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(...start)
    if (lead === elbow) ctx.lineTo(...elbow)
    ctx.lineTo(...end)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.fillStyle = ink.bgCss
    ctx.beginPath()
    ctx.arc(end[0], end[1], 3, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
  }

  function drawSats() {
    ctx.font = `10px ${ink.mono}`
    ctx.textBaseline = 'middle'
    ctx.letterSpacing = '0.1em'
    const placed = []
    const rank = (m) => (m.index === selected ? 2 : m.index === hovered ? 1 : 0)
    const order = [...marks].sort((a, b) => rank(b) - rank(a))
    for (const m of order) {
      if (m.hidden && m.index !== selected) continue
      const sat = sats[m.index]
      const on = m.index === selected
      const hover = m.index === hovered
      m.label = null
      ctx.globalAlpha = m.hidden ? 0.3 : 1
      glyph(m, sat, on, hover)
      const name = sat.name.toUpperCase()
      const x = m.x + (on ? 20 : 11)
      const nw = ctx.measureText(name).width
      const vw = ctx.measureText(m.value).width
      const label = [x - 2, m.y - 7, x + nw + 8 + vw, m.y + 7]
      if (
        placed.some((o) => label[0] < o[2] && o[0] < label[2] && label[1] < o[3] && o[1] < label[3])
      ) {
        continue
      }
      placed.push(label)
      m.label = label
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4
      ctx.strokeStyle = ink.bgCss
      ctx.strokeText(name, x, m.y)
      ctx.strokeText(m.value, x + nw + 6, m.y)
      ctx.fillStyle = on || hover ? ink.fg : ink.dim
      ctx.fillText(name, x, m.y)
      ctx.fillStyle = ink.faint
      ctx.fillText(m.value, x + nw + 6, m.y)
      ctx.lineWidth = 1
    }
    ctx.globalAlpha = 1
    ctx.letterSpacing = '0px'
  }

  // the picked satellite's ground, the edge of what it sees, and the cone
  // from it to that edge
  function drawView(z, sat) {
    const r = position(sat.el, sim)
    const color = sat.geo ? ink.geo : ink.leo
    const rim = horizon(r)
    drawPath(rim, z, color, false, LOOK ? [3, 3] : [])
    const s = at(r, z)
    const below = at(
      r.map((c) => (c * RE) / length(r)),
      z
    )
    const d = [below.x - s.x, below.y - s.y]
    const front = rim.map((v) => at(v, z)).filter((p) => !p.hidden)
    if (!front.length) return
    ctx.strokeStyle = color
    ctx.beginPath()
    if (LOOK) {
      ctx.globalAlpha = 0.16
      for (let k = 0; k < front.length; k += 12) {
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(front[k].x, front[k].y)
      }
    } else {
      ctx.globalAlpha = 0.4
      const side = (p) =>
        (d[0] * (p.y - s.y) - d[1] * (p.x - s.x)) / Math.hypot(p.x - s.x, p.y - s.y)
      const sorted = [...front].sort((a, b) => side(a) - side(b))
      for (const p of [sorted[0], sorted.at(-1)]) {
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(p.x, p.y)
      }
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // degrees a pixel of drag turns at the current zoom
  const grip = () => gripFor(pixels(width, height, view()))

  // latitude and longitude under a screen point, or null off the globe
  const placeAt = (x, y) => {
    const r = pixels(width, height, view())
    return ground(orientation, gmst(sim), (x - width / 2) / r, (y - height / 2) / r)
  }

  // Steer, north up as the keys do, until place sits under x, y. A change in
  // longitude is exact, one in latitude only on the center's meridian, hence
  // the few rounds. False when x, y is off the globe.
  function pin(place, x, y) {
    for (let i = 0; i < 4; i++) {
      const now = placeAt(x, y)
      if (!now) return false
      const north = place.lat - now.lat
      const east = ((((place.lon - now.lon + 180) % 360) + 360) % 360) - 180
      if (Math.abs(north) + Math.abs(east) < 1e-4) break
      orientation = steer(orientation, gmst(sim), north, east)
    }
    return true
  }

  // zoom by factor, the ground under x, y kept there
  function zoomAt(factor, x, y) {
    const before = placeAt(x, y)
    zoom = zoomBy(zoom, factor)
    if (before) pin(before, x, y)
  }

  // the viewer's place: a ring and a dot, while it faces us
  function drawHere(z) {
    if (!here) return
    const p = at(
      surface(here.lat, here.lon, sim).map((c) => c * RE),
      z
    )
    if (p.hidden) return
    ctx.strokeStyle = ink.fg
    ctx.fillStyle = ink.fg
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI)
    ctx.fill()
  }

  function underCursor(z, g) {
    if (!cursor) return null
    const r = pixels(width, height, z)
    return ground(orientation, g, (cursor.x - width / 2) / r, (cursor.y - height / 2) / r)
  }

  let cursorText = ''
  function drawCursor(z, g) {
    const spot = underCursor(z, g)
    const text = spot ? `${ns(spot.lat)}  ${ew(spot.lon)}` : ''
    if (text !== cursorText) {
      cursorText = text
      readout.cursor.textContent = text ? `cursor ${text}` : ''
    }
    if (!spot || press) return
    ctx.strokeStyle = ink.fg
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cursor.x, cursor.y, 7, 0, 2 * Math.PI)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      ctx.moveTo(cursor.x + dx * 10, cursor.y + dy * 10)
      ctx.lineTo(cursor.x + dx * 16, cursor.y + dy * 16)
    }
    ctx.stroke()
    ctx.font = `9px ${ink.mono}`
    ctx.letterSpacing = '0.1em'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 4
    ctx.strokeStyle = ink.bgCss
    ctx.strokeText(text, cursor.x + 20, cursor.y + 14)
    ctx.fillStyle = ink.fg
    ctx.fillText(text, cursor.x + 20, cursor.y + 14)
    ctx.letterSpacing = '0px'
    ctx.lineWidth = 1
  }

  function draw() {
    ctx.clearRect(0, 0, width, height)
    const z = view()
    const g = gmst(sim)
    const light = toScreen(orientation, sun(sim))
    marks = sats.map((sat, index) => {
      const r = position(sat.el, sim)
      const p = toScreen(orientation, scaled(r, scale))
      const [x, y] = project(p, width, height, z)
      const next = at(position(sat.el, sim + (period(sat.el) * 60000) / 400), z)
      const below = geodetic(r, sim)
      return {
        index,
        x,
        y,
        hidden: hidden(p),
        heading: Math.atan2(next.y - y, next.x - x),
        kms: speed(sat.el, length(r)),
        value: sat.geo ? ew(below.lon, 1) : `${fmt(below.alt)} km`
      }
    })
    let seen = null
    if (selected >= 0) {
      const s = sats[selected]
      const r = position(s.el, sim)
      seen = {
        u: toScreen(
          orientation,
          r.map((c) => c / length(r))
        ),
        cos: RE / length(r),
        ink: s.geo ? ink.geoRgb : ink.leoRgb
      }
    }
    // the shader traces the coast from heights once the globe is large enough
    // to hold them, the vector coast stands in below that
    const rPx = pixels(width, height, z)
    if (gl && !detailAsked && rPx * dpr > DETAIL_PX) {
      detailAsked = true
      terrainAt(TERRAIN_ZOOM)
    }
    const sharp = Math.min(1, Math.max(0, (rPx - 220) / 140))
    if (gl) {
      gl.draw({
        width,
        height,
        dpr,
        r: rPx,
        distance: DISTANCE,
        inv: invert(orientation, g),
        light,
        ink: ink.fg3,
        bg: ink.bg,
        seen,
        look: LOOK,
        coast: sharp,
        step: contourStep(rPx),
        palette: ink.palette
      })
      if (sharp < 1) {
        ctx.globalAlpha = 1 - sharp
        drawLines(coast, g, z, ink.coast, LOOK ? 1 : 0.9)
        ctx.globalAlpha = 1
      }
    } else {
      drawGlobe(z, light, g)
      drawLines(graticule, g, z, ink.grid, 1)
      drawLines(coast, g, z, ink.coast, 0.8)
    }
    drawLimb(z)
    drawBezel(z, g)
    drawBelt(z, g)
    drawTrails(z)
    if (selected >= 0) {
      const sat = sats[selected]
      if (!sat.geo) drawPath(track(sat.el, sim - period(sat.el) * 30000), z, ink.track)
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
      drawView(z, sat)
    }
    drawLeader()
    drawSats()
    drawHere(z)
    drawCursor(z, g)
  }

  const fmt = (n, digits = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const ns = (lat, d = 2) => `${fmt(Math.abs(lat), d)}°${lat < -0.005 ? 'S' : 'N'}`
  const ew = (lon, d = 2) => `${fmt(Math.abs(lon), d)}°${lon < -0.005 ? 'W' : 'E'}`

  let scrubbing = false
  let dayStamp = -1
  // the knob where the clock is, a band from now to it with the gap written
  // on it when it fits, and a tick at each UTC midnight, rebuilt once a
  // minute as the week slides
  function showScrub(off) {
    if (locked !== null) return
    if (!scrubbing) scrub.value = String(Math.round(off / 1000))
    const shown = Number(scrub.value) * 1000
    const pos = share(shown) * 100
    scrub.style.setProperty('--a', `${Math.min(pos, 50)}%`)
    scrub.style.setProperty('--b', `${Math.max(pos, 50)}%`)
    gap.textContent = gapWords(shown)
    gap.style.left = `${(pos + 50) / 2}%`
    const room = (Math.abs(pos - 50) / 100) * scrub.clientWidth
    gap.hidden = !gap.textContent || room < gap.textContent.length * 7 + 12
    const stamp = Math.floor(Date.now() / 60000)
    if (stamp === dayStamp) return
    dayStamp = stamp
    const ticks = midnights(Date.now()).map(({ at, label }) => {
      const tick = document.createElement('span')
      tick.style.left = `${at * 100}%`
      const b = document.createElement('b')
      b.textContent = label
      tick.append(b)
      return tick
    })
    const mark = document.createElement('span')
    mark.className = 'now'
    mark.style.left = '50%'
    const word = document.createElement('b')
    word.textContent = 'now'
    mark.append(word)
    days.replaceChildren(...ticks, mark)
  }

  function showReadout() {
    readout.time.textContent = utc(sim, true)
    const off = sim - Date.now()
    readout.rate.textContent =
      locked !== null ? `last known, ${away(off)}` : paused ? `paused, ${away(off)}` : away(off)
    showScrub(off)
    if (sats.length) readout.count.textContent = `${sats.length} satellites, ${scale} scale`
    for (const row of rows) {
      const sat = sats[row.index]
      const r = position(sat.el, sim)
      const below = geodetic(r, sim)
      if (sat.geo) row.value.textContent = ew(below.lon, 1)
      else {
        const north = position(sat.el, sim + 60000)[2] > r[2]
        row.value.textContent = `${fmt(below.alt)} km ${ns(below.lat, 0)} ${north ? '↑' : '↓'}`
      }
    }
    if (selected < 0) return
    const sat = sats[selected]
    const r = position(sat.el, sim)
    const below = geodetic(r, sim)
    const lit = sunlit(r, sim)
    card.alt.textContent = fmt(below.alt)
    card.speed.textContent = fmt(speed(sat.el, length(r)), 2)
    card.below.textContent = `${ns(below.lat)} ${ew(below.lon)}`
    card.sun.textContent = `${lit.shadow ? 'in shadow' : 'sunlit'}, ground in ${lit.day ? 'day' : 'night'}`
    card.orbit.textContent = sat.geo
      ? `geostationary over ${ew(below.lon, 1)}`
      : `polar, ${fmt(sat.omm.INCLINATION, 1)}°, ${fmt(period(sat.el))} min a lap`
  }

  // The picture, captioned with when it was taken: a full disk's slot, or
  // for a daily composite the satellite's daylight pass over the area shown.
  function showPicture(sat, back = 0) {
    const below = geodetic(position(sat.el, sim), sim)
    const { src, href, caption, steps, taken, day, over } = picture(sat, below, Date.now(), back)
    card.link.href = href
    const when = taken ?? (day ? passOver(sat.el, over.lat, over.lon, day) : null)
    card.caption.textContent = when
      ? `${utc(when)}, ${taken ? '' : 'pass over this area, '}${caption}`
      : day
        ? `${day}, ${caption}`
        : caption
    card.img.hidden = !src
    card.root.classList.toggle('bare', !src)
    card.img.alt = src ? `${sat.name} imagery` : ''
    card.img.dataset.back = steps ? String(back) : ''
    if (src) card.img.src = src
    else card.img.removeAttribute('src')
  }

  card.img.addEventListener('error', () => {
    const sat = sats[selected]
    const back = Number(card.img.dataset.back) + 1
    if (sat && card.img.dataset.back && back <= BACK) showPicture(sat, back)
    else {
      card.img.hidden = true
      card.root.classList.add('bare')
    }
  })

  // On a phone the card opens compact. A tap on it anywhere but the name and
  // Close opens the rest, the picture's link included, and once open a tap
  // off its links folds it again.
  card.root.addEventListener('click', (event) => {
    if (!narrow.matches || event.target.closest('button, #card-wiki')) return
    const open = card.root.classList.contains('open')
    if (open && event.target.closest('a')) return
    event.preventDefault()
    card.root.classList.toggle('open', !open)
    resize()
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
    for (const row of rows) {
      if (row.index === index) row.button.setAttribute('aria-current', 'true')
      else row.button.removeAttribute('aria-current')
    }
    // the card's size moves the globe's room on a phone, so every pick resizes
    card.root.classList.remove('open')
    card.root.hidden = index < 0
    resize()
    if (index < 0) return
    const sat = sats[index]
    card.root.dataset.orbit = sat.geo ? 'geo' : 'leo'
    card.name.textContent = sat.name
    card.by.textContent = sat.by
    card.wiki.href = wikiUrl(sat)
    // the name is the link, its article named on hover
    card.wiki.title = `${decodeURIComponent(sat.wiki).replaceAll('_', ' ')} on Wikipedia`
    showPicture(sat)
    showReadout()
    if (center) {
      const r = position(sat.el, sim)
      const lat = Math.asin(r[2] / length(r)) / RAD
      startSwing(facing(Math.atan2(r[1], r[0]), lat + 15))
    }
  }

  // Turn to face to, and zoom to zoomTo, over ms. Both ends are kept in the
  // Earth's frame, so a swing lands true while time runs fast.
  function startSwing(to, zoomTo = zoom, ms = SWING) {
    const g = gmst(sim)
    swing = {
      from: keep(orientation, g),
      to: keep(to, g),
      z0: zoom,
      z1: zoomBy(1, zoomTo),
      ms,
      start: performance.now()
    }
  }

  function step(index, by) {
    const n = sats.length
    if (!n) return
    select(index < 0 ? (by > 0 ? 0 : n - 1) : (index + by + n) % n, true)
  }

  function setRate(index) {
    if (locked !== null) return
    rate = Math.min(RATES.length - 1, Math.max(0, index))
    for (const b of speeds.children)
      b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === rate))
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
  const norm = (s) => rgb(s).map((c) => c / 255)

  function setTheme(theme, save) {
    document.documentElement.dataset.theme = theme
    buttons.light.setAttribute('aria-pressed', String(theme === 'light'))
    const style = getComputedStyle(document.documentElement)
    const token = (name) => style.getPropertyValue(name).trim()
    themeColor.content = token('--bg')
    ink = {
      fg: token('--fg'),
      dim: token('--dim'),
      faint: token('--faint'),
      bgCss: token('--bg'),
      fg3: norm(token('--gl-ink')),
      bg: norm(token('--gl-bg')),
      geoRgb: norm(token('--geo-rgb')),
      leoRgb: norm(token('--leo-rgb')),
      coast: token('--coast'),
      grid: token('--grid'),
      belt: token('--belt'),
      tick: token('--tick'),
      limb: token('--limb'),
      geo: token('--geo'),
      leo: token('--leo'),
      track: token('--track'),
      mono: token('--mono'),
      palette: {
        OceanShallow: norm(token('--ocean-shallow')),
        OceanDeep: norm(token('--ocean-deep')),
        LandLow: norm(token('--land-low')),
        LandHigh: norm(token('--land-high')),
        Night: norm(token('--night')),
        nightMix: Number(token('--night-mix')),
        monoDay: Number(token('--mono-day')),
        monoNight: Number(token('--mono-night'))
      }
    }
    if (!save) return
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }

  function readStyle() {
    try {
      return localStorage.getItem(STYLE_KEY)
    } catch {
      return null
    }
  }

  function setStyle(style, save) {
    document.documentElement.dataset.style = style
    LOOK = style === 'mono' ? 1 : 0
    for (const b of styles.children)
      b.setAttribute('aria-pressed', String(b.dataset.stylePick === style))
    if (document.documentElement.dataset.theme) setTheme(document.documentElement.dataset.theme)
    if (!save) return
    try {
      localStorage.setItem(STYLE_KEY, style)
    } catch {}
  }

  const actions = {
    style() {
      setStyle(LOOK ? 'color' : 'mono', true)
    },
    pause() {
      if (locked !== null) return
      paused = !paused
      buttons.pause.setAttribute('aria-pressed', String(paused))
      showReadout()
    },
    now() {
      if (locked !== null) return
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
    },
    home() {
      spin = STILL
      startSwing(homeView(), HOME_ZOOM, 1100)
    },
    // the browser's idea of where the viewer is, swung to and marked
    locate() {
      if (!navigator.geolocation) {
        readout.note.textContent = 'location not available in this browser'
        return
      }
      readout.note.textContent = 'finding your location'
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          here = { lat: coords.latitude, lon: coords.longitude }
          readout.note.textContent = ''
          spin = STILL
          const p = surface(here.lat, here.lon, sim)
          startSwing(facing(Math.atan2(p[1], p[0]), here.lat), zoom, 1400)
        },
        (err) => {
          readout.note.textContent =
            err.code === err.PERMISSION_DENIED ? 'location not shared' : 'location not found'
        },
        { maximumAge: 600000, timeout: 15000 }
      )
    }
  }

  for (const [name, el] of Object.entries(buttons)) el.addEventListener('click', actions[name])

  for (const [index, label] of SPEEDS.entries()) {
    const b = document.createElement('button')
    b.dataset.rate = String(index)
    b.textContent = label
    b.title = `${RATES[index]}× real time`
    speeds.append(b)
  }
  speeds.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-rate]')
    if (b) setRate(Number(b.dataset.rate))
  })
  styles.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-style-pick]')
    if (b) setStyle(b.dataset.stylePick, true)
  })
  scrub.addEventListener('pointerdown', () => {
    scrubbing = true
  })
  scrub.addEventListener('input', () => {
    sim = Date.now() + Number(scrub.value) * 1000
    showReadout()
  })
  scrub.addEventListener('change', () => {
    scrubbing = false
  })
  on('pointerup', () => {
    scrubbing = false
  })
  // a row under the pointer lights its satellite on the globe
  roster.addEventListener('pointerover', (event) => {
    const button = event.target.closest('button[data-index]')
    hovered = button ? Number(button.dataset.index) : -1
  })
  roster.addEventListener('pointerleave', () => {
    hovered = -1
  })
  roster.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-index]')
    if (!button) return
    const index = Number(button.dataset.index)
    select(index === selected ? -1 : index, true)
  })

  on('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const { code } = event
    if (KEYS[code]) {
      held.add(code)
      swing = null
    } else if (ZOOM_KEYS[code]) zoomAt(ZOOM_KEYS[code], width / 2, height / 2)
    else if (PICK_KEYS[code]) step(selected, PICK_KEYS[code])
    else if (RATE_KEYS[code]) setRate(rate + RATE_KEYS[code])
    else if (TIME_KEYS[code]) {
      // the bar moves itself while it has focus
      if (event.target === scrub || locked !== null) return
      if (TIME_KEYS[code] < 0) scrub.stepDown()
      else scrub.stepUp()
      scrub.dispatchEvent(new Event('input'))
    } else if (ACTIONS[code]) {
      if (code === 'Escape' && credits.matches(':popover-open')) return
      actions[ACTIONS[code]]()
    } else return
    event.preventDefault()
  })
  on('keyup', (event) => held.delete(event.code))
  on('blur', () => held.clear())

  // the closest satellite within reach, else one whose label is under the
  // point
  function nearest(x, y, reach = REACH) {
    let best = -1
    let closest = reach
    for (const m of marks) {
      if (m.hidden && m.index !== selected) continue
      const d = Math.hypot(m.x - x, m.y - y)
      if (d < closest) {
        closest = d
        best = m.index
      }
    }
    if (best >= 0) return best
    const named = marks.find(
      ({ label: l }) => l && x >= l[0] && x <= l[2] && y >= l[1] && y <= l[3]
    )
    return named ? named.index : -1
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
    spin = STILL
    swing = null
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      span = Math.hypot(a.x - b.x, a.y - b.y)
      press = null
    } else {
      press = {
        x: event.offsetX,
        y: event.offsetY,
        grab: placeAt(event.offsetX, event.offsetY),
        moved: false,
        trail: []
      }
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') cursor = { x: event.offsetX, y: event.offsetY }
    const last = pointers.get(event.pointerId)
    if (!last) {
      hovered = nearest(event.offsetX, event.offsetY)
      canvas.classList.toggle('over', hovered >= 0)
      return
    }
    const dx = event.offsetX - last.x
    const dy = event.offsetY - last.y
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY })
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const next = Math.hypot(a.x - b.x, a.y - b.y)
      if (span) zoomAt(next / span, (a.x + b.x) / 2, (a.y + b.y) / 2)
      span = next
      return
    }
    if (!press) return
    if (Math.hypot(event.offsetX - press.x, event.offsetY - press.y) > CLICK) press.moved = true
    // the grabbed ground follows the pointer, and off the globe the drag
    // turns at the set rate instead
    if (!press.grab || !pin(press.grab, event.offsetX, event.offsetY)) {
      press.grab = null
      orientation = steer(orientation, gmst(sim), dy * grip(), -dx * grip())
    }
    const now = performance.now()
    press.trail.push({ x: event.offsetX, y: event.offsetY, at: now })
    while (press.trail.length && now - press.trail[0].at > FLICK_TAIL) press.trail.shift()
  })
  canvas.addEventListener('pointerleave', () => {
    cursor = null
    hovered = -1
  })

  function release(event) {
    if (!pointers.delete(event.pointerId)) return
    span = 0
    if (!press) return
    if (!press.moved) {
      const index = nearest(
        event.offsetX,
        event.offsetY,
        event.pointerType === 'touch' ? REACH_TOUCH : REACH
      )
      if (index >= 0 || selected >= 0) select(index, false)
    } else if (press.trail.length > 1) {
      const first = press.trail[0]
      const last = press.trail.at(-1)
      const ms = last.at - first.at
      const dx = last.x - first.x
      const dy = last.y - first.y
      if (ms > 0 && Math.hypot(dx, dy) / ms > FLICK) {
        spin = fling(dx, dy, ms).map((c) => (c * grip()) / DRAG)
      }
    }
    press = null
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  // A tap picks on pointerup, which on a phone opens the card under the
  // finger, and the same tap's click would then land on the card's link.
  canvas.addEventListener('touchend', (event) => event.preventDefault(), { passive: false })

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      zoomAt(
        Math.exp(-event.deltaY * (event.ctrlKey ? PINCH : WHEEL)),
        event.offsetX,
        event.offsetY
      )
    },
    { passive: false }
  )

  let lastFrame = performance.now()
  let turned = gmst(sim)
  let lastReadout = 0
  let lastSave = 0

  // the view is kept turned back to the Earth's frame, so a reload faces the
  // same ground whatever the time
  function save() {
    try {
      localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({
          q: keep(orientation, gmst(sim)),
          zoom,
          scale,
          rate,
          // a locked clock is the data's, not the viewer's, so it is not kept
          paused: locked === null && paused,
          offset: locked !== null ? 0 : sim - Date.now(),
          at: paused && locked === null ? sim : null,
          pick: selected >= 0 ? sats[selected].name : null
        })
      )
    } catch {}
  }

  function restore() {
    let v = null
    try {
      v = JSON.parse(localStorage.getItem(VIEW_KEY))
    } catch {}
    if (!Array.isArray(v?.q) || v.q.length !== 4) return null
    const wall = Date.now()
    sim = within(v.at ?? wall + (Number(v.offset) || 0), wall)
    turned = gmst(sim)
    orientation = unkeep(v.q, turned)
    zoom = zoomBy(1, Number(v.zoom) || HOME_ZOOM)
    scale = v.scale === 'true' ? 'true' : 'compressed'
    buttons.scale.setAttribute('aria-pressed', String(scale === 'true'))
    paused = Boolean(v.paused)
    buttons.pause.setAttribute('aria-pressed', String(paused))
    rate = Number.isInteger(v.rate) ? v.rate : 0
    return v.pick
  }

  function frame(now) {
    const ms = Math.min(100, now - lastFrame)
    lastFrame = now
    if (!paused) sim += ms * RATES[rate]
    // the time bar holds a week either side of now, and time stops at its end
    const wall = Date.now()
    if (locked !== null) sim = locked
    else {
      if (sim > wall + WEEK && !paused) actions.pause()
      sim = within(sim, wall)
    }
    // the camera turns with the Earth, so the globe holds still and only the
    // satellites and the Sun move, at any speed and across any jump in time
    const g = gmst(sim)
    const dg = ((((g - turned + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    turned = g
    if (dg) orientation = multiply(orientation, spinBy(dg))
    // held keys move the view over the ground, north and east
    const k = STEER * (grip() / DRAG) * (ms / FRAME)
    const [north, east] = [...held].reduce(
      (sum, code) => sum.map((c, i) => c + KEYS[code][i] * k),
      [0, 0]
    )
    if (north || east) orientation = steer(orientation, g, north, east)
    if (spin !== STILL) {
      orientation = steer(orientation, g, spin[0] * (ms / FRAME), spin[1] * (ms / FRAME))
      spin = slow(spin, ms)
    }
    if (swing) {
      const t = Math.min(1, (now - swing.start) / swing.ms)
      const eased = 1 - (1 - t) ** 3
      orientation = unkeep(slerp(swing.from, swing.to, eased), gmst(sim))
      zoom = swing.z0 * (swing.z1 / swing.z0) ** eased
      if (t === 1) swing = null
    }
    draw()
    if (now - lastReadout > READOUT_EVERY) {
      lastReadout = now
      showReadout()
    }
    if (now - lastSave > 1000) {
      lastSave = now
      save()
    }
    raf = requestAnimationFrame(frame)
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY))
    } catch {
      return null
    }
  }

  // the list down the left, geostationary west to east, then the polar
  // imagers by name
  function buildRoster() {
    const lists = { geo: $('roster-geo'), leo: $('roster-leo') }
    for (const list of Object.values(lists)) list.replaceChildren()
    const lon = (sat) => geodetic(position(sat.el, sim), sim).lon
    const order = sats
      .map((sat, index) => ({ sat, index }))
      .sort((a, b) =>
        a.sat.geo && b.sat.geo ? lon(a.sat) - lon(b.sat) : a.sat.name.localeCompare(b.sat.name)
      )
    rows = order.map(({ sat, index }) => {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.dataset.index = String(index)
      button.className = sat.geo ? 'geo' : 'leo'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = sat.name
      const value = document.createElement('span')
      value.className = 'value'
      button.append(name, value)
      li.append(button)
      lists[sat.geo ? 'geo' : 'leo'].append(li)
      return { index, button, value }
    })
    $('roster-geo-count').textContent = String(lists.geo.children.length)
    $('roster-leo-count').textContent = String(lists.leo.children.length)
  }

  // Elements from this browser's copy while it is fresh, else the copy the
  // site publishes every two hours, else CelesTrak itself, else whatever older
  // copy there is. Visitors reading the published copy keep the load on
  // CelesTrak to one fetch every two hours.
  // Hold the clock at the data's own time, the satellites where they were
  // then, with the time controls off and the time bar saying why.
  function lock(at) {
    locked = at
    sim = at
    paused = true
    buttons.pause.setAttribute('aria-pressed', 'true')
    timebar.classList.add('locked')
    for (const el of [scrub, buttons.pause, buttons.now, ...speeds.children]) el.disabled = true
    staleNote.textContent = `elements not loading, last known positions ${utc(at)}`
    staleNote.hidden = false
    showReadout()
  }

  async function load() {
    const now = Date.now()
    const cached = readCache()
    let snap = fresh(cached, now) ? cached : null
    let published = null
    if (!snap) {
      published = await fetch('./gp.json')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
      if (fresh(published, now, STALE)) snap = published
    }
    if (!snap) {
      try {
        snap = await snapshot((url) => fetch(url), now)
      } catch {
        snap = [cached, published].filter((s) => s?.groups).sort((a, b) => b.at - a.at)[0] ?? null
        if (!snap) readout.note.textContent = 'elements not loading, nothing to show'
      }
    }
    if (!snap) return
    if (now - snap.at > TRUSTED) lock(snap.at)
    if (snap !== cached) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(snap))
      } catch {}
    }
    sats = pick(snap.groups).map((sat) => {
      const el = elements(sat.omm)
      return { ...sat, el, geo: stationary(el) }
    })
    buildRoster()
    showReadout()
    const index = sats.findIndex((sat) => sat.name === kept)
    if (index >= 0) select(index, false)
  }

  setStyle(readStyle() === 'mono' ? 'mono' : 'color')
  setTheme(readTheme() ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  on('resize', resize)
  resize()
  const kept = restore()
  setRate(rate)
  load()
  on('pagehide', save)
  let raf = requestAnimationFrame(frame)

  const wink = import('/router/controls.js')
    .then(({ pageControls, winkControls }) => {
      const controls = pageControls(document)
      winkControls(controls, true)
      return (inward) => winkControls(controls, inward)
    })
    .catch(() => () => {})

  return (event) => {
    save()
    teardown.abort()
    cancelAnimationFrame(raf)
    canvas.style.visibility = 'hidden'
    globeCanvas.style.visibility = 'hidden'
    gl?.destroy()
    for (const id of ['timebar', 'readout']) $(id).style.visibility = 'hidden'
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.style
    event?.waitUntil?.(wink.then((run) => run(false)))
  }
}
