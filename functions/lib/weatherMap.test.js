import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  PIN_COLOR,
  MAP_USER_AGENT,
  OSM_TILE_URL,
  pinsFromAreas,
  planView,
  project,
  renderRiskMap,
} from './weatherMap.js'

const TILE = 256

async function solidTile(r, g, b) {
  return sharp({
    create: { width: TILE, height: TILE, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer()
}

function sample(data, info, x, y) {
  const px = Math.round(x)
  const py = Math.round(y)
  const i = (py * info.width + px) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

describe('pinsFromAreas', () => {
  it('pins high in red and medium in yellow, and drops a site with no coordinates', () => {
    expect(PIN_COLOR.High).toBe('#dc2626')
    expect(PIN_COLOR.Medium).toBe('#eab308')
    const pins = pinsFromAreas([
      { name: 'Plant 2', level: 'High', lat: 17.44, lng: 78.39 },
      { name: 'Depot', level: 'Medium', lat: '13.08', lng: '80.27' },
      { name: 'No pin', level: 'High', region: 'South' },
      { name: 'Quiet', level: 'Low', lat: 28.61, lng: 77.2 },
    ])
    expect(pins).toEqual([
      { lat: 17.44, lng: 78.39, level: 'High' },
      { lat: 13.08, lng: 80.27, level: 'Medium' },
    ])
  })
})

describe('planView', () => {
  it('fits a spread of sites inside the frame and stays close on one site', () => {
    const pad = { left: 36, right: 28, top: 40, bottom: 64 }
    const width = 560
    const height = 360
    const points = [
      { lat: 17.44, lng: 78.39 },
      { lat: 13.08, lng: 80.27 },
      { lat: 28.61, lng: 77.2 },
    ]
    const wide = planView(points, { width, height, pad })
    const one = planView([points[0]], { width, height, pad })
    expect(one.zoom).toBe(13)
    expect(wide.zoom).toBeLessThan(one.zoom)
    for (const point of points) {
      const at = project(point.lng, point.lat, wide)
      expect(at.x).toBeGreaterThanOrEqual(pad.left - 1)
      expect(at.x).toBeLessThanOrEqual(width - pad.right + 1)
      expect(at.y).toBeGreaterThanOrEqual(pad.top - 1)
      expect(at.y).toBeLessThanOrEqual(height - pad.bottom + 1)
    }
  })
})

describe('renderRiskMap', () => {
  it('paints a red pin on a high site and a yellow pin on a medium site', async () => {
    const tile = await solidTile(186, 214, 196)
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, ua: init.headers['User-Agent'] })
      return { ok: true, arrayBuffer: async () => tile }
    }
    const pins = [
      { lat: 17.44, lng: 78.39, level: 'High' },
      { lat: 13.08, lng: 80.27, level: 'Medium' },
    ]
    const rendered = await renderRiskMap(pins, { fetchImpl, width: 480, height: 320 })
    expect(rendered.png[0]).toBe(0x89)
    expect(rendered.attribution).toContain('OpenStreetMap')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.length).toBeLessThanOrEqual(16)
    expect(calls[0].ua).toBe(MAP_USER_AGENT)
    expect(calls[0].url.startsWith('https://tile.openstreetmap.org/')).toBe(true)
    expect(calls.every((call) => call.url.includes(OSM_TILE_URL.split('{z}')[0]))).toBe(true)

    const { data, info } = await sharp(rendered.png).raw().toBuffer({ resolveWithObject: true })
    const high = rendered.placed.find((pin) => pin.level === 'High')
    const medium = rendered.placed.find((pin) => pin.level === 'Medium')
    // The head is a disc centred 18px above the tip. Six pixels to the side
    // is fill, outside the white hole.
    const red = sample(data, info, high.x + 6, high.y - 18)
    const yellow = sample(data, info, medium.x + 6, medium.y - 18)
    expect(red[0]).toBeGreaterThan(180)
    expect(red[1]).toBeLessThan(80)
    expect(red[2]).toBeLessThan(80)
    expect(yellow[0]).toBeGreaterThan(180)
    expect(yellow[1]).toBeGreaterThan(140)
    expect(yellow[2]).toBeLessThan(80)
  })

  it('returns nothing when every tile fails, and nothing when there is no pin', async () => {
    const missed = await renderRiskMap([{ lat: 17.44, lng: 78.39, level: 'High' }], {
      fetchImpl: async () => ({ ok: false, arrayBuffer: async () => Buffer.alloc(0) }),
    })
    expect(missed).toBeNull()
    expect(
      await renderRiskMap([], {
        fetchImpl: async () => {
          throw new Error('no')
        },
      })
    ).toBeNull()
  })
})
