// The 2D overlay over the globe: the belt, satellites with their trails and
// labels, the picked one's track, plumb line, and view, the
// leader to its card, the viewer's place, and the cursor. It draws on the
// context it is given from a plain scene, with no DOM of its own, so it runs
// in Node against a stand-in context.
import { ew, fmt } from './format.js'
import {
  GEO_KM,
  geodetic,
  horizon,
  length,
  period,
  position,
  RAD,
  RE,
  scaled,
  speed,
  surface,
  track
} from './orbit.js'
import { DISTANCE, hidden, LIMB, leader, overlaps, pixels, project, toScreen } from './view.js'

// the geostationary belt
const BELT = Array.from({ length: 145 }, (_, k) => [
  GEO_KM * Math.cos(k * 2.5 * RAD),
  GEO_KM * Math.sin(k * 2.5 * RAD),
  0
])
// steps along the plumb line
const PLUMB = 24
// samples in each trail
const TRAIL = 20
// the belt dial's ticks and labels as fractions of the belt's radius, so the
// dial keeps its proportions at either scale
const DIAL = { inner: 0.995, minor: 1.0066, major: 1.0147, label: 1.032 }

// Where each satellite is on screen for a scene, which way it is heading,
// how fast, and the value its label carries.
export function markAll(s) {
  const at = locate(s)
  return s.sats.map((sat, index) => {
    const r = position(sat.el, s.sim)
    const p = toScreen(s.orientation, scaled(r, s.scale))
    const [x, y] = project(p, s.width, s.height, s.z)
    const next = at(position(sat.el, s.sim + (period(sat.el) * 60000) / 400))
    const below = geodetic(r, s.sim)
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
}

// a point in the inertial frame on screen, and whether the Earth hides it
const locate = (s) => (v) => {
  const p = toScreen(s.orientation, scaled(v, s.scale))
  const [x, y] = project(p, s.width, s.height, s.z)
  return { x, y, hidden: hidden(p) }
}

// 0° and the date line belong to neither hemisphere
const lonLabel = (lon) =>
  lon % 180 === 0 ? `${Math.abs(lon)}°` : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`

export function createOverlay(ctx) {
  let s
  let at

  // a point in the Earth's own frame on screen, turned by sidereal time
  function spun([x, y, z]) {
    const c = Math.cos(s.g)
    const n = Math.sin(s.g)
    return toScreen(s.orientation, [x * c - y * n, x * n + y * c, z])
  }

  // px from the center to the edge of the globe
  const limb = () => pixels(s.width, s.height, s.z) * LIMB

  // lines on the near side of the globe, broken where they pass behind it
  function drawLines({ lines, style, width, alpha = 1 }) {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = style
    ctx.lineWidth = width
    ctx.beginPath()
    for (const line of lines) {
      let down = false
      for (const v of line) {
        const p = spun(v)
        if (p[2] > -1 / DISTANCE) {
          down = false
          continue
        }
        const [x, y] = project(p, s.width, s.height, s.z)
        if (down) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        down = true
      }
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // a path through space, solid in front of the Earth and dashed behind it,
  // or only the front part
  function drawPath(points, style, behind = true, dash = []) {
    const screen = points.map((v) => toScreen(s.orientation, scaled(v, s.scale)))
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
        const [x, y] = project(p, s.width, s.height, s.z)
        if (down) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        down = true
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // small type, set the same way wherever it is drawn
  function type(size, spacing) {
    ctx.font = `${size}px ${s.ink.mono}`
    ctx.letterSpacing = spacing
    ctx.textBaseline = 'middle'
  }

  // the geostationary belt as a dial of longitude, turning with the Earth
  function drawBelt() {
    drawPath(BELT, s.ink.belt, false)
    const r = length(scaled([GEO_KM, 0, 0], s.scale))
    const dial = (u, f) => {
      const p = toScreen(
        s.orientation,
        u.map((c) => c * r * f)
      )
      const [x, y] = project(p, s.width, s.height, s.z)
      return { x, y, hidden: hidden(p) }
    }
    type(9, '0.12em')
    ctx.textAlign = 'center'
    for (let k = 0; k < 36; k++) {
      const lon = k * 10 - 180
      const a = lon * RAD + s.g
      const u = [Math.cos(a), Math.sin(a), 0]
      const major = k % 3 === 0
      const from = dial(u, DIAL.inner)
      const to = dial(u, major ? DIAL.major : DIAL.minor)
      if (from.hidden) continue
      ctx.strokeStyle = major ? s.ink.tick : s.ink.belt
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      if (!major) continue
      const l = dial(u, DIAL.label)
      ctx.fillStyle = s.ink.faint
      ctx.fillText(lonLabel(lon), l.x, l.y)
    }
    ctx.textAlign = 'start'
    ctx.letterSpacing = '0px'
  }

  function drawLimb() {
    ctx.strokeStyle = s.ink.limb
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(s.width / 2, s.height / 2, limb(), 0, 2 * Math.PI)
    ctx.stroke()
  }

  // where each satellite has just been, fading out behind it
  function drawTrails() {
    for (const m of s.marks) {
      if (m.hidden) continue
      const sat = s.sats[m.index]
      // geostationary ones turn with the Earth, so a shorter tail keeps it off
      // the globe
      const reach = (period(sat.el) * 60000) / (sat.geo ? 48 : 12)
      let prev = m
      ctx.strokeStyle = sat.geo ? s.ink.geo : s.ink.leo
      ctx.lineWidth = m.index === s.selected ? 1.5 : 1
      for (let k = 1; k <= TRAIL; k++) {
        const p = at(position(sat.el, s.sim - (reach * k) / TRAIL))
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
    const color = sat.geo ? s.ink.geo : s.ink.leo
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
    if (s.look) {
      ctx.fillStyle = s.ink.bgCss
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
    const ahead = (s.look ? 5 : 4) * m.kms
    ctx.globalAlpha = on ? 0.8 : 0.35
    ctx.setLineDash(s.look ? [2, 3] : [])
    ctx.beginPath()
    ctx.moveTo(8 * k, 0)
    ctx.lineTo(8 * k + ahead, 0)
    if (!s.look) {
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

  // the picked satellite's track, the plumb line to its ground, the edge of
  // what it sees, and the cone from it to that edge
  function drawPicked(sat) {
    if (!sat.geo) drawPath(track(sat.el, s.sim - period(sat.el) * 30000), s.ink.track)
    const r = position(sat.el, s.sim)
    const ground = RE / length(r)
    drawPath(
      Array.from({ length: PLUMB + 1 }, (_, k) => {
        const f = 1 + ((ground - 1) * k) / PLUMB
        return r.map((c) => c * f)
      }),
      s.ink.track
    )
    const color = sat.geo ? s.ink.geo : s.ink.leo
    const rim = horizon(r)
    drawPath(rim, color, false, s.look ? [3, 3] : [])
    const from = at(r)
    const below = at(r.map((c) => c * ground))
    const d = [below.x - from.x, below.y - from.y]
    const front = rim.map(at).filter((p) => !p.hidden)
    if (!front.length) return
    ctx.strokeStyle = color
    ctx.beginPath()
    if (s.look) {
      ctx.globalAlpha = 0.16
      for (let k = 0; k < front.length; k += 12) {
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(front[k].x, front[k].y)
      }
    } else {
      ctx.globalAlpha = 0.4
      const side = (p) =>
        (d[0] * (p.y - from.y) - d[1] * (p.x - from.x)) / Math.hypot(p.x - from.x, p.y - from.y)
      const sorted = [...front].sort((a, b) => side(a) - side(b))
      for (const p of [sorted[0], sorted.at(-1)]) {
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(p.x, p.y)
      }
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // the callout from the picked satellite to its card, under the satellites
  // and labels
  function drawLeader() {
    const m = s.marks[s.selected]
    if (!s.box || !m || m.hidden) return
    const line = leader(m, s.box)
    if (!line) return
    const { start, elbow, end } = line
    ctx.strokeStyle = s.sats[s.selected].geo ? s.ink.geo : s.ink.leo
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.6
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(...start)
    if (elbow) ctx.lineTo(...elbow)
    ctx.lineTo(...end)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.fillStyle = s.ink.bgCss
    ctx.beginPath()
    ctx.arc(end[0], end[1], 3, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
  }

  // Every satellite and its label, the picked one and the hovered one first
  // so their labels win a clash. Each mark keeps the box its label took, for
  // picking by label.
  function drawSats() {
    type(10, '0.1em')
    const placed = []
    const rank = (m) => (m.index === s.selected ? 2 : m.index === s.hovered ? 1 : 0)
    for (const m of [...s.marks].sort((a, b) => rank(b) - rank(a))) {
      m.label = null
      if (m.hidden && m.index !== s.selected) continue
      const sat = s.sats[m.index]
      const on = m.index === s.selected
      const hover = m.index === s.hovered
      ctx.globalAlpha = m.hidden ? 0.3 : 1
      glyph(m, sat, on, hover)
      const name = sat.name.toUpperCase()
      const x = m.x + (on ? 20 : 11)
      const nw = ctx.measureText(name).width
      const vw = ctx.measureText(m.value).width
      const label = [x - 2, m.y - 7, x + nw + 8 + vw, m.y + 7]
      if (placed.some((o) => overlaps(label, o))) continue
      placed.push(label)
      m.label = label
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4
      ctx.strokeStyle = s.ink.bgCss
      ctx.strokeText(name, x, m.y)
      ctx.strokeText(m.value, x + nw + 6, m.y)
      ctx.fillStyle = on || hover ? s.ink.fg : s.ink.dim
      ctx.fillText(name, x, m.y)
      ctx.fillStyle = s.ink.faint
      ctx.fillText(m.value, x + nw + 6, m.y)
      ctx.lineWidth = 1
    }
    ctx.globalAlpha = 1
    ctx.letterSpacing = '0px'
  }

  // the viewer's place: a ring and a dot, while it faces us
  function drawHere() {
    const p = at(surface(s.here.lat, s.here.lon, s.sim).map((c) => c * RE))
    if (p.hidden) return
    ctx.strokeStyle = s.ink.fg
    ctx.fillStyle = s.ink.fg
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI)
    ctx.fill()
  }

  // crosshairs at the cursor, with the place under it
  function drawCursor({ x, y, text }) {
    ctx.strokeStyle = s.ink.fg
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, 2 * Math.PI)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      ctx.moveTo(x + dx * 10, y + dy * 10)
      ctx.lineTo(x + dx * 16, y + dy * 16)
    }
    ctx.stroke()
    type(9, '0.1em')
    ctx.lineWidth = 4
    ctx.strokeStyle = s.ink.bgCss
    ctx.strokeText(text, x + 20, y + 14)
    ctx.fillStyle = s.ink.fg
    ctx.fillText(text, x + 20, y + 14)
    ctx.letterSpacing = '0px'
    ctx.lineWidth = 1
  }

  // Everything over the globe for one frame, in order from the back. The
  // scene names what to draw: lines in the Earth's frame (coast, grid), the
  // card's box for the leader, the viewer's place, and the cursor, each
  // when there is one.
  return function draw(scene) {
    s = scene
    at = locate(s)
    for (const lines of s.lines) drawLines(lines)
    drawLimb()
    drawBelt()
    drawTrails()
    if (s.selected >= 0) drawPicked(s.sats[s.selected])
    if (s.selected >= 0) drawLeader()
    drawSats()
    if (s.here) drawHere()
    if (s.cursor) drawCursor(s.cursor)
  }
}
