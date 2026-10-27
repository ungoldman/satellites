import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { createSatelliteServer, listen, opener } from '../src/server.js'

async function serve(t, port = 0) {
  const server = createSatelliteServer()
  t.after(() => server.close())
  return [await listen(server, port), server]
}

test('it serves the page and its five scripts', async (t) => {
  const [url] = await serve(t)
  for (const [path, type] of [
    ['/', 'text/html'],
    ['/app.js', 'text/javascript'],
    ['/coast.js', 'text/javascript'],
    ['/fleet.js', 'text/javascript'],
    ['/orbit.js', 'text/javascript'],
    ['/view.js', 'text/javascript']
  ]) {
    const res = await fetch(url + path)
    assert.equal(res.status, 200, path)
    assert.ok(res.headers.get('content-type').startsWith(type), path)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.ok((await res.text()).length > 100, path)
  }
})

test('it serves nothing else', async (t) => {
  const [url] = await serve(t)
  for (const path of ['/package.json', '/server.js', '/../package.json', '/nope']) {
    assert.equal((await fetch(url + path)).status, 404, path)
  }
  assert.equal((await fetch(url, { method: 'POST' })).status, 404)
})

test('a taken port falls back to a free one', async (t) => {
  const [first, server] = await serve(t)
  const [second] = await serve(t, server.address().port)
  assert.notEqual(second, first)
  assert.equal((await fetch(second)).status, 200)
})

test('any other listen error is passed on', async (t) => {
  const server = createSatelliteServer()
  t.after(() => server.close())
  const failed = listen(server, 0)
  server.emit('error', Object.assign(new Error('nope'), { code: 'EACCES' }))
  await assert.rejects(failed, /nope/)
  await once(server, 'listening')
})

test('the opener suits the platform', () => {
  assert.equal(opener('darwin', '25.0.0'), 'open')
  assert.equal(opener('win32', '10.0.26100'), 'explorer.exe')
  assert.equal(opener('linux', '6.18.40.1-microsoft-standard-WSL2'), 'explorer.exe')
  assert.equal(opener('linux', '6.8.0-generic'), 'xdg-open')
})

test('npm start prints a URL that serves the page', async (t) => {
  // find a free port by borrowing one
  const [, probe] = await serve(t)
  const { port } = probe.address()
  probe.close()
  await once(probe, 'close')

  const child = spawn(process.execPath, ['src/start.js', '--no-open'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port) }
  })
  t.after(() => child.kill())
  const [line] = await once(child.stdout, 'data')
  const url = String(line).trim()
  assert.match(url, /^http:\/\/localhost:\d+$/)
  assert.equal((await fetch(url)).status, 200)
})
