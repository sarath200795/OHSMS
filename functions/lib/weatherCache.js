// One Windy reading per ~1 km square per six-hour slot.
//
// The site screen, the home widget, the map, the phone alerts and the digest
// used to each ask Windy on their own clock. Two of those asks can land on
// different forecast hours, and the mail then printed a UTC stamp the screen
// never showed. This document is the reading for the open Asia/Kolkata slot.
// fetchSiteWeather and the digest both go through it, so a square fetched by
// either is the reading the other returns, with the same observedAt.
//
// The client never reads this collection. The Admin SDK does. A member who
// could write it would put a temperature on every screen and in the mail.

import { cachedObservation } from './weatherCacheDoc.js'

export function weatherCache(db) {
  return {
    async get(key) {
      const snap = await db.doc(`weatherCache/${cacheId(key)}`).get()
      if (!snap.exists) return null
      const data = typeof snap.data === 'function' ? snap.data() : snap.data
      return data || null
    },
    async set(key, slot, obs) {
      const plain = plainObs(obs)
      if (!plain) return
      await db.doc(`weatherCache/${cacheId(key)}`).set({
        slot,
        obs: plain,
        fetchedAt: Date.now(),
      })
    },
  }
}

export function cacheId(key) {
  return String(key || '').replace(/[^0-9A-Za-z._-]/g, '_')
}

function plainObs(obs) {
  if (!obs || typeof obs !== 'object') return null
  const plain = {}
  for (const [field, value] of Object.entries(obs)) {
    if (typeof value === 'number' && Number.isFinite(value)) plain[field] = value
    else if (typeof value === 'string' && value.trim()) plain[field] = value.trim()
  }
  return Object.keys(plain).length ? plain : null
}

export { cachedObservation }
