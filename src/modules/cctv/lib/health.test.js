import { describe, it, expect } from 'vitest'
import {
  merakiHealth, darkSites, dvrHealth, dvrHealthMap, cameraHealth, cameraHealthList,
  cameraSummary, dvrSummary, estateHealth,
} from './health'
import { STATUS, CAUSE } from './constants'

// A small estate: one site, one Meraki, two DVRs, four cameras.
const meraki = (over = {}) => ({ id: 'm1', name: 'MX-Hosur', ipAddress: '10.0.0.1', siteId: 's1', siteName: 'Hosur', status: 'online', ...over })
const dvr = (over = {}) => ({ id: 'd1', name: 'DVR-1', ipAddress: '10.0.0.10', siteId: 's1', siteName: 'Hosur', status: 'online', channels: 16, ...over })
const cam = (over = {}) => ({ id: 'c1', name: 'CAM-1', location: 'Main gate', dvrId: 'd1', siteId: 's1', siteName: 'Hosur', status: 'online', defects: [], ...over })

describe('merakiHealth', () => {
  it('is nothing but its own status — nothing sits above it', () => {
    expect(merakiHealth(meraki())).toMatchObject({ effective: STATUS.ONLINE, cause: CAUSE.NONE, working: true })
    expect(merakiHealth(meraki({ status: 'offline' }))).toMatchObject({ effective: STATUS.OFFLINE, cause: CAUSE.SELF, working: false })
  })

  it('normalises the words different systems use', () => {
    expect(merakiHealth(meraki({ status: 'UP' })).working).toBe(true)
    expect(merakiHealth(meraki({ status: 'Down' })).working).toBe(false)
  })

  // A row added before the device is commissioned must not tank the estate
  // health number, but it must not vanish either — see the `unknown` counts.
  it('treats an unreported status as working, not failed', () => {
    const h = merakiHealth(meraki({ status: '' }))
    expect(h.reported).toBe(STATUS.UNKNOWN)
    expect(h.working).toBe(true)
  })
})

describe('darkSites', () => {
  it('marks a site dark when its only Meraki is down', () => {
    expect(darkSites([meraki({ status: 'offline' })]).has('s1')).toBe(true)
  })

  it('leaves a site lit when a second Meraki still carries it', () => {
    const dark = darkSites([meraki({ status: 'offline' }), meraki({ id: 'm2', status: 'online' })])
    expect(dark.has('s1')).toBe(false)
  })

  it('goes dark only when EVERY Meraki at the site is down', () => {
    const dark = darkSites([meraki({ status: 'offline' }), meraki({ id: 'm2', status: 'offline' })])
    expect(dark.get('s1')).toMatchObject({ id: 'm1' })
  })

  it('ignores devices with no site', () => {
    expect(darkSites([meraki({ siteId: '', status: 'offline' })]).size).toBe(0)
  })
})

describe('dvrHealth', () => {
  it('is online when it and its site are fine', () => {
    expect(dvrHealth(dvr(), new Map())).toMatchObject({ working: true, cause: CAUSE.NONE })
  })

  // "if Meraki is offline then all DVR in the site of that meraki not work"
  it('goes dark when the site Meraki is down, even reporting itself online', () => {
    const h = dvrHealth(dvr(), darkSites([meraki({ status: 'offline' })]))
    expect(h).toMatchObject({ reported: STATUS.ONLINE, effective: STATUS.OFFLINE, cause: CAUSE.MERAKI, working: false })
    expect(h.blamedOn).toMatchObject({ kind: 'meraki', name: 'MX-Hosur' })
  })

  // Otherwise you fix the switch and find the DVR still dead.
  it('reports its OWN fault ahead of an upstream outage', () => {
    const h = dvrHealth(dvr({ status: 'offline' }), darkSites([meraki({ status: 'offline' })]))
    expect(h.cause).toBe(CAUSE.SELF)
    expect(h.blamedOn).toBeNull()
  })

  it('is unaffected by a Meraki at a different site', () => {
    const dark = darkSites([meraki({ id: 'm9', siteId: 's9', status: 'offline' })])
    expect(dvrHealth(dvr(), dark).working).toBe(true)
  })
})

describe('cameraHealth', () => {
  const map = (dvrs, merakis = [meraki()]) => dvrHealthMap(dvrs, merakis)

  it('is online when the whole chain is up', () => {
    expect(cameraHealth(cam(), map([dvr()]))).toMatchObject({ working: true, healthy: true, cause: CAUSE.NONE })
  })

  // "if DVR is Offline all camera in that DVR will not work"
  it('goes dark when its DVR is down, and blames the DVR', () => {
    const h = cameraHealth(cam(), map([dvr({ status: 'offline' })]))
    expect(h).toMatchObject({ effective: STATUS.OFFLINE, cause: CAUSE.DVR, working: false })
    expect(h.blamedOn).toMatchObject({ kind: 'dvr', name: 'DVR-1' })
  })

  // The whole reason this module exists: one switch must not read as N camera
  // faults, and the cause must survive two hops down the chain.
  it('blames the MERAKI, not the DVR, when the outage started upstream', () => {
    const h = cameraHealth(cam(), map([dvr()], [meraki({ status: 'offline' })]))
    expect(h.cause).toBe(CAUSE.MERAKI)
    expect(h.blamedOn).toMatchObject({ kind: 'meraki', name: 'MX-Hosur' })
  })

  it('reports its own fault ahead of anything upstream', () => {
    const h = cameraHealth(cam({ status: 'offline' }), map([dvr({ status: 'offline' })]))
    expect(h.cause).toBe(CAUSE.SELF)
  })

  it('derives the offline defect rather than trusting a stored one', () => {
    // A camera marked offline by hand while streaming: the flag is dropped.
    expect(cameraHealth(cam({ defects: ['offline'] }), map([dvr()])).defects).toEqual([])
    // And a genuinely dark camera gets it, whether or not it was stored.
    expect(cameraHealth(cam({ status: 'offline' }), map([dvr()])).defects).toContain('offline')
  })

  it('keeps visual defects on a camera that is streaming fine', () => {
    const h = cameraHealth(cam({ defects: ['blur', 'angle'] }), map([dvr()]))
    expect(h.working).toBe(true)
    expect(h.healthy).toBe(false)
    expect(h.observedDefects).toEqual(['blur', 'angle'])
  })

  it('flags a camera whose DVR is not in the inventory', () => {
    expect(cameraHealth(cam({ dvrId: 'ghost' }), map([dvr()])).orphan).toBe(true)
  })

  it('inherits site from the DVR when the camera has none', () => {
    expect(cameraHealth(cam({ siteId: '', siteName: '' }), map([dvr()])).siteName).toBe('Hosur')
  })
})

describe('cameraSummary', () => {
  const estate = (cams, dvrs = [dvr()], merakis = [meraki()]) => cameraSummary(cameraHealthList(cams, dvrs, merakis))

  it('counts the headline the user asked for', () => {
    const s = estate([cam(), cam({ id: 'c2' }), cam({ id: 'c3', status: 'offline' })])
    expect(s).toMatchObject({ total: 3, online: 2, offline: 1 })
    expect(s.uptime).toBeCloseTo(66.7, 1)
  })

  // A Meraki outage must be legible as ONE upstream problem.
  it('splits offline cameras by what is actually to blame', () => {
    const s = estate(
      [cam(), cam({ id: 'c2' }), cam({ id: 'c3', dvrId: 'd2' })],
      [dvr(), dvr({ id: 'd2', siteId: 's2', siteName: 'Pune', status: 'offline' })],
      [meraki({ status: 'offline' })]
    )
    expect(s.byCause[CAUSE.MERAKI]).toBe(2) // both on the darkened site
    expect(s.byCause[CAUSE.DVR]).toBe(1) // the one under the failed DVR
    expect(s.byCause[CAUSE.SELF]).toBe(0) // no camera is actually broken
  })

  // Invisible in an online/offline count, which is why it gets its own number.
  it('counts streaming-but-faulty cameras separately', () => {
    const s = estate([cam({ defects: ['blur'] }), cam({ id: 'c2' })])
    expect(s).toMatchObject({ online: 2, impaired: 1, healthy: 1 })
  })

  it('is 100% healthy with nothing to report', () => {
    expect(cameraSummary([])).toMatchObject({ total: 0, uptime: 100 })
  })
})

describe('dvrReport', () => {
  it('reports each DVR with how many of its cameras are up', () => {
    const { dvrReport: rows } = estateHealth({
      cameras: [cam(), cam({ id: 'c2', status: 'offline' }), cam({ id: 'c3', dvrId: 'd2' })],
      dvrs: [dvr(), dvr({ id: 'd2', name: 'DVR-2' })],
      merakis: [meraki()],
    })
    expect(rows.find((r) => r.id === 'd1')).toMatchObject({ cameras: 2, camerasOnline: 1, camerasOffline: 1 })
    expect(rows.find((r) => r.id === 'd2')).toMatchObject({ cameras: 1, camerasOnline: 1 })
  })

  it('shows a downed DVR with all its cameras dark', () => {
    const { dvrReport: rows } = estateHealth({
      cameras: [cam(), cam({ id: 'c2' })],
      dvrs: [dvr({ status: 'offline' })],
      merakis: [meraki()],
    })
    expect(rows[0]).toMatchObject({ working: false, cameras: 2, camerasOnline: 0, cameraUptime: 0 })
  })
})

describe('defect extraction keeps the three kinds apart', () => {
  // The core promise: a switch outage is one Meraki defect, not forty camera ones.
  it('does NOT list cameras darkened by an upstream outage as camera defects', () => {
    const e = estateHealth({
      cameras: [cam(), cam({ id: 'c2' }), cam({ id: 'c3' })],
      dvrs: [dvr()],
      merakis: [meraki({ status: 'offline' })],
    })
    expect(e.cameraSummary.offline).toBe(3)
    expect(e.defects.camera).toHaveLength(0)
    expect(e.defects.dvr).toHaveLength(0)
    expect(e.defects.meraki).toHaveLength(1)
    expect(e.defects.meraki[0]).toMatchObject({ name: 'MX-Hosur', defects: ['offline'] })
  })

  it('does not list cameras darkened by their DVR as camera defects', () => {
    const e = estateHealth({ cameras: [cam(), cam({ id: 'c2' })], dvrs: [dvr({ status: 'offline' })], merakis: [meraki()] })
    expect(e.defects.camera).toHaveLength(0)
    expect(e.defects.dvr).toHaveLength(1)
    expect(e.defects.dvr[0].defects).toContain('offline')
  })

  it('DOES list a camera that is genuinely broken', () => {
    const e = estateHealth({ cameras: [cam({ status: 'offline' }), cam({ id: 'c2' })], dvrs: [dvr()], merakis: [meraki()] })
    expect(e.defects.camera).toHaveLength(1)
    expect(e.defects.camera[0]).toMatchObject({ name: 'CAM-1', cause: CAUSE.SELF })
  })

  it('lists visual defects even while the camera streams', () => {
    const e = estateHealth({ cameras: [cam({ defects: ['blur', 'blocked'] })], dvrs: [dvr()], merakis: [meraki()] })
    expect(e.defects.camera[0].defects).toEqual(['blur', 'blocked'])
    expect(e.defects.camera[0].status).toBe(STATUS.ONLINE)
  })

  it('lists a DVR fault that is not an outage', () => {
    const e = estateHealth({ cameras: [], dvrs: [dvr({ defects: ['disk_full'] })], merakis: [meraki()] })
    expect(e.defects.dvr[0].defects).toEqual(['disk_full'])
  })

  it('lists a degraded Meraki that is still online', () => {
    const e = estateHealth({ cameras: [], dvrs: [], merakis: [meraki({ defects: ['degraded'] })] })
    expect(e.defects.meraki[0]).toMatchObject({ status: STATUS.ONLINE, defects: ['degraded'] })
  })

  it('reports nothing for a healthy estate', () => {
    const e = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki()] })
    expect(e.defects.camera).toHaveLength(0)
    expect(e.defects.dvr).toHaveLength(0)
    expect(e.defects.meraki).toHaveLength(0)
    expect(e.cameraSummary.uptime).toBe(100)
  })
})

describe('siteReport', () => {
  it('rolls up per site, worst first so the estate view leads with the problem', () => {
    const { siteReport: rows } = estateHealth({
      cameras: [cam(), cam({ id: 'c2', dvrId: 'd2', siteId: 's2', siteName: 'Pune' })],
      dvrs: [dvr(), dvr({ id: 'd2', siteId: 's2', siteName: 'Pune', status: 'offline' })],
      merakis: [meraki()],
    })
    expect(rows[0]).toMatchObject({ siteName: 'Pune', cameraUptime: 0 })
    expect(rows[1]).toMatchObject({ siteName: 'Hosur', cameraUptime: 100 })
  })

  it('counts all three device kinds against their site', () => {
    const [row] = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki()] }).siteReport
    expect(row).toMatchObject({ siteName: 'Hosur', cameras: 1, dvrs: 1, merakis: 1, merakisOnline: 1 })
  })
})

describe('estateHealth', () => {
  it('survives an empty estate', () => {
    const e = estateHealth()
    expect(e.cameraSummary.total).toBe(0)
    expect(e.siteReport).toEqual([])
  })

  it('computes every view from one pass', () => {
    const e = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki()] })
    expect(e.cameras).toHaveLength(1)
    expect(e.dvrReport[0].cameras).toBe(1)
    expect(e.merakiSummary.online).toBe(1)
  })
})

describe('dvrSummary', () => {
  it('separates DVRs that failed from DVRs that were darkened', () => {
    const dvrs = [dvr({ status: 'offline' }), dvr({ id: 'd2' })]
    const s = dvrSummary([...dvrHealthMap(dvrs, [meraki({ status: 'offline' })]).values()])
    expect(s).toMatchObject({ total: 2, online: 0, offline: 2 })
    expect(s.byCause[CAUSE.SELF]).toBe(1)
    expect(s.byCause[CAUSE.MERAKI]).toBe(1)
  })
})
