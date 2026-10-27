import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

// the only paths served, so nothing else in the directory can leak
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/coast.js': ['coast.js', 'text/javascript; charset=utf-8'],
  '/fleet.js': ['fleet.js', 'text/javascript; charset=utf-8'],
  '/orbit.js': ['orbit.js', 'text/javascript; charset=utf-8'],
  '/view.js': ['view.js', 'text/javascript; charset=utf-8']
}

export function createSatelliteServer() {
  return createServer(async (req, res) => {
    const file = FILES[new URL(req.url, 'http://localhost').pathname]
    if (req.method !== 'GET' || !file) {
      res.writeHead(404).end()
      return
    }
    const [name, type] = file
    // read per request so an edit shows up on refresh
    const body = await readFile(new URL(name, import.meta.url))
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  })
}

// Resolves with the URL once listening. A taken port falls back to a free one.
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') return reject(err)
      server.listen(0, '127.0.0.1')
    })
    server.on('listening', () => resolve(`http://localhost:${server.address().port}`))
    server.listen(port, '127.0.0.1')
  })
}

export function opener(platform, osRelease) {
  if (platform === 'darwin') return 'open'
  // WSL reports linux, but the browser is on the Windows side
  if (platform === 'win32' || osRelease.toLowerCase().includes('microsoft')) return 'explorer.exe'
  return 'xdg-open'
}
