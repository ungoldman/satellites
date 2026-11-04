// Numbers and places in words. No DOM, so it runs in Node too.

export const fmt = (n, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

// latitude and longitude with their hemisphere, a hair either side of zero
// read as north and east so a rounded 0.00 never shows as south or west
export const ns = (lat, d = 2) => `${fmt(Math.abs(lat), d)}°${lat < -0.005 ? 'S' : 'N'}`
export const ew = (lon, d = 2) => `${fmt(Math.abs(lon), d)}°${lon < -0.005 ? 'W' : 'E'}`
