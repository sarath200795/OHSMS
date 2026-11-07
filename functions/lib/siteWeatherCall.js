// Who may ask fetchSiteWeather for a coordinate.
//
// Open-Meteo is a public forecast. There is no API key and the answer is not
// a tenant secret. The old provider was not: that call spent a project key.
// What is left is a signed-in account using this function as an open proxy,
// including one that has not been approved and one still on a temporary
// password. The digest does not come through here. It is a schedule, and it
// does not borrow a user.
//
// A coordinate is allowed when it is the ~11 km square of a site this profile
// can already see. Admins see every site in their org. Everyone else is the
// same reach as reachesScope: their posting, or an explicit site, region or
// entity grant. Another org's sites are not in the list the caller loads.

import { reachesScope } from './audience.js'
import { gridKey, requestPoint } from './openMeteo.js'
import { cachedObservation } from './weatherCacheDoc.js'
import { weatherBucket } from './weatherDigest.js'

// One page of sites is the normal load (the screen itself talks about sixty).
// Cache hits are not counted, so a second look at the same slot is free.
// 120 leaves room for that first pass and refuses a loop.
export const WEATHER_FETCH_LIMIT = 120
export const WEATHER_FETCH_WINDOW_MS = 10 * 60 * 1000

export function decideWeatherCaller(profile) {
  if (!profile || profile.status !== 'approved' || !profile.orgId) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Your account is not an approved member of an organization.',
    }
  }
  if (profile.mustChangePassword === true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Change your password before using this.',
    }
  }
  return { ok: true }
}

export function callerReachesPoint(profile, sites, key) {
  if (!key) return false
  for (const site of sites || []) {
    const siteKey = gridKey(Number(site?.lat), Number(site?.lng))
    if (!siteKey || siteKey !== key) continue
    if (
      reachesScope(profile, {
        siteId: site.id || '',
        region: site.region || '',
        entity: site.entity || '',
      })
    ) {
      return true
    }
  }
  return false
}

/**
 * One provider fetch. Stamps older than the window drop off, so the document
 * cannot grow with every call. A full window refuses without recording another
 * stamp.
 */
export function countWeatherFetch(
  prev = {},
  nowMs = Date.now(),
  limit = WEATHER_FETCH_LIMIT,
  windowMs = WEATHER_FETCH_WINDOW_MS
) {
  const stamps = (Array.isArray(prev?.stamps) ? prev.stamps : []).filter(
    (t) => typeof t === 'number' && nowMs - t < windowMs
  )
  if (stamps.length >= limit) return { stamps, allowed: false }
  stamps.push(nowMs)
  return { stamps, allowed: true }
}

/**
 * The callable body. `loadProfile`, `orgExists`, `loadSites` and `takeRate`
 * are the Firestore edges. `fetchImpl` is the provider. A refusal returns
 * before either of those last two is used, except org and site reads, which
 * are how the refusal is decided.
 */
export async function serveSiteWeather({
  uid,
  data,
  loadProfile,
  orgExists,
  loadSites,
  cache,
  fetchImpl,
  takeRate,
  nowMs = Date.now(),
  slot,
} = {}) {
  if (!uid) return { error: 'unauthenticated', message: 'Sign in first.' }
  const profile = (await loadProfile(uid)) || null
  const caller = decideWeatherCaller(profile)
  if (!caller.ok) return { error: caller.code, message: caller.message }
  if (!(await orgExists(profile.orgId))) {
    return { error: 'failed-precondition', message: 'Your organization is not active.' }
  }
  const key = gridKey(Number(data?.lat), Number(data?.lng))
  if (!key) {
    return { error: 'invalid-argument', message: 'A latitude and longitude are required.' }
  }
  const sites = await loadSites(profile.orgId)
  if (!callerReachesPoint(profile, sites, key)) {
    return { error: 'permission-denied', message: 'That location is not a site you can view.' }
  }
  const point = {
    key,
    lat: Number(key.split(',')[0]),
    lng: Number(key.split(',')[1]),
  }
  const openSlot = slot || weatherBucket(new Date(nowMs))
  if (cache && openSlot) {
    const hit = cachedObservation(await cache.get(point.key), openSlot)
    if (hit) return { body: { obs: hit.slot ? hit : { ...hit, slot: openSlot } } }
  }
  if (takeRate && !(await takeRate(uid, nowMs))) {
    return { body: { obs: null, limited: true } }
  }
  const result = await requestPoint(point, {
    cache,
    slot: openSlot,
    fetchImpl,
    now: nowMs,
  })
  if (!result.ok && result.retry) return { body: { obs: null, limited: true } }
  return { body: { obs: result.obs || null } }
}
