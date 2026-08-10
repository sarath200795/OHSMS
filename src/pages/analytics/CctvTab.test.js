import { describe, it, expect } from 'vitest'
import { cctvDefectAnalytics, faultLabel } from './CctvTab'

const SITES = [
  { id: 's1', name: 'Hosur', region: 'South', entity: 'COCO', lat: 12.74, lng: 77.83 },
  // Deliberately without coordinates — it can be counted but never plotted.
  { id: 's2', name: 'Chennai Depot', region: 'East', entity: 'FOFO' },
]

const meraki = (o = {}) => ({ id: 'm1', name: 'MX-Hosur', siteId: 's1', siteName: 'Hosur', status: 'online', ...o })
const dvr = (o = {}) => ({ id: 'd1', name: 'DVR-1', siteId: 's1', siteName: 'Hosur', status: 'online', ...o })
const cam = (o = {}) => ({ id: 'c1', name: 'CAM-1', dvrId: 'd1', siteId: 's1', siteName: 'Hosur', status: 'online', defects: [], ...o })

const run = (o) => cctvDefectAnalytics({ sites: SITES, ...o })
const kind = (a, key) => a.byKind.find((k) => k.key === key)

describe('the cascade is not counted as damage', () => {
  // The whole reason this tab exists. If any of these three break, the map is
  // reporting one dead switch as a site full of broken cameras.
  const threeCams = [cam({ id: 'c1' }), cam({ id: 'c2' }), cam({ id: 'c3' })]

  it('plots a dead Meraki as ONE Meraki defect, not as its darkened cameras', () => {
    const a = run({ merakis: [meraki({ status: 'offline' })], dvrs: [dvr()], cameras: threeCams })
    expect(kind(a, 'meraki').value).toBe(1)
    expect(kind(a, 'dvr').value).toBe(0)
    expect(kind(a, 'camera').value).toBe(0)
    expect(a.total).toBe(1)
  })

  it('counts the devices it darkened as casualties instead', () => {
    const a = run({ merakis: [meraki({ status: 'offline' })], dvrs: [dvr()], cameras: threeCams })
    expect(a.casualties).toMatchObject({ cameras: 3, dvrs: 1, total: 4 })
  })

  it('plots a dead DVR as one DVR defect and its cameras as casualties', () => {
    const a = run({ merakis: [meraki()], dvrs: [dvr({ status: 'offline' })], cameras: threeCams })
    expect(kind(a, 'dvr').value).toBe(1)
    expect(kind(a, 'camera').value).toBe(0)
    expect(a.casualties).toMatchObject({ cameras: 3, dvrs: 0 })
  })
})

describe('what does count as a camera defect', () => {
  it('a camera that is itself offline', () => {
    const a = run({ merakis: [meraki()], dvrs: [dvr()], cameras: [cam({ status: 'offline' })] })
    expect(kind(a, 'camera').value).toBe(1)
    expect(a.casualties.total).toBe(0)
  })

  it('a camera that streams perfectly but is pointed at a wall', () => {
    const a = run({ merakis: [meraki()], dvrs: [dvr()], cameras: [cam({ defects: ['blur'] })] })
    expect(kind(a, 'camera').value).toBe(1)
    expect(a.byFault).toEqual([{ key: 'Camera · Blur', name: 'Camera · Blur', value: 1, color: '#2563eb' }])
  })

  it('a darkened camera that is ALSO blurred — for the blur, not the darkness', () => {
    // The blur is a real fault on a real camera and survives the cascade. The
    // darkness does not: it belongs to the Meraki above it.
    const a = run({
      merakis: [meraki({ status: 'offline' })], dvrs: [dvr()], cameras: [cam({ defects: ['blur'] })],
    })
    expect(kind(a, 'camera').value).toBe(1)
    expect(a.byFault.map((f) => f.name)).toEqual(['Camera · Blur', 'Meraki · Offline'])
  })
})

describe('fault labels', () => {
  it('never merges the three kinds of "offline" into one row', () => {
    // Three devices, all reporting offline, three unrelated jobs.
    const a = run({
      merakis: [meraki({ id: 'm9', siteId: 's2', status: 'offline' })],
      dvrs: [dvr({ status: 'offline' })],
      cameras: [cam({ dvrId: 'none', status: 'offline' })],
    })
    expect(a.byFault.map((f) => f.name).sort()).toEqual([
      'Camera · Offline', 'DVR · Offline', 'Meraki · Offline',
    ])
  })

  it('falls back to the raw key rather than rendering nothing', () => {
    expect(faultLabel('camera', 'blocked')).toBe('Camera · Blocked')
    expect(faultLabel('dvr', 'something_new')).toBe('DVR · something_new')
  })
})

describe('placing a defect on the map', () => {
  it('takes coordinates from the site record, not the device', () => {
    const a = run({ merakis: [meraki({ status: 'offline' })] })
    expect(a.pins).toHaveLength(1)
    expect(a.pins[0]).toMatchObject({ id: 's1', lat: 12.74, lng: 77.83, total: 1, lead: 'meraki' })
  })

  it('counts a defect at a site without coordinates but reports it as unplotted', () => {
    const a = run({ merakis: [meraki({ siteId: 's2', siteName: 'Chennai Depot', status: 'offline' })] })
    expect(a.total).toBe(1)
    expect(a.bySite).toEqual([{ key: 'Chennai Depot', name: 'Chennai Depot', value: 1, color: '#c74a33' }])
    expect(a.pins).toHaveLength(0)
    expect(a.unmapped).toBe(1)
  })

  it('gives a mixed site the colour of its furthest-upstream fault', () => {
    // A site with a dead switch and a smeared lens is a network job first.
    const a = run({
      merakis: [meraki({ status: 'offline' })], dvrs: [dvr()], cameras: [cam({ defects: ['blur'] })],
    })
    expect(a.pins[0]).toMatchObject({ total: 2, lead: 'meraki' })
    expect(a.pins[0].counts).toEqual({ meraki: 1, dvr: 0, camera: 1 })
  })

  it('follows a camera to the site it inherited from its DVR', () => {
    const a = run({
      merakis: [meraki()],
      dvrs: [dvr({ siteId: 's1' })],
      cameras: [cam({ siteId: '', siteName: '', status: 'offline' })],
    })
    expect(a.pins[0]).toMatchObject({ id: 's1', total: 1, lead: 'camera' })
  })
})

describe('scoping', () => {
  const estate = {
    merakis: [meraki()],
    dvrs: [dvr()],
    cameras: [cam({ status: 'offline' }), cam({ id: 'c2', siteId: 's2', status: 'offline' })],
  }

  it('narrows every count to the chosen site', () => {
    const a = run({ ...estate, siteId: 's2' })
    expect(a.total).toBe(1)
    expect(a.bySite.map((r) => r.name)).toEqual(['Chennai Depot'])
  })

  it('keeps the cascade whole when a site is chosen', () => {
    // The camera sits at s2; the DVR that darkened it sits at s1. Had the scope
    // been applied before the health pass, that DVR would have vanished and the
    // camera would read as an orphan with nothing wrong with it.
    const a = cctvDefectAnalytics({
      sites: SITES,
      merakis: [meraki()],
      dvrs: [dvr({ status: 'offline' })],
      cameras: [cam({ siteId: 's2', siteName: 'Chennai Depot' })],
      siteId: 's2',
    })
    expect(a.casualties.cameras).toBe(1)
    expect(kind(a, 'camera').value).toBe(0)
  })

  it('hides devices at sites the viewer cannot see', () => {
    const a = run({ merakis: [meraki({ siteId: 's9', status: 'offline' })], keepUnplaced: false })
    expect(a.total).toBe(0)
    expect(a.casualties.total).toBe(0)
  })

  it('shows an admin the same devices, labelled by what the record claims', () => {
    const a = run({
      merakis: [meraki({ siteId: 's9', siteName: 'Warehouse 4', status: 'offline' })],
      keepUnplaced: true,
    })
    expect(a.bySite.map((r) => r.name)).toEqual(['Warehouse 4'])
    expect(a.byRegion.map((r) => r.name)).toEqual(['Unassigned'])
  })

  it('says Unassigned when the record names no site either', () => {
    const a = run({ merakis: [meraki({ siteId: '', siteName: '', status: 'offline' })] })
    expect(a.bySite.map((r) => r.name)).toEqual(['Unassigned'])
  })
})

describe('the kind filter', () => {
  const estate = {
    merakis: [meraki({ id: 'm2', siteId: 's2', status: 'offline' })],
    dvrs: [dvr({ status: 'offline' })],
    cameras: [cam({ dvrId: 'none', defects: ['blocked'] })],
  }

  it('narrows the map and the breakdowns', () => {
    const a = run({ ...estate, kind: 'dvr' })
    expect(a.total).toBe(1)
    expect(a.byFault.map((f) => f.name)).toEqual(['DVR · Offline'])
    expect(a.pins[0].counts).toEqual({ meraki: 0, dvr: 1, camera: 0 })
  })

  it('leaves the per-kind counts alone, so there is a way back', () => {
    const a = run({ ...estate, kind: 'dvr' })
    expect(a.byKind.map((k) => k.value)).toEqual([1, 1, 1])
  })

  it('reports the fleet each count is drawn from', () => {
    const a = run(estate)
    expect(a.byKind.map((k) => k.fleet)).toEqual([1, 1, 1])
    expect(a.devices).toBe(3)
  })
})

describe('an empty estate', () => {
  it('returns zeroes rather than throwing', () => {
    const a = cctvDefectAnalytics({ sites: SITES })
    expect(a).toMatchObject({ total: 0, devices: 0, unmapped: 0, sitesAffected: 0 })
    expect(a.pins).toEqual([])
    expect(a.byFault).toEqual([])
    expect(a.casualties.total).toBe(0)
  })

  it('survives being called with nothing at all', () => {
    expect(cctvDefectAnalytics().total).toBe(0)
  })
})
