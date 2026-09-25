// Every six hours, mail each org's admins the High and Medium weather risk
// across that org's sites, grouped by region, with a static map of the pins.
//
// There is no stored weather collection. The screen reads Open-Meteo in the
// browser (src/modules/weather). This run does the same request from the
// function, assesses it with the same bands (weatherBands.js), and sends
// only the elevated areas. Low and none are omitted. A failed read is not
// reported as "no risk": if nothing could be read, nobody is mailed, and the
// ledger is not claimed, so the next window tries again.
//
// When no site is High or Medium, the run sends nothing and writes no ledger
// row. It does not send a no-risk note. A calm day would otherwise be a mail
// every window, and the next window is a new bucket, so the ledger would not
// collapse them into one.
//
// Recipients are approved, active profiles with role === 'admin', one row per
// mailbox (selectAdminAudience). selectActiveAudience is every approved
// member; this mail used to call that. The product stores one admin role. A
// site, region or entity grant on a manager or member is not an admin role,
// and those profiles are not recipients. There is no separate site-admin
// role to add.
//
// A site with no coordinates cannot be assessed, so it is not High or Medium.
// It is left off the map and out of the tables. It is not described as clear.
// A row that does carry a level is still in the table when it has no
// coordinates to pin.
//
// The map is a PNG composited from OpenStreetMap tiles (weatherMap.js) and
// attached inline by Content-ID. Coordinates are not written into the text
// or the HTML; they are drawn on that image. A tile failure does not skip
// the mail: the tables still go, and the ledger is claimed for the text.
// Throwing would drop the whole window, and this schedule does not retry.
//
// The ledger key is the UTC six-hour bucket of the schedule time, not the
// clock when a retry happens to run and not the Cloud Functions event id.
// 00:00, 06:00, 12:00 and 18:00 UTC are the windows `0 */6 * * *` fires.
import { selectAdminAudience, loadOrgUsers } from './audience.js'
import { describeMailGap } from './mailer.js'
import { circulate } from './circulate.js'
import { assessWeather, digestLevel, digestHazards, digestDrivers } from './weatherBands.js'
import { gridKey, fetchObservation } from './openMeteo.js'
import { loadOrgDisplayName, mailSenderName } from './mailBrand.js'
import { readableText } from './mailTemplates/safe.js'
import { renderWeatherDigest, DIGEST_AREA_CAP } from './mailTemplates/lifecycle.js'
import { renderRiskMap, pinsFromAreas, MAP_CID } from './weatherMap.js'

// Distinct grid squares per org per run. Open-Meteo's free tier is metered,
// and two sites in the same ~1 km square already share one request.
export const WEATHER_GRID_CAP = 80

export function coord(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** `YYYY-MM-DDTHH` with HH at 00, 06, 12 or 18 UTC. */
export function weatherBucket(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const hour = Math.floor(d.getUTCHours() / 6) * 6
  const pad = String(hour).padStart(2, '0')
  return `${d.toISOString().slice(0, 10)}T${pad}`
}

/**
 * The bucket of the scheduled instant. A retry an hour later still names the
 * window that was supposed to run, so it claims the same rows.
 */
export function bucketFromSchedule(scheduleTime, now = new Date()) {
  if (scheduleTime) {
    const scheduled = weatherBucket(new Date(scheduleTime))
    if (scheduled) return scheduled
  }
  return weatherBucket(now)
}

/** `2026-09-23T06` → `2026-09-23 06:00-12:00 UTC`. Empty when the bucket is not one. */
export function bucketWindowLabel(bucket) {
  const match = /^(\d{4}-\d{2}-\d{2})T(00|06|12|18)$/.exec(bucket || '')
  if (!match) return ''
  const start = Number(match[2])
  const end = start + 6
  const endLabel = String(end).padStart(2, '0')
  return `${match[1]} ${match[2]}:00-${endLabel}:00 UTC`
}

const LEVEL_RANK = { High: 0, Medium: 1 }

/**
 * Region-wise High and Medium areas. Sites that share a grid square share
 * one observation. `fetchObs(lat, lng)` returns a normalised observation or
 * null. Unreadable sites are counted, not described as clear.
 */
export async function collectDigest(sites, fetchObs) {
  const located = []
  for (const site of sites || []) {
    if (!site || site.deletedAt) continue
    const lat = coord(site.lat)
    const lng = coord(site.lng)
    const key = lat == null ? '' : gridKey(lat, lng)
    if (!key) continue
    located.push({ site, key })
  }

  const byGrid = new Map()
  for (const row of located) {
    if (!byGrid.has(row.key)) byGrid.set(row.key, [])
    byGrid.get(row.key).push(row.site)
  }

  const keys = [...byGrid.keys()]
  const droppedGrids = Math.max(0, keys.length - WEATHER_GRID_CAP)
  const used = keys.slice(0, WEATHER_GRID_CAP)
  let unread = 0
  if (droppedGrids) {
    for (const key of keys.slice(WEATHER_GRID_CAP)) unread += byGrid.get(key).length
  }

  const areas = []
  for (const key of used) {
    const [lat, lng] = key.split(',').map(Number)
    const obs = await fetchObs(lat, lng)
    const group = byGrid.get(key)
    if (!obs) {
      unread += group.length
      continue
    }
    const assessment = assessWeather(obs)
    const level = digestLevel(assessment.band)
    if (!level) continue
    const hazards = digestHazards(assessment).join(', ')
    const drivers = digestDrivers(assessment).map((driver) => ({
      key: driver.key,
      label: readableText(driver.label),
      value: readableText(driver.value),
    }))
    const observedAt = readableText(obs.observedAt)
    for (const site of group) {
      areas.push({
        region: readableText(site.region) || 'Unassigned',
        entity: readableText(site.entity) || '',
        name: readableText(site.name) || readableText(site.code) || 'Unnamed site',
        level,
        hazards,
        drivers,
        observedAt,
        // The pin is the site, not the ~1 km square the forecast was fetched
        // for. The request stays rounded; the picture does not have to.
        lat: coord(site.lat),
        lng: coord(site.lng),
      })
    }
  }

  areas.sort(
    (a, b) =>
      (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) ||
      a.region.localeCompare(b.region) ||
      a.name.localeCompare(b.name)
  )
  return { areas, unread, located: located.length }
}

export async function deliverWeatherDigest({
  db,
  mailer,
  logger,
  now = () => new Date(),
  scheduleTime,
  fetchObs = fetchObservation,
  renderMap = renderRiskMap,
  orgIds,
}) {
  const bucket = bucketFromSchedule(scheduleTime, now())
  if (!bucket) return { orgs: 0, sent: 0, skipped: 0, failed: 0, reason: 'no-bucket' }

  const log = logger || { info() {}, error() {} }
  const missing = describeMailGap(mailer?.config)
  if (missing.length) {
    log.error('weather digest mail is not configured', { missing, bucket })
    return { orgs: 0, sent: 0, skipped: 0, failed: 0, reason: 'not-configured', bucket }
  }
  const knownNames = new Map()
  let orgList = orgIds
  if (!orgList) {
    const snap = await db.collection('organizations').get()
    orgList = []
    for (const docSnap of snap.docs) {
      if (!docSnap.id || String(docSnap.id).includes('/')) continue
      orgList.push(docSnap.id)
      const data = typeof docSnap.data === 'function' ? docSnap.data() : null
      knownNames.set(docSnap.id, mailSenderName(data?.name))
    }
  }

  let sent = 0
  let skipped = 0
  let failed = 0
  let mailedOrgs = 0
  // One org's tiles are the same squares as the next org's when the plants
  // sit in the same city. The cache lives for this run only.
  const tileCache = new Map()

  for (const orgId of orgList) {
    if (!orgId || String(orgId).includes('/')) continue
    const siteSnap = await db.collection(`organizations/${orgId}/sites`).get()
    const sites = siteSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
    const digest = await collectDigest(sites, fetchObs)
    if (!digest.areas.length) {
      log.info('weather digest had nothing to send', {
        orgId,
        bucket,
        located: digest.located,
        unread: digest.unread,
      })
      continue
    }
    const users = await loadOrgUsers(db, orgId)
    const recipients = selectAdminAudience(users, orgId)
    if (!recipients.length) continue
    const origin = mailer?.config?.appOrigin || ''
    const sender = knownNames.has(orgId)
      ? knownNames.get(orgId)
      : await loadOrgDisplayName(db, orgId)
    const pins = pinsFromAreas(digest.areas.slice(0, DIGEST_AREA_CAP))
    let mapCid = ''
    let attachments = []
    if (pins.length && typeof renderMap === 'function') {
      try {
        const rendered = await renderMap(pins, { cache: tileCache })
        if (rendered?.png && Buffer.isBuffer(rendered.png) && rendered.png.length) {
          mapCid = MAP_CID
          attachments = [
            {
              filename: 'weather-risk-map.png',
              content: rendered.png,
              cid: MAP_CID,
            },
          ]
        }
      } catch (err) {
        // The tables are the mail. A tile outage must not swallow the window:
        // this schedule's retryCount is 0, so a throw here is a missed digest.
        log.error('weather digest map failed', {
          orgId,
          bucket,
          error: err?.message || 'map-failed',
        })
      }
    }
    const message = renderWeatherDigest(digest, {
      appOrigin: origin,
      sender,
      mapCid,
      windowLabel: bucketWindowLabel(bucket),
    })
    const result = await circulate({
      db,
      orgId,
      recipients,
      kind: 'weather.digest',
      keyFor: (recipient) => ['weather.digest', orgId, bucket, recipient.uid],
      messageFor: () => message,
      mailer,
      logger,
      now,
      logLabel: 'weather digest',
      context: { bucket },
      attachments,
    })
    sent += result.sent
    skipped += result.skipped
    failed += result.failed
    if (result.sent) mailedOrgs += 1
  }

  return { orgs: mailedOrgs, sent, skipped, failed, bucket }
}
