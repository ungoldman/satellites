// Height and depth in metres from the Terrarium tiles on AWS Open Data, the
// whole world as one Web Mercator square, north row first. The network and the
// canvas come in as tools, so it runs in Node too.
export const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
// the world at zoom 3 is 64 tiles, about 5 MB, and at zoom 2 a quarter of
// that, for phones
export const TERRAIN_ZOOM = 3
export const PHONE_ZOOM = 2
export const TILE = 256

export const decode = (r, g, b) => r * 256 + g + b / 256 - 32768

export const tileUrl = (level, x, y) => `${TERRAIN}/${level}/${x}/${y}.png`

// The default tools, the browser's: fetch, and a canvas to lay tiles on.
const browser = {
  fetch: (...args) => fetch(...args),
  canvas(size) {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    return c.getContext('2d', { willReadFrequently: true })
  },
  // raw bytes, the colour is data
  bitmap: (blob) =>
    createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
}

// every tile at level, laid out and decoded into one square of heights
export async function loadTerrain(signal, level = TERRAIN_ZOOM, tools = browser) {
  const n = 2 ** level
  const size = n * TILE
  const g = tools.canvas(size)
  await Promise.all(
    Array.from({ length: n * n }, async (_, k) => {
      const x = k % n
      const y = Math.floor(k / n)
      const res = await tools.fetch(tileUrl(level, x, y), { signal })
      if (!res.ok) throw new Error(`${res.status}`)
      const bitmap = await tools.bitmap(await res.blob())
      g.drawImage(bitmap, x * TILE, y * TILE)
      bitmap.close()
    })
  )
  const { data } = g.getImageData(0, 0, size, size)
  const heights = new Float32Array(size * size)
  for (let k = 0; k < heights.length; k++) {
    heights[k] = decode(data[k * 4], data[k * 4 + 1], data[k * 4 + 2])
  }
  return { size, heights }
}
