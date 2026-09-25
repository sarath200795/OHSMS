// A static map for the weather digest.
//
// Mail clients do not run JavaScript, and a remote image URL is what image
// blocking drops, so the map is a PNG the message carries inline. Tiles come
// from the OpenStreetMap standard tile server. No API key. The usage policy
// (https://operations.osmfoundation.org/policies/tiles/) asks for a real
// User-Agent, a visible attribution, and no bulk scraping. One digest is a
// handful of tiles for the viewport, two at a time, and a tile fetched for
// one org is reused for the next org in the same run.
//
// sharp composites the tiles and an SVG of the pins. staticmaps would do the
// same composite, but its tile fetch is not injectable and a test would have
// to call the tile server. The User-Agent, the tile cap and the pin colours
// are the parts a silent failure would get wrong, so they live here where a
// test can see them.
import sharp from 'sharp'

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const MAP_USER_AGENT = 'OHSMS-weather-digest/1.0 (contact: info@weehs.org)'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
export const MAP_CID = 'weather-risk-map'

// Red and yellow are the pin fills. Yellow is a map mark, not text, so the
// contrast rule for type does not apply; the outline keeps it visible on a
// pale tile. The same two colours are the legend dots.
export const PIN_COLOR = {
  High: '#dc2626',
  Medium: '#eab308',
}

export const MAP_WIDTH = 560
export const MAP_HEIGHT = 360

const TILE = 256
const MIN_ZOOM = 3
const MAX_ZOOM = 14
// A 560×360 image is about a dozen tiles. The cap is the backstop if a
// caller asks for a larger picture: the policy is what makes the number
// small, not the arithmetic.
const MAX_TILES = 16
const TILE_CONCURRENCY = 2
const TILE_TIMEOUT_MS = 8000

const PAD = { left: 36, right: 28, top: 40, bottom: 64 }

function lonToX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom
}

function latToY(lat, zoom) {
  const rad = (lat * Math.PI) / 180
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad))
  return ((1 - merc / Math.PI) / 2) * 2 ** zoom
}

/**
 * Elevated sites that can take a pin. A missing or impossible coordinate is
 * not a pin. The table still has the row — the caller decides that.
 */
export function pinsFromAreas(areas) {
  const out = []
  for (const area of areas || []) {
    if (!area || (area.level !== 'High' && area.level !== 'Medium')) continue
    const lat = typeof area.lat === 'number' ? area.lat : Number(area.lat)
    const lng = typeof area.lng === 'number' ? area.lng : Number(area.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lat < -85 || lat > 85 || lng < -180 || lng > 180) continue
    out.push({ lat, lng, level: area.level })
  }
  return out
}

function tilesFor(view) {
  const originX = view.centerX * TILE - view.width / 2
  const originY = view.centerY * TILE - view.height / 2
  const x0 = Math.floor(originX / TILE)
  const y0 = Math.floor(originY / TILE)
  const x1 = Math.floor((originX + view.width - 1) / TILE)
  const y1 = Math.floor((originY + view.height - 1) / TILE)
  const n = 2 ** view.zoom
  const tiles = []
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      if (y < 0 || y >= n) continue
      const tx = ((x % n) + n) % n
      tiles.push({
        z: view.zoom,
        x: tx,
        y,
        left: x * TILE - originX,
        top: y * TILE - originY,
      })
    }
  }
  return tiles
}

function computeView(points, { width, height, pad, maxZoom }) {
  const minLon = Math.min(...points.map((p) => p.lng))
  const maxLon = Math.max(...points.map((p) => p.lng))
  const minLat = Math.min(...points.map((p) => p.lat))
  const maxLat = Math.max(...points.map((p) => p.lat))
  const innerW = Math.max(1, width - pad.left - pad.right)
  const innerH = Math.max(1, height - pad.top - pad.bottom)
  const lone = maxLon - minLon < 1e-5 && maxLat - minLat < 1e-5
  let zoom = lone ? Math.min(13, maxZoom) : MIN_ZOOM
  if (!lone) {
    for (let z = maxZoom; z >= MIN_ZOOM; z -= 1) {
      const xSpan = Math.abs(lonToX(maxLon, z) - lonToX(minLon, z)) * TILE
      const ySpan = Math.abs(latToY(minLat, z) - latToY(maxLat, z)) * TILE
      if (xSpan <= innerW && ySpan <= innerH) {
        zoom = z
        break
      }
    }
  }
  // The legend sits in the bottom padding, so the geographic centre is the
  // centre of the inner box, not of the whole image. Centring on the image
  // drops the southern pin under the legend.
  const centerLon = (minLon + maxLon) / 2
  const centerLat = (minLat + maxLat) / 2
  const innerCx = pad.left + innerW / 2
  const innerCy = pad.top + innerH / 2
  const centerX = lonToX(centerLon, zoom) - (innerCx - width / 2) / TILE
  const centerY = latToY(centerLat, zoom) - (innerCy - height / 2) / TILE
  return { zoom, centerX, centerY, width, height, pad, centerLon, centerLat }
}

/** Zoom and centre that fit every pin inside the padded frame. */
export function planView(points, options = {}) {
  const width = options.width || MAP_WIDTH
  const height = options.height || MAP_HEIGHT
  const pad = options.pad || PAD
  let maxZoom = MAX_ZOOM
  let view = computeView(points, { width, height, pad, maxZoom })
  let tiles = tilesFor(view)
  while (tiles.length > MAX_TILES && view.zoom > MIN_ZOOM) {
    maxZoom = view.zoom - 1
    view = computeView(points, { width, height, pad, maxZoom })
    tiles = tilesFor(view)
  }
  return view
}

export function project(lng, lat, view) {
  return {
    x: (lonToX(lng, view.zoom) - view.centerX) * TILE + view.width / 2,
    y: (latToY(lat, view.zoom) - view.centerY) * TILE + view.height / 2,
  }
}

function overlaySvg(placed, width, height) {
  const markers = placed
    .map((pin) => {
      const color = PIN_COLOR[pin.level] || PIN_COLOR.Medium
      return `<g transform="translate(${pin.x.toFixed(2)} ${pin.y.toFixed(2)})">
<path d="M0 0 C0 0 -9 -12 -9 -18 A9 9 0 1 1 9 -18 C9 -12 0 0 0 0 Z" fill="${color}" stroke="#111827" stroke-width="1.2"/>
<circle cx="0" cy="-18" r="3.2" fill="#ffffff"/>
</g>`
    })
    .join('')
  const x = 8
  const y = height - 52
  const legend = `<g>
<rect x="${x}" y="${y}" width="228" height="44" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#d0e8e4"/>
<circle cx="${x + 16}" cy="${y + 16}" r="5.5" fill="${PIN_COLOR.High}" stroke="#111827" stroke-width="0.8"/>
<text x="${x + 28}" y="${y + 20}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" fill="#123632">High</text>
<circle cx="${x + 84}" cy="${y + 16}" r="5.5" fill="${PIN_COLOR.Medium}" stroke="#111827" stroke-width="0.8"/>
<text x="${x + 96}" y="${y + 20}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="12" fill="#123632">Medium</text>
<text x="${x + 10}" y="${y + 36}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="10" fill="#246058">${OSM_ATTRIBUTION}</text>
</g>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${markers}${legend}</svg>`
}

async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await fn(items[index])
    }
  }
  const n = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

async function fetchTile(tile, fetchImpl, cache) {
  const key = `${tile.z}/${tile.x}/${tile.y}`
  if (cache?.has(key)) return cache.get(key)
  const url = OSM_TILE_URL.replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
  let bytes = null
  try {
    const resp = await fetchImpl(url, {
      headers: {
        'User-Agent': MAP_USER_AGENT,
        Accept: 'image/png,image/*;q=0.8',
      },
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    })
    if (resp?.ok) {
      const buf = Buffer.from(await resp.arrayBuffer())
      await sharp(buf).metadata()
      bytes = buf
    }
  } catch {
    bytes = null
  }
  if (bytes && cache) cache.set(key, bytes)
  return bytes
}

async function tilePiece(tile, bytes, width, height) {
  let img = sharp(bytes)
  const meta = await img.metadata()
  if (meta.width !== TILE || meta.height !== TILE) {
    const resized = await img.resize(TILE, TILE, { fit: 'fill' }).png().toBuffer()
    img = sharp(resized)
  }
  const srcX = Math.max(0, Math.floor(-tile.left))
  const srcY = Math.max(0, Math.floor(-tile.top))
  const destX = Math.max(0, Math.round(tile.left))
  const destY = Math.max(0, Math.round(tile.top))
  const srcW = Math.floor(Math.min(TILE - srcX, width - destX))
  const srcH = Math.floor(Math.min(TILE - srcY, height - destY))
  if (srcW < 1 || srcH < 1 || destX >= width || destY >= height) return null
  const input = await img
    .extract({ left: srcX, top: srcY, width: srcW, height: srcH })
    .png()
    .toBuffer()
  return { input, left: destX, top: destY }
}

/**
 * PNG of the pinned sites, or null when there is nothing to pin or no tile
 * could be read. A gray rectangle with pins is not a map, and the mail still
 * has the tables.
 *
 * `fetchImpl` is the test seam. Production uses global fetch.
 */
export async function renderRiskMap(pins, options = {}) {
  const list = (pins || []).filter(
    (pin) =>
      pin &&
      (pin.level === 'High' || pin.level === 'Medium') &&
      Number.isFinite(pin.lat) &&
      Number.isFinite(pin.lng)
  )
  if (!list.length) return null
  const width = options.width || MAP_WIDTH
  const height = options.height || MAP_HEIGHT
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const view = planView(list, { width, height, pad: options.pad })
  const tiles = tilesFor(view)
  const fetched = await pool(tiles, TILE_CONCURRENCY, (tile) =>
    fetchTile(tile, fetchImpl, options.cache)
  )
  const pieces = []
  for (let i = 0; i < tiles.length; i += 1) {
    if (!fetched[i]) continue
    try {
      const piece = await tilePiece(tiles[i], fetched[i], width, height)
      if (piece) pieces.push(piece)
    } catch {
      /* one bad tile stays the background colour */
    }
  }
  if (!pieces.length) return null

  // Medium under high, so a shared coordinate shows the worse pin.
  const ordered = [...list].sort((a, b) => (a.level === 'High') - (b.level === 'High'))
  const placed = ordered.map((pin) => {
    const at = project(pin.lng, pin.lat, view)
    return { ...pin, x: at.x, y: at.y }
  })

  const base = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 226, g: 232, b: 230 },
    },
  })
    .composite(pieces)
    .png()
    .toBuffer()

  const png = await sharp(base)
    .composite([{ input: Buffer.from(overlaySvg(placed, width, height)), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return { png, placed, zoom: view.zoom, attribution: OSM_ATTRIBUTION }
}
