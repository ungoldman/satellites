// Writes CelesTrak's elements for the fleet to a file, as the page loads them:
// on each deploy and every two hours from the Pages workflow, and by hand for
// the dev server. A copy younger than CelesTrak asks is left as it is, and a
// failed fetch leaves the old copy and still exits cleanly, so a deploy goes
// ahead and the page falls back.
import { readFile, writeFile } from 'node:fs/promises'
import { fresh, snapshot } from './fleet.js'

const out = process.argv[2] ?? new URL('gp.json', import.meta.url)
const now = Date.now()

let old = null
try {
  old = JSON.parse(await readFile(out, 'utf8'))
} catch {}

if (fresh(old, now)) {
  console.log(`${out}: under two hours old, kept`)
} else {
  try {
    const snap = await snapshot(
      (url) =>
        fetch(url, { headers: { 'user-agent': 'satellites (github.com/ungoldman/satellites)' } }),
      now
    )
    await writeFile(out, JSON.stringify(snap))
    console.log(`${out}: written`)
  } catch (err) {
    console.warn(`${out}: not written, ${err.message}`)
  }
}
