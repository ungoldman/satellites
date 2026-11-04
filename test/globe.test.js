import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGlobe, FRAG, levels, UNIFORMS } from '../src/globe.js'

// A stand-in WebGL2 context: constants are their own names, and every call
// is noted with its arguments. ok decides what compile and link report.
function fakeGl({ compiles = true, links = true, lose = true } = {}) {
  const calls = []
  const lost = []
  const gl = new Proxy(
    {},
    {
      get(_, name) {
        if (typeof name !== 'string') return undefined
        if (/^[A-Z0-9_]+$/.test(name)) return name
        if (name === 'calls') return calls
        if (name === 'getShaderParameter') return () => compiles
        if (name === 'getProgramParameter') return () => links
        if (name === 'getShaderInfoLog') return () => 'shader broke'
        if (name === 'getProgramInfoLog') return () => 'program broke'
        if (name === 'getUniformLocation') return (_, u) => u
        if (name === 'getExtension')
          return () => (lose ? { loseContext: () => lost.push(1) } : null)
        return (...args) => {
          calls.push([name, ...args])
          return { name }
        }
      }
    }
  )
  return { gl, calls, lost }
}

const canvas = (gl, size = 100) => ({ width: size, height: size, getContext: () => gl })
const of = (calls, name) => calls.filter(([n]) => n === name)
const uniform = (calls, u) => calls.filter(([n, at]) => n.startsWith('uniform') && at === u).at(-1)
const MASK = Uint8Array.from({ length: 8 }, (_, k) => k % 2)

const PALETTE = {
  OceanShallow: [0.1, 0.2, 0.3],
  OceanDeep: [0, 0, 0.1],
  LandLow: [0.2, 0.3, 0.2],
  LandHigh: [0.6, 0.6, 0.5],
  Night: [0, 0, 0],
  nightMix: 0.7,
  monoDay: 0.13,
  monoNight: 0
}
const FRAME = {
  width: 100,
  height: 80,
  dpr: 2,
  r: 30,
  distance: 12,
  inv: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ],
  light: [0, 0, -1],
  ink: [1, 1, 1],
  bg: [0, 0, 0],
  seen: null,
  look: 0,
  coast: 1,
  palette: PALETTE,
  step: 250
}

test('every uniform set is declared in the shader, and the reverse', () => {
  const declared = [...FRAG.matchAll(/^uniform \w+ ([^;]+);/gm)].flatMap(([, names]) =>
    names.split(',').map((n) => n.trim())
  )
  assert.deepEqual([...UNIFORMS].sort(), [...declared].sort())
})

test('each mip level averages the four below it, down to one texel', () => {
  const heights = Float32Array.from({ length: 16 }, (_, k) => k)
  const out = levels(4, heights)
  assert.equal(out.length, 3)
  assert.equal(out[0], heights)
  assert.deepEqual([...out[1]], [2.5, 4.5, 10.5, 12.5])
  assert.deepEqual([...out[2]], [7.5])
})

test('without WebGL2 there is no globe', () => {
  assert.equal(createGlobe(canvas(null), MASK, 4, 2), null)
})

test('a shader or program that fails says why', () => {
  assert.throws(
    () => createGlobe(canvas(fakeGl({ compiles: false }).gl), MASK, 4, 2),
    /shader broke/
  )
  assert.throws(() => createGlobe(canvas(fakeGl({ links: false }).gl), MASK, 4, 2), /program broke/)
})

test('it starts with the land mask and no heights', () => {
  const { gl, calls } = fakeGl()
  createGlobe(canvas(gl), MASK, 4, 2)
  const [mask] = of(calls, 'texImage2D').filter(([, , , format]) => format === 'R8')
  assert.deepEqual([...mask.at(-1)], [0, 255, 0, 255, 0, 255, 0, 255])
  assert.equal(of(calls, 'generateMipmap').length, 1)
  assert.deepEqual(uniform(calls, 'uHasHeight'), ['uniform1i', 'uHasHeight', 0])
  // each sampler on its own unit
  assert.deepEqual(
    ['uHeight', 'uMask'].map((u) => uniform(calls, u)[2]),
    [0, 1]
  )
})

test('heights arrive with every mip level', () => {
  const { gl, calls } = fakeGl()
  const globe = createGlobe(canvas(gl), MASK, 4, 2)
  calls.length = 0
  globe.terrain({ size: 4, heights: new Float32Array(16) })
  assert.deepEqual(
    of(calls, 'texImage2D').map(([, , level, , w]) => [level, w]),
    [
      [0, 4],
      [1, 2],
      [2, 1]
    ]
  )
  assert.deepEqual(uniform(calls, 'uHasHeight'), ['uniform1i', 'uHasHeight', 1])
})

test('a frame sets the view, the light, and the look, then draws', () => {
  const { gl, calls } = fakeGl()
  const globe = createGlobe(canvas(gl, 200), MASK, 4, 2)
  calls.length = 0
  globe.draw(FRAME)
  assert.deepEqual(of(calls, 'viewport')[0], ['viewport', 0, 0, 200, 200])
  assert.deepEqual(uniform(calls, 'uRes'), ['uniform2f', 'uRes', 100, 80])
  assert.deepEqual(uniform(calls, 'uInv'), [
    'uniformMatrix3fv',
    'uInv',
    false,
    [1, 0, 0, 0, 1, 0, 0, 0, 1]
  ])
  assert.deepEqual(uniform(calls, 'uStep'), ['uniform1f', 'uStep', 250])
  assert.deepEqual(uniform(calls, 'uLandHigh'), ['uniform3fv', 'uLandHigh', PALETTE.LandHigh])
  assert.deepEqual(uniform(calls, 'uMonoDay'), ['uniform1f', 'uMonoDay', 0.13])
  // nothing picked: the view area is set out of reach
  assert.deepEqual(uniform(calls, 'uSeenCos'), ['uniform1f', 'uSeenCos', 2])
  assert.deepEqual(uniform(calls, 'uSeenInk'), ['uniform3fv', 'uSeenInk', FRAME.ink])
  assert.deepEqual(of(calls, 'drawArrays')[0], ['drawArrays', 'TRIANGLE_STRIP', 0, 4])
  // every uniform is set each frame but the samplers and the switches
  const set = new Set(calls.filter(([n]) => n.startsWith('uniform')).map(([, u]) => u))
  const once = ['uHeight', 'uMask', 'uHasHeight']
  for (const u of UNIFORMS) assert.equal(set.has(u), !once.includes(u), u)
})

test('a picked satellite marks the ground it sees', () => {
  const { gl, calls } = fakeGl()
  const globe = createGlobe(canvas(gl), MASK, 4, 2)
  globe.draw({ ...FRAME, look: 1, seen: { u: [0, 0, -1], cos: 0.15, ink: [1, 0.7, 0.3] } })
  assert.deepEqual(uniform(calls, 'uSeenU'), ['uniform3fv', 'uSeenU', [0, 0, -1]])
  assert.deepEqual(uniform(calls, 'uSeenCos'), ['uniform1f', 'uSeenCos', 0.15])
  assert.deepEqual(uniform(calls, 'uSeenInk'), ['uniform3fv', 'uSeenInk', [1, 0.7, 0.3]])
  assert.deepEqual(uniform(calls, 'uLook'), ['uniform1i', 'uLook', 1])
})

test('destroy lets the context go, where the browser allows it', () => {
  const kept = fakeGl()
  createGlobe(canvas(kept.gl), MASK, 4, 2).destroy()
  assert.equal(kept.lost.length, 1)
  const plain = fakeGl({ lose: false })
  assert.doesNotThrow(() => createGlobe(canvas(plain.gl), MASK, 4, 2).destroy())
})
