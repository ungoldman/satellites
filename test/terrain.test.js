import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bakedUrl,
  decode,
  loadTerrain,
  PHONE_ZOOM,
  TERRAIN,
  TERRAIN_ZOOM,
  TILE,
  tileUrl
} from '../src/terrain.js'

// stand-ins for the network and the canvas: every pixel reads 16.5 m, and
// each file asked for is noted. No stitched file is published unless baked
// says so.
function tools({ status = 200, baked = 404 } = {}) {
  const asked = []
  const drawn = []
  return {
    asked,
    drawn,
    fetch: async (url, { signal }) => {
      asked.push({ url, signal })
      if (url.startsWith('file:')) {
        if (baked instanceof Error) throw baked
        return { ok: baked === 200, status: baked, blob: async () => url }
      }
      return { ok: status === 200, status, blob: async () => url }
    },
    bitmap: async (blob) => ({ blob, close() {} }),
    canvas: (size) => ({
      drawImage: (bitmap, x, y) => drawn.push([bitmap.blob, x, y]),
      getImageData: () => ({
        data: Uint8ClampedArray.from(
          { length: size * size * 4 },
          (_, k) => [128, 16, 128, 255][k % 4]
        )
      })
    })
  }
}

test('terrarium pixels decode to metres', () => {
  assert.equal(decode(128, 0, 0), 0)
  assert.equal(decode(128, 16, 128), 16.5)
  assert.equal(decode(0, 0, 0), -32768)
})

test('tiles are named by level, column, and row', () => {
  assert.equal(tileUrl(3, 1, 2), `${TERRAIN}/3/1/2.png`)
})

test('the world is laid out tile by tile and decoded', async () => {
  const t = tools()
  const signal = AbortSignal.timeout(1000)
  const { size, heights } = await loadTerrain(signal, 1, t)
  assert.equal(size, 2 * TILE)
  assert.equal(heights.length, size * size)
  assert.ok(heights.every((h) => h === 16.5))
  assert.deepEqual(
    t.asked.map((a) => a.url),
    [bakedUrl(1), tileUrl(1, 0, 0), tileUrl(1, 1, 0), tileUrl(1, 0, 1), tileUrl(1, 1, 1)]
  )
  assert.ok(t.asked.every((a) => a.signal === signal))
  assert.deepEqual(
    t.drawn.map(([, x, y]) => [x, y]),
    [
      [0, 0],
      [TILE, 0],
      [0, TILE],
      [TILE, TILE]
    ]
  )
})

test('the world is 64 tiles, and 16 on a phone', async () => {
  const full = tools()
  await loadTerrain(undefined, undefined, full)
  assert.equal(full.asked.length - 1, 4 ** TERRAIN_ZOOM)
  assert.equal(full.asked.length - 1, 64)
  const phone = tools()
  await loadTerrain(undefined, PHONE_ZOOM, phone)
  assert.equal(phone.asked.length - 1, 16)
})

test('the stitched file sits beside the module, named by level', () => {
  assert.equal(bakedUrl(3), new URL('../src/terrain-3.webp', import.meta.url).href)
})

test('a published stitched file is one request in place of the tiles', async () => {
  const t = tools({ baked: 200 })
  const { size, heights } = await loadTerrain(undefined, 1, t)
  assert.equal(size, 2 * TILE)
  assert.ok(heights.every((h) => h === 16.5))
  assert.deepEqual(
    t.asked.map((a) => a.url),
    [bakedUrl(1)]
  )
  assert.deepEqual(t.drawn, [[bakedUrl(1), 0, 0]])
})

test('a stitched file that fails to fetch falls back to the tiles', async () => {
  const t = tools({ baked: new TypeError('offline') })
  await loadTerrain(undefined, 1, t)
  assert.equal(t.asked.length, 5)
})

test('an aborted load stops rather than falling back', async () => {
  const controller = new AbortController()
  controller.abort()
  const t = tools({ baked: new DOMException('aborted', 'AbortError') })
  await assert.rejects(loadTerrain(controller.signal, 1, t), /aborted/)
  assert.equal(t.asked.length, 1)
})

test('a missing tile fails the load', async () => {
  await assert.rejects(loadTerrain(undefined, 0, tools({ status: 404 })), /404/)
})

test('without tools it uses the browser fetch and canvas', async (t) => {
  const fake = tools()
  const saved = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap
  }
  t.after(() => Object.assign(globalThis, saved))
  const options = []
  const canvases = []
  globalThis.fetch = fake.fetch
  globalThis.createImageBitmap = async (blob, o) => {
    options.push(o)
    return fake.bitmap(blob)
  }
  globalThis.document = {
    createElement: () => {
      const c = {
        getContext: (kind, o) => {
          canvases.push({ c, kind, o })
          return fake.canvas(c.width)
        }
      }
      return c
    }
  }
  const { size } = await loadTerrain(undefined, 0)
  assert.equal(size, TILE)
  assert.equal(canvases[0].kind, '2d')
  assert.equal(canvases[0].c.width, TILE)
  assert.equal(canvases[0].c.height, TILE)
  assert.deepEqual(canvases[0].o, { willReadFrequently: true })
  // the colours are heights, so nothing may touch them
  assert.deepEqual(options[0], { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
})
