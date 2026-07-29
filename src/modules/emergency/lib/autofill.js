// ─────────────────────────────────────────────────────────────────────────────
// Filling a site's external emergency contacts from its coordinates.
//
// Shared by the single-site "Map nearest" button and the bulk refresh in the
// site repository, so both write exactly the same thing.
//
// The rule that matters: a contact's phone is that service's OWN published
// number, or it is blank. An earlier version stored the national helpline (112)
// whenever OpenStreetMap had no number, which produced rows like
// "Nuffield Hospital · 112" — indistinguishable from a verified direct line.
// Dialling 112 is correct advice, but it belongs on the poster as the helpline,
// not as a hospital's number. Blank is honest; a wrong number is not.
// ─────────────────────────────────────────────────────────────────────────────
import { findNearestServices } from './nearby'
import { addContact, updateContact } from './firestore'

/** National/generic emergency lines — never a specific station's own number. */
const GENERIC = new Set(['112', '100', '101', '102', '108', '999', '911', '1091', '1098', '190', '191'])

/** True if `phone` is a generic helpline rather than a service's direct line. */
export const isGenericHelpline = (phone) => GENERIC.has(String(phone || '').replace(/[\s()+-]/g, ''))

/** A stored contact whose number is missing or is a generic helpline. */
export const needsRealNumber = (c) => !String(c?.phone || '').trim() || isGenericHelpline(c.phone)

/**
 * Does this site still need a lookup? True when it has no external contacts, or
 * any of them carries a missing/generic number.
 */
export function siteNeedsRefresh(site, contacts) {
  const mine = contacts.filter((c) => c.kind === 'external' && c.siteId === site.id)
  return mine.length === 0 || mine.some(needsRealNumber)
}

const noteFor = (r) =>
  `Nearest ${r.role.toLowerCase()} (~${r.distanceKm} km) via OpenStreetMap` +
  (r.phoneSource === 'none'
    ? ' · OpenStreetMap publishes no number for this one — confirm it locally and enter it manually'
    : '')

/**
 * Look up the nearest services for one site and upsert its external contacts.
 * Existing rows for the same role are updated in place, so a site keeps one
 * Hospital / Police / Fire Brigade entry rather than accumulating duplicates.
 *
 * Returns { added, updated, withNumber, withoutNumber, results } — or throws if
 * the map lookup itself failed, so the caller can report that site as failed
 * rather than silently leaving stale data in place.
 */
export async function autofillSite(orgId, site, contacts, actor) {
  const found = await findNearestServices(site.lat, site.lng)
  const mine = contacts.filter((c) => c.kind === 'external' && c.siteId === site.id)

  let added = 0
  let updated = 0
  for (const r of found) {
    const payload = {
      kind: 'external',
      role: r.role,
      name: r.name,
      phone: r.phone, // '' when OSM has none — deliberately not a helpline
      altPhone: '',
      email: '',
      employeeUid: '',
      department: '',
      region: site.region || '',
      entity: site.entity || '',
      siteId: site.id,
      site: site.name,
      notes: noteFor(r),
    }
    const existing = mine.find((c) => c.role === r.role)
    if (existing) {
      // Keep a number somebody entered by hand; only overwrite blanks and the
      // generic helplines the old version wrote.
      const keepManual = existing.phone && !isGenericHelpline(existing.phone) && r.phoneSource === 'none'
      await updateContact(orgId, existing.id, keepManual ? { ...payload, phone: existing.phone, notes: existing.notes } : payload, actor)
      updated += 1
    } else {
      await addContact(orgId, payload, actor)
      added += 1
    }
  }

  return {
    added,
    updated,
    withNumber: found.filter((r) => r.phone).length,
    withoutNumber: found.filter((r) => !r.phone).length,
    results: found,
  }
}

/**
 * Refresh many sites, one after another.
 *
 * Deliberately sequential with a pause between sites: the public Overpass
 * mirrors rate-limit aggressively and firing 59 parallel queries gets the whole
 * run throttled (HTTP 429). Slower and complete beats fast and half-empty.
 *
 * `onProgress({ done, total, site, status, detail })` is called per site so the
 * caller can render a live log. Failures never abort the run; `shouldStop()`
 * lets the caller stop it between sites, leaving already-updated sites saved.
 */
export async function refreshSites(orgId, sites, contacts, actor, onProgress, { pauseMs = 1200, shouldStop } = {}) {
  const summary = { ok: 0, failed: 0, added: 0, updated: 0, withNumber: 0, withoutNumber: 0, failures: [], stopped: false }

  for (let i = 0; i < sites.length; i += 1) {
    if (shouldStop?.()) { summary.stopped = true; break }
    const site = sites[i]
    onProgress?.({ done: i, total: sites.length, site, status: 'running' })
    try {
      const r = await autofillSite(orgId, site, contacts, actor)
      summary.ok += 1
      summary.added += r.added
      summary.updated += r.updated
      summary.withNumber += r.withNumber
      summary.withoutNumber += r.withoutNumber
      onProgress?.({
        done: i + 1, total: sites.length, site, status: 'done',
        detail: `${r.withNumber} with a number, ${r.withoutNumber} without`,
      })
    } catch (err) {
      summary.failed += 1
      summary.failures.push({ site: site.name, message: err?.message || 'Lookup failed' })
      onProgress?.({ done: i + 1, total: sites.length, site, status: 'failed', detail: err?.message || 'Lookup failed' })
    }
    if (i < sites.length - 1) await new Promise((r) => setTimeout(r, pauseMs))
  }

  return summary
}
