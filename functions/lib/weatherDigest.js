// Every six hours, mail each org's approved members the High and Medium
// weather risk across that org's sites, grouped by region.
//
// There is no stored weather collection. The screen reads Open-Meteo in the
// browser (src/modules/weather). This run does the same request from the
// function, assesses it with the same bands (weatherBands.js), and sends
// only the elevated areas. Low and none are omitted. A failed read is not
// reported as "no risk": if nothing could be read, nobody is mailed, and the
// ledger is not claimed, so the next window tries again.
//
// "All active users" is every approved, addressed, non-suspended member of
// the organization that owns the sites. It is not a cross-tenant blast: a
// digest that named another org's plants would publish their sites. It is
// wider than the in-app weather page, which only shows sites the viewer can
// reach. That widening is the request. Coordinates are not in the body.
//
// The ledger key is the UTC six-hour bucket of the schedule time, not the
// clock when a retry happens to run and not the Cloud Functions event id.
// 00:00, 06:00, 12:00 and 18:00 UTC are the windows `0 */6 * * *` fires.
import { selectActiveAudience, loadOrgUsers } from './audience.js'
import { describeMailGap } from './mailer.js'
import { circulate } from './circulate.js'
import { assessWeather, digestLevel, digestHazards } from './weatherBands.js'
import { gridKey, fetchObservation } from './openMeteo.js'
import { readableText } from './mailTemplates/safe.js'
import { renderWeatherDigest } from './mailTemplates/lifecycle.js'

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
    for (const site of group) {
      areas.push({
        region: readableText(site.region) || 'Unassigned',
        name: readableText(site.name) || readableText(site.code) || 'Unnamed site',
        level,
        hazards,
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
  let orgList = orgIds
  if (!orgList) {
    const snap = await db.collection('organizations').get()
    orgList = snap.docs.map((d) => d.id).filter(Boolean)
  }

  let sent = 0
  let skipped = 0
  let failed = 0
  let mailedOrgs = 0

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
    const recipients = selectActiveAudience(users, orgId)
    if (!recipients.length) continue
    const origin = mailer?.config?.appOrigin || ''
    const message = renderWeatherDigest(digest, { appOrigin: origin })
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
    })
    sent += result.sent
    skipped += result.skipped
    failed += result.failed
    if (result.sent) mailedOrgs += 1
  }

  return { orgs: mailedOrgs, sent, skipped, failed, bucket }
}
