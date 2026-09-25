// Every six hours, mail each org's admins the High and Medium weather risk
// across that org's sites, grouped by region, with a static map of the pins.
//
// There is no stored weather collection. The screen reads Open-Meteo in the
// browser (src/modules/weather). This run does the same request from the
// function, assesses it with the same bands (weatherBands.js), and sends
// only the elevated areas. Low and none are omitted. A failed read is not
// reported as "no risk". The mail waits until every located site has a
// reading. If some are still missing 50 minutes into the slot, one mail goes
// anyway and names them. The ledger key is the slot, so that fallback is not
// followed by a second copy when a later tick finally gets the reading.
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
// The ledger key is the Asia/Kolkata six-hour slot (`YYYY-MM-DDTHH+0530`),
// not the Cloud Functions event id and not a UTC hour floor. Flooring UTC
// hours made 00:00 IST (18:30 UTC) the same key as 18:00 UTC, so the midnight
// mail after the old 23:30 IST run would have been skipped as already sent.
// A retry of a slot that has started reuses that slot. Cloud Scheduler gives
// a forced run the NEXT cron instant as scheduleTime; trusting it filed a
// 15:16 IST force under the following window and suppressed that run.
import { selectAdminAudience, loadOrgUsers } from './audience.js'
import { describeMailGap } from './mailer.js'
import { circulate } from './circulate.js'
import { assessWeather, digestLevel, digestHazards, digestDrivers } from './weatherBands.js'
import { gridKey, fetchGrids } from './openMeteo.js'
import { loadOrgDisplayName, mailSenderName } from './mailBrand.js'
import { readableText } from './mailTemplates/safe.js'
import { renderWeatherDigest, DIGEST_AREA_CAP } from './mailTemplates/lifecycle.js'
import { renderRiskMap, pinsFromAreas, MAP_CID } from './weatherMap.js'

// Fifty minutes is inside the 45–60 minute window a partial picture is allowed
// to stand in. Earlier ticks keep the missing grids and do not mail.
export const DIGEST_FALLBACK_MS = 50 * 60 * 1000

// A run still inside this window owns the slot. The follow-up cron is ten
// minutes later, so a dead invocation is visible to the next one, and a live
// one refreshes updatedAt after each batch so the two do not fetch together.
const RUN_LOCK_MS = 4 * 60 * 1000
const RUN_BUDGET_MS = 8 * 60 * 1000

export function coord(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

// Asia/Kolkata is UTC+05:30 all year. Shifting by that offset and reading the
// UTC fields is the civil clock, with no DST table and no Intl dependency.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

// A start a few seconds before the slot still belongs to that slot. Ninety
// seconds is the whole allowance: a force two minutes early stays on the
// window already open instead of taking the next one.
const SCHEDULE_EARLY_MS = 90 * 1000

/** `YYYY-MM-DDTHH+0530` with HH at 00, 06, 12 or 18 Asia/Kolkata. */
export function weatherBucket(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const hour = Math.floor(ist.getUTCHours() / 6) * 6
  const pad = String(hour).padStart(2, '0')
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const day = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}T${pad}+0530`
}

/**
 * The open slot, or the scheduled instant when that instant has already
 * arrived (a retry). A scheduleTime still ahead is the next cron slot, which
 * a forced run is given; claiming it suppresses the real run of that slot.
 */
export function bucketFromSchedule(scheduleTime, now = new Date()) {
  const clock = now instanceof Date ? now : new Date(now)
  const clockMs = clock.getTime()
  if (scheduleTime && Number.isFinite(clockMs)) {
    const scheduled = new Date(scheduleTime)
    const scheduledMs = scheduled.getTime()
    if (Number.isFinite(scheduledMs) && scheduledMs <= clockMs + SCHEDULE_EARLY_MS) {
      const bucket = weatherBucket(scheduled)
      if (bucket) return bucket
    }
  }
  return weatherBucket(clock)
}

/** `2026-09-23T06+0530` → `2026-09-23 06:00-12:00 IST`. Empty when the bucket is not one. */
export function bucketWindowLabel(bucket) {
  const match = /^(\d{4}-\d{2}-\d{2})T(00|06|12|18)\+0530$/.exec(bucket || '')
  if (!match) return ''
  const start = Number(match[2])
  const end = start + 6
  const endLabel = String(end).padStart(2, '0')
  return `${match[1]} ${match[2]}:00-${endLabel}:00 IST`
}

const LEVEL_RANK = { High: 0, Medium: 1 }

/** `2026-09-26T00+0530` → 00:00 that day in Asia/Kolkata, as epoch ms. */
export function slotStartMs(bucket) {
  const match = /^(\d{4}-\d{2}-\d{2})T(00|06|12|18)\+0530$/.exec(bucket || '')
  if (!match) return NaN
  const [year, month, day] = match[1].split('-').map(Number)
  const hour = Number(match[2])
  return Date.UTC(year, month - 1, day, hour, 0, 0) - IST_OFFSET_MS
}

function siteLabel(site) {
  return readableText(site?.name) || readableText(site?.code) || 'Unnamed site'
}

/**
 * Located sites share a forecast when they fall in the same ~1 km square.
 * A site with no usable coordinates is counted and not fetched: it cannot
 * block the mail, and it is not described as clear.
 */
export function planSites(sites) {
  const byGrid = new Map()
  let located = 0
  let unlocated = 0
  for (const site of sites || []) {
    if (!site || site.deletedAt) continue
    const lat = coord(site.lat)
    const lng = coord(site.lng)
    const key = lat == null ? '' : gridKey(lat, lng)
    if (!key) {
      unlocated += 1
      continue
    }
    located += 1
    if (!byGrid.has(key)) byGrid.set(key, [])
    byGrid.get(key).push(site)
  }
  return { byGrid, located, unlocated }
}

/**
 * Region-wise High and Medium areas. `observations` is grid key → reading.
 * A key with no reading is unread, not low. Low and none are omitted.
 */
export function assembleDigest(plan, observations) {
  const areas = []
  const unreadSites = []
  let unread = 0
  for (const [key, group] of plan.byGrid) {
    const obs = observations.get(key)
    if (!obs) {
      unread += group.length
      for (const site of group) unreadSites.push(siteLabel(site))
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
        name: siteLabel(site),
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
  unreadSites.sort((a, b) => a.localeCompare(b))
  return {
    areas,
    unread,
    unreadSites,
    located: plan.located,
    unlocated: plan.unlocated,
    checked: plan.located - unread,
    complete: unread === 0,
  }
}

/** `fetchObs(lat, lng)` → reading or null. Every grid is asked; none are dropped. */
export async function collectDigest(sites, fetchObs) {
  const plan = planSites(sites)
  const observations = new Map()
  for (const key of plan.byGrid.keys()) {
    const [lat, lng] = key.split(',').map(Number)
    const obs = await fetchObs(lat, lng)
    if (obs) observations.set(key, obs)
  }
  return assembleDigest(plan, observations)
}

function storedObservations(data) {
  const map = new Map()
  const rows = Array.isArray(data?.observations) ? data.observations : []
  for (const row of rows) {
    if (row && typeof row.key === 'string' && row.obs && typeof row.obs === 'object') {
      map.set(row.key, row.obs)
    }
  }
  return map
}

function serialiseObservations(map) {
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, obs]) => {
      const plain = {}
      for (const [field, value] of Object.entries(obs || {})) {
        if (typeof value === 'number' && Number.isFinite(value)) plain[field] = value
        else if (typeof value === 'string' && value.trim()) plain[field] = value.trim()
      }
      return { key, obs: plain }
    })
}

function runRef(db, orgId, bucket) {
  return db.doc(`organizations/${orgId}/weatherDigestRuns/${bucket}`)
}

async function claimRun(db, orgId, bucket, nowMs) {
  const ref = runRef(db, orgId, bucket)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() || {} : {}
    if (data.status === 'sent') return { action: 'done', data }
    const updated = Number(data.updatedAt) || 0
    if (data.status === 'fetching' && nowMs - updated < RUN_LOCK_MS) {
      return { action: 'busy', data }
    }
    const startedAt = Number(data.startedAt) || nowMs
    tx.set(ref, { status: 'fetching', bucket, startedAt, updatedAt: nowMs }, { merge: true })
    return { action: 'go', data: { ...data, startedAt } }
  })
}

function pointsFor(keys) {
  return keys.map((key) => {
    const [lat, lng] = key.split(',').map(Number)
    return { key, lat, lng }
  })
}

async function readGrids(keys, fetchObs, fetchGridsImpl, clock, ref) {
  if (!keys.length) return new Map()
  const until = clock() + RUN_BUDGET_MS
  if (fetchObs) {
    const observations = new Map()
    for (const key of keys) {
      if (clock() >= until) break
      const [lat, lng] = key.split(',').map(Number)
      const obs = await fetchObs(lat, lng)
      if (obs) observations.set(key, obs)
      await ref.set({ updatedAt: clock() }, { merge: true })
    }
    return observations
  }
  const { observations } = await fetchGridsImpl(pointsFor(keys), {
    now: clock,
    until,
    onProgress: () => ref.set({ updatedAt: clock() }, { merge: true }),
  })
  return observations
}

export async function deliverWeatherDigest({
  db,
  mailer,
  logger,
  now = () => new Date(),
  scheduleTime,
  fetchObs,
  fetchGrids: fetchGridsImpl = fetchGrids,
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
  // One org's tiles, and its forecast squares, are the same as the next
  // org's when the plants sit in the same city. Both caches live for this
  // run only.
  const tileCache = new Map()
  const sharedObs = new Map()
  const clock = () => now().getTime()
  const slotStart = slotStartMs(bucket)

  for (const orgId of orgList) {
    if (!orgId || String(orgId).includes('/')) continue
    try {
      const outcome = await deliverOrg({
        db,
        mailer,
        log,
        now,
        clock,
        bucket,
        slotStart,
        orgId,
        knownNames,
        fetchObs,
        fetchGridsImpl,
        renderMap,
        tileCache,
        sharedObs,
      })
      sent += outcome.sent
      skipped += outcome.skipped
      failed += outcome.failed
      if (outcome.sent) mailedOrgs += 1
    } catch (err) {
      // One tenant's Firestore error must not drop the others. The run stays
      // unsent, so the next tick in this slot tries again.
      log.error('weather digest org failed', {
        orgId,
        bucket,
        error: err?.message || 'digest-failed',
      })
      failed += 1
    }
  }

  return { orgs: mailedOrgs, sent, skipped, failed, bucket }
}

async function deliverOrg({
  db,
  mailer,
  log,
  now,
  clock,
  bucket,
  slotStart,
  orgId,
  knownNames,
  fetchObs,
  fetchGridsImpl,
  renderMap,
  tileCache,
  sharedObs,
}) {
  const nowMs = clock()
  const claim = await claimRun(db, orgId, bucket, nowMs)
  if (claim.action !== 'go') return { sent: 0, skipped: 0, failed: 0 }
  const ref = runRef(db, orgId, bucket)
  const siteSnap = await db.collection(`organizations/${orgId}/sites`).get()
  const sites = siteSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
  const plan = planSites(sites)
  const observations = storedObservations(claim.data)
  for (const [key, obs] of sharedObs) {
    if (plan.byGrid.has(key) && !observations.has(key)) observations.set(key, obs)
  }
  const missing = [...plan.byGrid.keys()].filter((key) => !observations.has(key))
  if (missing.length) {
    const fresh = await readGrids(missing, fetchObs, fetchGridsImpl, clock, ref)
    for (const [key, obs] of fresh) {
      observations.set(key, obs)
      sharedObs.set(key, obs)
    }
  }
  const digest = assembleDigest(plan, observations)
  const due = Number.isFinite(slotStart) && clock() >= slotStart + DIGEST_FALLBACK_MS
  const base = {
    bucket,
    startedAt: claim.data.startedAt,
    updatedAt: clock(),
    located: digest.located,
    unlocated: digest.unlocated,
    observations: serialiseObservations(observations),
  }
  if (!digest.complete && !due) {
    await ref.set({ ...base, status: 'open' }, { merge: true })
    log.info('weather digest waiting for the rest of the sites', {
      orgId,
      bucket,
      located: digest.located,
      unread: digest.unread,
    })
    return { sent: 0, skipped: 0, failed: 0 }
  }
  if (digest.complete && !digest.areas.length) {
    await ref.set({ ...base, status: 'sent' }, { merge: true })
    log.info('weather digest had nothing to send', {
      orgId,
      bucket,
      located: digest.located,
      unread: digest.unread,
    })
    return { sent: 0, skipped: 0, failed: 0 }
  }
  const users = await loadOrgUsers(db, orgId)
  const recipients = selectAdminAudience(users, orgId)
  if (!recipients.length) {
    await ref.set({ ...base, status: 'sent' }, { merge: true })
    return { sent: 0, skipped: 0, failed: 0 }
  }
  const origin = mailer?.config?.appOrigin || ''
  const sender = knownNames.has(orgId) ? knownNames.get(orgId) : await loadOrgDisplayName(db, orgId)
  const pins = pinsFromAreas(digest.areas.slice(0, DIGEST_AREA_CAP))
  let mapCid = ''
  let attachments = []
  if (pins.length && typeof renderMap === 'function') {
    try {
      const rendered = await renderMap(pins, { cache: tileCache })
      if (rendered?.png && Buffer.isBuffer(rendered.png) && rendered.png.length) {
        mapCid = MAP_CID
        attachments = [{ filename: 'weather-risk-map.png', content: rendered.png, cid: MAP_CID }]
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
    logger: log,
    now,
    logLabel: 'weather digest',
    context: { bucket },
    attachments,
  })
  // A rate limit did not accept the rest of the list, and those rows were
  // not claimed. Leaving the run open lets the next tick send them. Marking
  // it sent would make the ledger's "at most one" into "at most the ones
  // that fitted in the first burst".
  const status = result.reason === 'rate-limited' ? 'open' : 'sent'
  await ref.set({ ...base, status, updatedAt: clock() }, { merge: true })
  return { sent: result.sent, skipped: result.skipped, failed: result.failed }
}
