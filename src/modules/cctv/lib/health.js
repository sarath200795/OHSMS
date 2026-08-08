// ─────────────────────────────────────────────────────────────────────────────
// CCTV health, and why a camera is dark.
//
// The estate is a chain: a Meraki switch feeds a site, DVRs at that site record,
// and cameras hang off the DVRs. When something upstream dies, everything below
// it stops answering — so a naive count of "cameras not responding" reports one
// failed switch as forty failed cameras. That number then drives a technician
// visit per camera, and the actual fault stays unfixed.
//
// So every device gets two statuses:
//
//   reported   what the device itself last said
//   effective  whether it is actually working, once upstream is accounted for
//
// and every non-working device gets a CAUSE naming what to go and fix. A camera
// that is dark because its Meraki is down is `effective: offline, cause: meraki`
// and is deliberately NOT counted as a camera fault anywhere in this file.
//
// Pure and clock-free: pass the collections in, get plain objects out. Every
// rule below is a decision someone will one day dispute in a review meeting, so
// each is testable on its own.
// ─────────────────────────────────────────────────────────────────────────────

import { STATUS, CAUSE, healthBand } from './constants'

const norm = (s) => {
  const v = String(s ?? '').trim().toLowerCase()
  if (v === 'online' || v === 'up' || v === 'active') return STATUS.ONLINE
  if (v === 'offline' || v === 'down' || v === 'inactive') return STATUS.OFFLINE
  return STATUS.UNKNOWN
}

/**
 * Unknown counts as working.
 *
 * A device that has never checked in is not evidence of a fault, and treating
 * silence as failure would make the health number swing every time someone adds
 * a row to the inventory before the device is commissioned. Unknown is surfaced
 * separately in the roll-ups so it cannot hide.
 */
const isDown = (status) => norm(status) === STATUS.OFFLINE

// ── Meraki ───────────────────────────────────────────────────────────────────

/** Meraki devices are top of the chain: nothing upstream can darken them. */
export function merakiHealth(meraki) {
  const reported = norm(meraki?.status)
  const down = isDown(reported)
  return {
    id: meraki?.id,
    name: meraki?.name || meraki?.deviceId || 'Meraki',
    ipAddress: meraki?.ipAddress || '',
    siteId: meraki?.siteId || '',
    siteName: meraki?.siteName || '',
    reported,
    effective: down ? STATUS.OFFLINE : reported,
    cause: down ? CAUSE.SELF : CAUSE.NONE,
    working: !down,
  }
}

/**
 * Which sites are dark because their Meraki is down.
 *
 * A site with two Merakis where one is down is NOT dark — the other still
 * carries it. Only a site whose every Meraki is offline goes dark, which is
 * what "if Meraki is offline then all DVR in the site of that meraki not work"
 * means once a site has more than one.
 *
 * @returns Map<siteId, merakiHealth> — the Meraki to blame for that site
 */
export function darkSites(merakis = []) {
  const bySite = new Map()
  for (const m of merakis) {
    const h = merakiHealth(m)
    if (!h.siteId) continue
    const entry = bySite.get(h.siteId) || { total: 0, down: 0, culprit: null }
    entry.total += 1
    if (!h.working) {
      entry.down += 1
      entry.culprit = entry.culprit || h
    }
    bySite.set(h.siteId, entry)
  }
  const dark = new Map()
  for (const [siteId, e] of bySite) {
    if (e.total > 0 && e.down === e.total) dark.set(siteId, e.culprit)
  }
  return dark
}

// ── DVR ──────────────────────────────────────────────────────────────────────

/**
 * A DVR's effective status.
 *
 * Its own fault wins over an upstream outage: if the DVR is itself offline that
 * is what a technician needs to know, even if the Meraki above it is also down.
 * Reporting it as "Meraki down" would mean fixing the switch and finding the
 * DVR still dead.
 */
export function dvrHealth(dvr, dark = new Map()) {
  const reported = norm(dvr?.status)
  const siteId = dvr?.siteId || ''
  const ownFault = isDown(reported)
  const upstream = !ownFault && dark.has(siteId) ? dark.get(siteId) : null

  return {
    id: dvr?.id,
    name: dvr?.name || dvr?.dvrId || 'DVR',
    ipAddress: dvr?.ipAddress || '',
    siteId,
    siteName: dvr?.siteName || '',
    channels: Number(dvr?.channels) || 0,
    reported,
    effective: ownFault || upstream ? STATUS.OFFLINE : reported,
    cause: ownFault ? CAUSE.SELF : upstream ? CAUSE.MERAKI : CAUSE.NONE,
    blamedOn: upstream ? { kind: 'meraki', id: upstream.id, name: upstream.name } : null,
    working: !ownFault && !upstream,
  }
}

/** DVR health for the whole estate, keyed by id for the camera pass. */
export function dvrHealthMap(dvrs = [], merakis = []) {
  const dark = darkSites(merakis)
  return new Map(dvrs.map((d) => [d.id, dvrHealth(d, dark)]))
}

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * A camera's effective status, and what to actually go and fix.
 *
 * Precedence is deliberate and runs nearest-first: the camera's own fault, then
 * its DVR, then the Meraki above that. Whatever is nearest to the camera is what
 * a technician touches first.
 *
 * A camera whose DVR is missing from the inventory is treated as its own
 * problem rather than silently online — an orphaned camera is a data fault
 * someone needs to see, not a device to quietly assume is fine.
 */
export function cameraHealth(camera, dvrMap = new Map()) {
  const reported = norm(camera?.status)
  const ownFault = isDown(reported)
  const dvr = camera?.dvrId ? dvrMap.get(camera.dvrId) : null
  const orphan = Boolean(camera?.dvrId) && !dvr

  let effective = reported
  let cause = CAUSE.NONE
  let blamedOn = null

  if (ownFault) {
    effective = STATUS.OFFLINE
    cause = CAUSE.SELF
  } else if (dvr && !dvr.working) {
    effective = STATUS.OFFLINE
    // Inherit the DVR's own reason, so a camera under a Meraki-darkened DVR
    // reads "Meraki down" rather than "DVR down" — otherwise fixing the DVR
    // becomes the recommended action for an untouched DVR.
    cause = dvr.cause === CAUSE.MERAKI ? CAUSE.MERAKI : CAUSE.DVR
    blamedOn =
      dvr.cause === CAUSE.MERAKI
        ? { kind: 'meraki', id: dvr.blamedOn?.id, name: dvr.blamedOn?.name }
        : { kind: 'dvr', id: dvr.id, name: dvr.name }
  }

  // Observed defects are independent of connectivity: a camera can stream
  // perfectly and still be pointed at a wall. `offline` is derived here rather
  // than stored, so nothing can claim a streaming camera is offline.
  const observed = (Array.isArray(camera?.defects) ? camera.defects : []).filter(
    (d) => d && d !== 'offline'
  )
  const defects = effective === STATUS.OFFLINE ? ['offline', ...observed] : observed

  return {
    id: camera?.id,
    name: camera?.name || camera?.cameraId || 'Camera',
    location: camera?.location || '',
    dvrId: camera?.dvrId || '',
    dvrName: dvr?.name || '',
    siteId: camera?.siteId || dvr?.siteId || '',
    siteName: camera?.siteName || dvr?.siteName || '',
    reported,
    effective,
    cause,
    blamedOn,
    orphan,
    defects,
    observedDefects: observed,
    // "Working" means streaming. A blurred camera is online but not healthy —
    // both facts matter and neither should be folded into the other.
    working: effective !== STATUS.OFFLINE,
    healthy: effective !== STATUS.OFFLINE && observed.length === 0,
  }
}

/** Camera health for the whole estate. */
export function cameraHealthList(cameras = [], dvrs = [], merakis = []) {
  const dvrMap = dvrHealthMap(dvrs, merakis)
  return cameras.map((c) => cameraHealth(c, dvrMap))
}

// ── Roll-ups ─────────────────────────────────────────────────────────────────

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 100)

/**
 * The headline the user asked for: how many cameras, how many online, and what
 * that means — with the offline count split by what is actually to blame.
 */
export function cameraSummary(healths = []) {
  const total = healths.length
  const online = healths.filter((c) => c.working).length
  const offline = total - online
  const byCause = {
    [CAUSE.SELF]: healths.filter((c) => !c.working && c.cause === CAUSE.SELF).length,
    [CAUSE.DVR]: healths.filter((c) => !c.working && c.cause === CAUSE.DVR).length,
    [CAUSE.MERAKI]: healths.filter((c) => !c.working && c.cause === CAUSE.MERAKI).length,
  }
  const uptime = pct(online, total)
  return {
    total,
    online,
    offline,
    byCause,
    // Cameras that are streaming but visually faulty — invisible in an
    // online/offline count, which is exactly why they get their own number.
    impaired: healths.filter((c) => c.working && c.observedDefects.length > 0).length,
    healthy: healths.filter((c) => c.healthy).length,
    unknown: healths.filter((c) => c.reported === STATUS.UNKNOWN).length,
    orphans: healths.filter((c) => c.orphan).length,
    uptime,
    band: healthBand(uptime),
  }
}

export function dvrSummary(healths = []) {
  const total = healths.length
  const online = healths.filter((d) => d.working).length
  const uptime = pct(online, total)
  return {
    total,
    online,
    offline: total - online,
    byCause: {
      [CAUSE.SELF]: healths.filter((d) => !d.working && d.cause === CAUSE.SELF).length,
      [CAUSE.MERAKI]: healths.filter((d) => !d.working && d.cause === CAUSE.MERAKI).length,
    },
    unknown: healths.filter((d) => d.reported === STATUS.UNKNOWN).length,
    uptime,
    band: healthBand(uptime),
  }
}

export function merakiSummary(healths = []) {
  const total = healths.length
  const online = healths.filter((m) => m.working).length
  const uptime = pct(online, total)
  return {
    total,
    online,
    offline: total - online,
    unknown: healths.filter((m) => m.reported === STATUS.UNKNOWN).length,
    uptime,
    band: healthBand(uptime),
  }
}

/**
 * Per-DVR report: how many of its cameras are actually up.
 *
 * When the DVR itself is down its cameras are all dark, so the camera counts
 * are reported but the DVR's own status is what the row is really about.
 */
export function dvrReport(dvrHealths = [], cameraHealths = []) {
  const byDvr = new Map()
  for (const c of cameraHealths) {
    if (!c.dvrId) continue
    const e = byDvr.get(c.dvrId) || { total: 0, online: 0, impaired: 0 }
    e.total += 1
    if (c.working) e.online += 1
    if (c.working && c.observedDefects.length) e.impaired += 1
    byDvr.set(c.dvrId, e)
  }
  return dvrHealths.map((d) => {
    const c = byDvr.get(d.id) || { total: 0, online: 0, impaired: 0 }
    const uptime = pct(c.online, c.total)
    return {
      ...d,
      cameras: c.total,
      camerasOnline: c.online,
      camerasOffline: c.total - c.online,
      camerasImpaired: c.impaired,
      cameraUptime: uptime,
      band: healthBand(uptime),
    }
  })
}

/** Site roll-up, for the estate view. */
export function siteReport(cameraHealths = [], dvrHealths = [], merakiHealths = []) {
  const sites = new Map()
  const touch = (id, name) => {
    if (!sites.has(id)) {
      sites.set(id, {
        siteId: id, siteName: name || '—',
        cameras: 0, camerasOnline: 0, dvrs: 0, dvrsOnline: 0, merakis: 0, merakisOnline: 0,
      })
    }
    return sites.get(id)
  }
  for (const m of merakiHealths) {
    const s = touch(m.siteId, m.siteName)
    s.merakis += 1
    if (m.working) s.merakisOnline += 1
  }
  for (const d of dvrHealths) {
    const s = touch(d.siteId, d.siteName)
    s.dvrs += 1
    if (d.working) s.dvrsOnline += 1
  }
  for (const c of cameraHealths) {
    const s = touch(c.siteId, c.siteName)
    s.cameras += 1
    if (c.working) s.camerasOnline += 1
  }
  return [...sites.values()]
    .map((s) => {
      const uptime = pct(s.camerasOnline, s.cameras)
      return { ...s, cameraUptime: uptime, band: healthBand(uptime) }
    })
    .sort((a, b) => a.cameraUptime - b.cameraUptime)
}

// ── Defect extraction ────────────────────────────────────────────────────────
//
// Kept separate per device kind, because that is the whole point: one Meraki
// outage must appear as ONE Meraki defect, not as the hundred cameras it
// happens to have darkened.

/**
 * Camera defects worth a technician's time.
 *
 * A camera dark because of an upstream outage is excluded — it is not faulty,
 * and listing it here is how a work order gets raised against equipment that
 * turns out to be fine.
 */
export function cameraDefects(healths = []) {
  return healths
    .filter((c) => (c.cause === CAUSE.SELF && !c.working) || c.observedDefects.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location,
      siteName: c.siteName,
      dvrName: c.dvrName,
      status: c.effective,
      defects: c.cause === CAUSE.SELF && !c.working ? c.defects : c.observedDefects,
      cause: c.cause,
    }))
}

export function dvrDefects(dvrHealths = [], dvrs = []) {
  const raw = new Map(dvrs.map((d) => [d.id, d]))
  return dvrHealths
    .filter((d) => {
      const observed = (raw.get(d.id)?.defects || []).filter((x) => x && x !== 'offline')
      return (d.cause === CAUSE.SELF && !d.working) || observed.length > 0
    })
    .map((d) => {
      const observed = (raw.get(d.id)?.defects || []).filter((x) => x && x !== 'offline')
      return {
        id: d.id,
        name: d.name,
        ipAddress: d.ipAddress,
        siteName: d.siteName,
        status: d.effective,
        defects: d.cause === CAUSE.SELF && !d.working ? ['offline', ...observed] : observed,
        cause: d.cause,
      }
    })
}

export function merakiDefects(merakiHealths = [], merakis = []) {
  const raw = new Map(merakis.map((m) => [m.id, m]))
  return merakiHealths
    .filter((m) => {
      const observed = (raw.get(m.id)?.defects || []).filter((x) => x && x !== 'offline')
      return !m.working || observed.length > 0
    })
    .map((m) => {
      const observed = (raw.get(m.id)?.defects || []).filter((x) => x && x !== 'offline')
      return {
        id: m.id,
        name: m.name,
        ipAddress: m.ipAddress,
        siteName: m.siteName,
        status: m.effective,
        defects: m.working ? observed : ['offline', ...observed],
        cause: m.cause,
      }
    })
}

/** Everything a dashboard needs, computed once. */
export function estateHealth({ cameras = [], dvrs = [], merakis = [] } = {}) {
  const merakiHealths = merakis.map(merakiHealth)
  const dark = darkSites(merakis)
  const dvrHealths = dvrs.map((d) => dvrHealth(d, dark))
  const dvrMap = new Map(dvrHealths.map((d) => [d.id, d]))
  const cameraHealths = cameras.map((c) => cameraHealth(c, dvrMap))

  return {
    cameras: cameraHealths,
    dvrs: dvrHealths,
    merakis: merakiHealths,
    cameraSummary: cameraSummary(cameraHealths),
    dvrSummary: dvrSummary(dvrHealths),
    merakiSummary: merakiSummary(merakiHealths),
    dvrReport: dvrReport(dvrHealths, cameraHealths),
    siteReport: siteReport(cameraHealths, dvrHealths, merakiHealths),
    defects: {
      camera: cameraDefects(cameraHealths),
      dvr: dvrDefects(dvrHealths, dvrs),
      meraki: merakiDefects(merakiHealths, merakis),
    },
  }
}
