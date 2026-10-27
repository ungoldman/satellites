import { spawn } from 'node:child_process'
import { release } from 'node:os'
import { createSatelliteServer, listen, opener } from './server.js'

const url = await listen(createSatelliteServer(), Number(process.env.PORT) || 4173)
console.log(url)

if (!process.argv.includes('--no-open')) {
  const child = spawn(opener(process.platform, release()), [url], {
    stdio: 'ignore',
    detached: true
  })
  // a missing opener is fine, the URL is already printed
  child.on('error', () => {})
  child.unref()
}
