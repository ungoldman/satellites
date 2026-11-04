// The clock in words and the time bar's scale. No DOM, so it runs in Node too.

export const DAY = 86400000
// how far the time bar reaches either side of now
export const WEEK = 7 * DAY

// labels for the speeds in RATES, as time passed per second
export const SPEEDS = ['1×', '10×', '1m/s', '5m/s', '30m/s', '1h/s']

export const utc = (ms, seconds = false) =>
  `${new Date(ms)
    .toISOString()
    .slice(0, seconds ? 19 : 16)
    .replace('T', ' ')} UTC`

// how far a clock ms off now is, in words
export function away(ms) {
  const m = Math.round(Math.abs(ms) / 60000)
  if (m < 2) return 'now'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const parts = d
    ? [`${d} d`, h && `${h} h`]
    : h
      ? [`${h} h`, m % 60 && `${m % 60} min`]
      : [`${m} min`]
  return `${parts.filter(Boolean).join(' ')} ${ms > 0 ? 'ahead' : 'behind'}`
}

// the same, signed and short, for the band on the time bar
export function gap(ms) {
  const words = away(ms)
  return words === 'now' ? '' : `${ms > 0 ? '+' : '−'}${words.replace(/ (ahead|behind)$/, '')}`
}

// a clock kept within the time bar's reach of now
export const within = (ms, now) => Math.min(now + WEEK, Math.max(now - WEEK, ms))

// where an offset from now sits along the time bar, 0 to 1
export const share = (off) => (off + WEEK) / (2 * WEEK)

// each UTC midnight on the time bar about now, where it sits and its date
export function midnights(now) {
  const from = now - WEEK
  const out = []
  for (let t = Math.ceil(from / DAY) * DAY; t < now + WEEK; t += DAY) {
    out.push({
      at: (t - from) / (2 * WEEK),
      label: new Date(t).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      })
    })
  }
  return out
}
