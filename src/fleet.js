// Which satellites, who flies them, and where their pictures are. No DOM, so
// it runs in Node too.

// CelesTrak groups that hold the fleet between them
export const GROUPS = ['weather', 'resource']
export const SOURCE = 'https://celestrak.org/NORAD/elements/gp.php'
export const groupUrl = (group) => `${SOURCE}?GROUP=${group}&FORMAT=json`

// CelesTrak updates elements about every two hours and asks clients to
// fetch no more often than that
export const FRESH = 2 * 3600000

const SLIDER = 'https://slider.cira.colostate.edu'
const WORLDVIEW = 'https://worldview.earthdata.nasa.gov/'
const SNAPSHOT = 'https://wvs.earthdata.nasa.gov/api/v1/snapshot'
const LANDSAT = { kind: 'link', href: 'https://landsatlook.usgs.gov/', label: 'LandsatLook' }
const COPERNICUS = {
  kind: 'link',
  href: 'https://browser.dataspace.copernicus.eu/',
  label: 'Copernicus Browser'
}
const viirs = (layer) => ({
  kind: 'worldview',
  layer: `VIIRS_${layer}_CorrectedReflectance_TrueColor`
})
const modis = (layer) => ({
  kind: 'worldview',
  layer: `MODIS_${layer}_CorrectedReflectance_TrueColor`
})

// by NORAD catalog number, geostationary first, then west to east
export const FLEET = [
  {
    id: 51850,
    name: 'GOES-18',
    wiki: 'GOES-18',
    by: 'NOAA',
    image: { kind: 'goes', sat: 'GOES18' }
  },
  {
    id: 60133,
    name: 'GOES-19',
    wiki: 'GOES-19',
    by: 'NOAA',
    image: { kind: 'goes', sat: 'GOES19' }
  },
  {
    id: 54743,
    name: 'Meteosat-12',
    wiki: 'MTG-I1',
    by: 'EUMETSAT',
    image: { kind: 'slider', sat: 'meteosat-0deg', every: 15 }
  },
  {
    id: 28912,
    name: 'Meteosat-9',
    wiki: 'Meteosat',
    by: 'EUMETSAT',
    image: { kind: 'slider', sat: 'meteosat-9', every: 15 }
  },
  {
    id: 58990,
    name: 'INSAT-3DS',
    wiki: 'INSAT-3DS',
    by: 'ISRO',
    image: { kind: 'link', href: 'https://mosdac.gov.in/', label: 'MOSDAC' }
  },
  {
    id: 43823,
    name: 'GK-2A',
    wiki: 'Chollian-2A',
    by: 'KMA',
    image: { kind: 'slider', sat: 'gk2a', every: 10 }
  },
  { id: 41836, name: 'Himawari-9', wiki: 'Himawari_9', by: 'JMA', image: { kind: 'himawari' } },
  { id: 43013, name: 'NOAA-20', wiki: 'NOAA-20', by: 'NOAA', image: viirs('NOAA20') },
  { id: 54234, name: 'NOAA-21', wiki: 'NOAA-21', by: 'NOAA', image: viirs('NOAA21') },
  { id: 37849, name: 'Suomi NPP', wiki: 'Suomi_NPP', by: 'NASA and NOAA', image: viirs('SNPP') },
  { id: 25994, name: 'Terra', wiki: 'Terra_(satellite)', by: 'NASA', image: modis('Terra') },
  { id: 27424, name: 'Aqua', wiki: 'Aqua_(satellite)', by: 'NASA', image: modis('Aqua') },
  { id: 39084, name: 'Landsat 8', wiki: 'Landsat_8', by: 'USGS and NASA', image: LANDSAT },
  { id: 49260, name: 'Landsat 9', wiki: 'Landsat_9', by: 'USGS and NASA', image: LANDSAT },
  { id: 40697, name: 'Sentinel-2A', wiki: 'Sentinel-2', by: 'ESA', image: COPERNICUS },
  { id: 42063, name: 'Sentinel-2B', wiki: 'Sentinel-2', by: 'ESA', image: COPERNICUS },
  { id: 60989, name: 'Sentinel-2C', wiki: 'Sentinel-2', by: 'ESA', image: COPERNICUS },
  { id: 41335, name: 'Sentinel-3A', wiki: 'Sentinel-3', by: 'ESA and EUMETSAT', image: COPERNICUS },
  { id: 43437, name: 'Sentinel-3B', wiki: 'Sentinel-3', by: 'ESA and EUMETSAT', image: COPERNICUS }
]

// Meteosat-9 has no article of its own, and GK-2A's is under its Korean
// name
export const wikiUrl = (sat) => `https://en.wikipedia.org/wiki/${sat.wiki}`

// the fleet's records out of CelesTrak's groups, in fleet order, skipping any
// the groups lack
export function pick(groups) {
  const byId = new Map(groups.flat().map((omm) => [omm.NORAD_CAT_ID, omm]))
  return FLEET.filter((sat) => byId.has(sat.id)).map((sat) => ({ ...sat, omm: byId.get(sat.id) }))
}

const pad = (n, width = 2) => String(n).padStart(width, '0')

// Full disks land every few minutes and post some time later, and neither
// source lets a page ask which is newest. So the card guesses the slot a lag
// behind now, and back steps to earlier ones when it is not up yet.
export const HIMAWARI_LAG = 30 * 60000
export const SLIDER_LAG = 40 * 60000
export const MINUTE = 60000

export function slot(ms, every, lag, back = 0) {
  const step = every * MINUTE
  const d = new Date(Math.floor((ms - lag) / step) * step - back * step)
  return {
    day: `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`
  }
}

export function himawari(ms, back = 0) {
  const { day, time } = slot(ms, 10, HIMAWARI_LAG, back)
  return `https://himawari8.nict.go.jp/img/D531106/1d/550/${day}/${time}_0_0.png`
}

// CIRA's SLIDER, one 464 px tile at its lowest zoom
export function slider(sat, every, ms, back = 0) {
  const { day, time } = slot(ms, every, SLIDER_LAG, back)
  const stamp = day.replaceAll('/', '') + time
  return `${SLIDER}/data/imagery/${day}/${sat}---full_disk/geocolor/${stamp}/00/000_000.png`
}

// the last whole UTC day before ms, which daily composites have finished
export function yesterday(ms) {
  return new Date(ms - 86400000).toISOString().slice(0, 10)
}

// a box of 30° by 20° about a point, kept inside the map's edges
export function box(lat, lon) {
  const x = Math.min(165, Math.max(-165, lon))
  const y = Math.min(80, Math.max(-80, lat))
  return [y - 10, x - 15, y + 10, x + 15].map((n) => Math.round(n * 10) / 10)
}

// What the card shows for sat, under the point at lat, lon at time ms: an
// image src if one can be built, where it links, a caption, and whether a
// missing image should step back a slot.
export function picture(sat, { lat, lon }, ms, back = 0) {
  const { image } = sat
  if (image.kind === 'goes') {
    return {
      src: `https://cdn.star.nesdis.noaa.gov/${image.sat}/ABI/FD/GEOCOLOR/678x678.jpg`,
      href: `https://www.star.nesdis.noaa.gov/GOES/fulldisk.php?sat=G${image.sat.slice(4)}`,
      caption: 'Latest full disk, GeoColor, NOAA STAR'
    }
  }
  if (image.kind === 'himawari') {
    return {
      src: himawari(ms, back),
      href: 'https://himawari8.nict.go.jp/',
      caption: 'Latest full disk, true color, NICT',
      steps: true
    }
  }
  if (image.kind === 'slider') {
    return {
      src: slider(image.sat, image.every, ms, back),
      href: `${SLIDER}/?sat=${image.sat}&sec=full_disk&p%5B0%5D=geocolor`,
      caption: 'Latest full disk, GeoColor, CIRA SLIDER',
      steps: true
    }
  }
  if (image.kind === 'worldview') {
    const day = yesterday(ms)
    const [s, w, n, e] = box(lat, lon)
    const params = new URLSearchParams({
      REQUEST: 'GetSnapshot',
      LAYERS: image.layer,
      CRS: 'EPSG:4326',
      TIME: day,
      BBOX: `${s},${w},${n},${e}`,
      FORMAT: 'image/jpeg',
      WIDTH: '480',
      HEIGHT: '320'
    })
    return {
      src: `${SNAPSHOT}?${params}`,
      href: `${WORLDVIEW}?l=${image.layer}&t=${day}&v=${w},${s},${e},${n}`,
      caption: `Below it on ${day}, daily true color, NASA Worldview`
    }
  }
  return { src: null, href: image.href, caption: `Imagery on ${image.label}` }
}
