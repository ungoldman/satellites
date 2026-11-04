// Stitches the Terrarium tiles into one lossless WebP per level,
// terrain-2.webp and terrain-3.webp, so the page loads the world in one
// request: from the Pages workflow, and by hand for the dev server. Needs
// cwebp. The heights do not change, so a file already there is kept. A failed
// fetch or encode writes nothing and still exits cleanly, and the page falls
// back to the tiles.
import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { PHONE_ZOOM, TERRAIN_ZOOM, TILE, tileUrl } from './terrain.js'

const run = promisify(execFile)
const dir = process.argv[2] ?? new URL('.', import.meta.url).pathname
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// 8-bit RGB or RGBA, not interlaced, as the tiles are, to rows of RGB
function readPng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    const body = buf.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colour, , , interlace] = body.subarray(8)
      if (depth !== 8 || interlace || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG, depth ${depth} colour ${colour}`)
      }
      channels = colour === 2 ? 3 : 4
    } else if (type === 'IDAT') idat.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgb = Buffer.alloc(width * height * 3)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      const add = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]
      row[i] = (row[i] + add) & 255
    }
    for (let x = 0; x < width; x++)
      row.copy(rgb, (y * width + x) * 3, x * channels, x * channels + 3)
    prev = row
  }
  return { width, height, rgb }
}

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])))
  return Buffer.concat([head, body, crc])
}

// RGB rows to a plain PNG, only for cwebp to read, so nothing is filtered
function writePng(width, height, rgb) {
  const stride = width * 3
  const out = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) rgb.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(out, { level: 1 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

async function bake(level) {
  const n = 2 ** level
  const size = n * TILE
  const rgb = Buffer.alloc(size * size * 3)
  await Promise.all(
    Array.from({ length: n * n }, async (_, k) => {
      const x = k % n
      const y = Math.floor(k / n)
      const res = await fetch(tileUrl(level, x, y))
      if (!res.ok) throw new Error(`tile ${level}/${x}/${y}: ${res.status}`)
      const tile = readPng(Buffer.from(await res.arrayBuffer()))
      for (let row = 0; row < TILE; row++) {
        tile.rgb.copy(
          rgb,
          ((y * TILE + row) * size + x * TILE) * 3,
          row * TILE * 3,
          (row + 1) * TILE * 3
        )
      }
    })
  )
  return writePng(size, size, rgb)
}

for (const level of [PHONE_ZOOM, TERRAIN_ZOOM]) {
  const out = `${dir.replace(/\/$/, '')}/terrain-${level}.webp`
  try {
    const head = await readFile(out)
    if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
      console.log(`${out}: there, kept`)
      continue
    }
  } catch {}
  const png = join(tmpdir(), `terrain-${level}-${process.pid}.png`)
  try {
    await writeFile(png, await bake(level))
    // -exact keeps every byte, since the colours are heights
    await run('cwebp', ['-quiet', '-lossless', '-z', '9', '-exact', png, '-o', out])
    console.log(`${out}: written`)
  } catch (err) {
    console.warn(`${out}: not written, ${err.message}`)
  } finally {
    await rm(png, { force: true })
  }
}
