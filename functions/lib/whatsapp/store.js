// ─────────────────────────────────────────────────────────────────────────────
// The Firestore side of the WhatsApp lookup. Everything the handler's `ctx.store`
// needs, against the Admin SDK.
//
// Collections, all TOP-LEVEL and server-only (firestore.rules: read, write: if
// false — the Admin SDK does not consult rules; nothing else may touch them):
//
//   waLinks/{waId}             { uid, orgId, last4, linkedAt, source, linkedBy }
//                              source is 'self' (link code) or 'admin' (Org Settings)
//   waLinkCodes/{sha256(code)} { uid, orgId, expiresAtMs, createdAt } 10-min code
//   waInbound/{sha256(wamid)}  { at, expiresAt }                      dedupe, 7 days
//   waRate/{phoneHash}         counters, see rateLimit.js
//   waQueryLog/{auto}          { orgId, uid, phoneHash, siteId, intent, outcome, at }
//   waSiteSnapshots/{orgId}    { asOf, v, sites: { [siteId]: [counts…] } }
//   waOrgSettings/{orgId}     { enabled, updatedBy, updatedAtMs, test window }
//                              Org Settings switch. Server-only. Absent means
//                              lookup stays on; enabled: false turns it off
//                              for that organisation only. No tokens.
//   waSessions/{phoneHash}     the chat's conversation, keyed by a digest of the
//                              number or `tg:<chatId>`. Holds the chosen
//                              organisation and the last numbered list (site ids
//                              or organisation ids), never a location and never
//                              the message text.
//                                step: 'org' | 'site'
//                                choiceKind: 'org' | 'site' | null
//                                choices: ids of the last list
//                                choicesExpireAtMs   the list, 15 min
//                                expiresAtMs         the conversation, 24 h idle
//                              Purge reads expiresAtMs, so a remembered
//                              organisation outlives the numbered list.
//
// waId (the sender's number, digits) is the waLinks document id because it is
// the lookup key on every message. It is personal data, which is why the
// collection is server-only and listed in subjectData.js. Everywhere else the
// number appears only as a keyed digest (phoneHash).
// ─────────────────────────────────────────────────────────────────────────────
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { hashLinkCode, inboundId, phoneHash, redeemable } from './link.js'
import { isActiveMember } from './access.js'
import { summariseSites } from '../siteSummary.js'
import { namedOrganisations, snapshotOrgIds } from './orgs.js'
import { orgLookupEnabled as isOrgLookupEnabled } from './orgConnect.js'
import { configPath } from '../metabase.js'
import { loadSiteAudit } from '../siteAuditLoad.js'

export const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000
export const INBOUND_KEEP_MS = 7 * 24 * 60 * 60 * 1000
export const READ_CAP = 20000

// Compact snapshot rows: one array per site keeps a 5,000-site org far under
// Firestore's 1 MiB document limit, so the webhook reads ONE document per reply.
export const SNAPSHOT_FIELDS = [
  'extinguishers',
  'hptOverdue',
  'openDefects',
  'defExt',
  'defAed',
  'defFas',
  'firstAidBoxes',
  'pendingActions',
  'overdueActions',
  'incidentsTotal',
  'incidentsOpen',
  'incidents90d',
  'aeds',
  'aedsOutOfService',
]
export const SNAPSHOT_VERSION = 2

export function packCounts(c = {}) {
  const k = c.defectsByKind || {}
  const flat = { ...c, defExt: k.extinguisher, defAed: k.aed, defFas: k.fas }
  return SNAPSHOT_FIELDS.map((f) => Number(flat[f]) || 0)
}

const ITEM_KEYS = { extinguisher: 'e', aed: 'a', fas: 'f' }

/** defectItems as Firestore can hold them (no nested arrays): { e: [{ l, w, d }], a, f }. */
export function packItems(items = {}) {
  const out = {}
  for (const [kind, k] of Object.entries(ITEM_KEYS)) {
    out[k] = (items[kind] || []).map((i) => ({
      l: i.label || '',
      w: i.where || '',
      d: i.defect || '',
    }))
  }
  return out
}

export function unpackItems(packed = {}) {
  const out = {}
  for (const [kind, k] of Object.entries(ITEM_KEYS)) {
    out[kind] = (Array.isArray(packed?.[k]) ? packed[k] : []).map((i) => ({
      label: String(i?.l ?? ''),
      where: String(i?.w ?? ''),
      defect: String(i?.d ?? ''),
    }))
  }
  return out
}

export function unpackCounts(arr = []) {
  const o = Object.fromEntries(SNAPSHOT_FIELDS.map((f, i) => [f, Number(arr[i]) || 0]))
  const { defExt, defAed, defFas, ...rest } = o
  return { ...rest, defectsByKind: { extinguisher: defExt, aed: defAed, fas: defFas } }
}

const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))

/** Read what summariseSites needs for one org, field-limited where it helps. */
export async function loadOrgData(db, orgId) {
  const col = (name) => db.collection(`organizations/${orgId}/${name}`)
  const read = async (name, fields) => {
    let q = col(name)
    if (fields) q = q.select(...fields)
    return docs(await q.limit(READ_CAP).get())
  }
  const [
    sites,
    extinguishers,
    aeds,
    fas,
    reports,
    incidents,
    mockDrills,
    inspectionRecords,
    auditFindings,
  ] = await Promise.all([
    read('sites', ['name', 'code', 'region', 'entity', 'firstAidBoxes']),
    read('extinguishers', [
      'siteId',
      'centerName',
      'sitesCovered',
      'site',
      'location',
      'status',
      'physicalDefects',
      'dateOfNextHPT',
      'hptClosedFor',
      'serialNo',
      'deletedAt',
    ]),
    read('aeds', [
      'siteId',
      'centerName',
      'sitesCovered',
      'site',
      'location',
      'assetId',
      'status',
      'deletedAt',
    ]),
    read('fas', [
      'siteId',
      'centerName',
      'sitesCovered',
      'site',
      'location',
      'deviceId',
      'deletedAt',
    ]),
    read('reports', [
      'kind',
      'approvalStatus',
      'defectType',
      'extId',
      'assetKind',
      'assetRefId',
      'assetLabel',
      'defect',
      'deletedAt',
    ]),
    // Never the narrative: capa is read for status / dueDate / id only, and
    // its sealed descriptions are ciphertext this function cannot open.
    read('incidents', [
      'siteId',
      'location',
      'site',
      'lifecycle',
      'incidentDate',
      'capa',
      'deletedAt',
    ]),
    read('mockDrills', ['siteId', 'centerName', 'capa', 'deletedAt']),
    read('inspectionRecords', ['siteId', 'siteName', 'responses', 'deletedAt']),
    read('auditFindings', ['siteId', 'taskDetails', 'findings', 'status', 'deletedAt']),
  ])
  return {
    sites,
    extinguishers,
    aeds,
    fas,
    reports,
    incidents,
    mockDrills,
    inspectionRecords,
    auditFindings,
  }
}

export async function loadModules(db, orgId) {
  const snap = await db.doc(`moduleEntitlements/${orgId}`).get()
  const modules = snap.exists ? snap.data()?.modules : null
  return modules && typeof modules === 'object' ? modules : {}
}

/** Every organisation id a snapshot should be built for. Not only those with a linked number. */
export async function listSnapshotOrgIds(db) {
  const snap = await db.collection('organizations').select('name').limit(READ_CAP).get()
  return snapshotOrgIds(snap.docs.map((d) => ({ id: d.id })))
}

/** Build and store one org's snapshot. Returns { asOf, sites } with unpacked counts. */
export async function buildSnapshot(db, orgId, now = new Date()) {
  const [data, modules] = await Promise.all([loadOrgData(db, orgId), loadModules(db, orgId)])
  const counts = summariseSites(data, { now, modules, withItems: true })
  const packed = Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, packCounts(c)]))
  const items = Object.fromEntries(
    Object.entries(counts).map(([id, c]) => [id, packItems(c.defectItems)])
  )
  await db.doc(`waSiteSnapshots/${orgId}`).set({
    orgId,
    asOf: Timestamp.fromDate(now),
    v: SNAPSHOT_VERSION,
    fields: SNAPSHOT_FIELDS,
    sites: packed,
    items,
  })
  return { asOf: now, sites: counts }
}

export function createStore(db, { pepper, now = () => new Date(), logger } = {}) {
  const hash = (waId) => phoneHash(pepper, waId)

  return {
    async claimInbound(wamid) {
      try {
        await db.doc(`waInbound/${inboundId(wamid)}`).create({
          at: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(now().getTime() + INBOUND_KEEP_MS),
        })
        return true
      } catch (err) {
        // ALREADY_EXISTS is the retry we are here to swallow. Anything else is
        // a real failure and must not be mistaken for "seen before".
        if (err?.code === 6 || err?.code === 'already-exists') return false
        throw err
      }
    },

    async getLink(waId) {
      const snap = await db.doc(`waLinks/${waId}`).get()
      if (!snap.exists) return null
      const d = snap.data() || {}
      return typeof d.uid === 'string' && typeof d.orgId === 'string'
        ? { uid: d.uid, orgId: d.orgId }
        : null
    },

    async getUser(uid) {
      if (!uid || uid.includes('/')) return null
      const snap = await db.doc(`users/${uid}`).get()
      return snap.exists ? { uid, ...(snap.data() || {}) } : null
    },

    async redeemLinkCode(code, waId) {
      const ref = db.doc(`waLinkCodes/${hashLinkCode(code)}`)
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const rec = snap.exists ? snap.data() : null
        const ok = redeemable(rec, now().getTime())
        if (!ok.ok) {
          if (snap.exists) tx.delete(ref)
          return ok
        }
        const userSnap = await tx.get(db.doc(`users/${rec.uid}`))
        const user = userSnap.exists ? userSnap.data() : null
        // Single-use either way: a code that met an inactive account is spent.
        tx.delete(ref)
        if (!isActiveMember(user, rec.orgId)) return { ok: false, reason: 'inactive' }
        // The welcome is notifyWhatsAppLinked on this document. Sending from
        // the transaction is how a Graph refusal used to fail a link that
        // had already been decided, and a second sender is a second message.
        tx.set(db.doc(`waLinks/${waId}`), {
          uid: rec.uid,
          orgId: rec.orgId,
          last4: String(waId).slice(-4),
          linkedAt: FieldValue.serverTimestamp(),
          source: 'self',
        })
        return { ok: true, uid: rec.uid, orgId: rec.orgId }
      })
      if (result.ok) {
        // One number per person: a new link replaces any older one.
        const older = await db.collection('waLinks').where('uid', '==', result.uid).get()
        await Promise.all(older.docs.filter((d) => d.id !== waId).map((d) => d.ref.delete()))
      }
      return result
    },

    async unlink(waId) {
      await db.doc(`waLinks/${waId}`).delete()
    },

    async rate(waId, fn) {
      const ref = db.doc(`waRate/${hash(waId)}`)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const out = fn(snap.exists ? snap.data() || {} : {})
        tx.set(ref, { ...out.state, updatedAt: FieldValue.serverTimestamp() })
        return out
      })
    },

    async listOrganizations() {
      const snap = await db.collection('organizations').select('name').limit(READ_CAP).get()
      return namedOrganisations(snap.docs.map((d) => ({ id: d.id, name: d.data()?.name })))
    },

    async orgLookupEnabled(orgId) {
      // A bad id is not "on". A missing document is on: lookup predated the switch.
      if (typeof orgId !== 'string' || !orgId || orgId.includes('/')) return false
      const snap = await db.doc(`waOrgSettings/${orgId}`).get()
      if (!snap.exists) return true
      return isOrgLookupEnabled(snap.data() || {})
    },

    async getOrganization(orgId) {
      if (typeof orgId !== 'string' || !orgId || orgId.includes('/')) return null
      const snap = await db.doc(`organizations/${orgId}`).get()
      if (!snap.exists) return null
      return { id: orgId, name: String(snap.data()?.name || '').trim() }
    },

    async listSites(orgId) {
      const snap = await db
        .collection(`organizations/${orgId}/sites`)
        .select('name', 'code', 'region', 'entity', 'lat', 'lng')
        .limit(READ_CAP)
        .get()
      return docs(snap).filter((s) => typeof s.name === 'string' && s.name)
    },

    async siteCounts(orgId) {
      const snap = await db.doc(`waSiteSnapshots/${orgId}`).get()
      const d = snap.exists ? snap.data() : null
      const asOf = d?.asOf?.toDate ? d.asOf.toDate() : null
      if (
        d &&
        d.v === SNAPSHOT_VERSION &&
        asOf &&
        now().getTime() - asOf.getTime() < SNAPSHOT_MAX_AGE_MS
      ) {
        const sites = Object.fromEntries(
          Object.entries(d.sites || {}).map(([id, a]) => [
            id,
            { ...unpackCounts(a), defectItems: unpackItems(d.items?.[id]) },
          ])
        )
        return { asOf, sites }
      }
      // Missing or stale (the schedule is off, or this org just linked its
      // first user): build it now. One heavy read, then every reply for the
      // next half hour is one document.
      return buildSnapshot(db, orgId, now())
    },

    async siteContext(orgId, site) {
      const contactsCol = db.collection(`organizations/${orgId}/erpContacts`)
      const [own, orgWide, org, modules] = await Promise.all([
        contactsCol.where('siteId', '==', site.id).limit(60).get(),
        contactsCol.where('siteId', '==', '').limit(60).get(),
        db.doc(`organizations/${orgId}`).get(),
        loadModules(db, orgId),
      ])
      const o = org.exists ? org.data() || {} : {}
      return {
        contacts: [...docs(own), ...docs(orgWide)],
        helplinePrimary: o.safetyHelplinePrimary || '',
        helplineSecondary: o.safetyHelplineSecondary || '',
        roleLabels: o.erpRoleLabels || {},
        modules,
      }
    },

    async siteAudit(orgId, site) {
      // The reachable site from listSites carries code and name, which is
      // enough for most joins. A centre id that was stored only in attributes
      // is what the dashboard's join also accepts, and listSites does not
      // select it. Re-read this one document — the caller already reached it —
      // so the phone and the tab attribute the audit to the same centre.
      let joined = site
      if (site?.id && typeof site.id === 'string' && !site.id.includes('/')) {
        try {
          const snap = await db.doc(`organizations/${orgId}/sites/${site.id}`).get()
          if (snap.exists) joined = { ...(snap.data() || {}), ...site, id: site.id }
        } catch {
          joined = site
        }
      }
      return loadSiteAudit({
        orgId,
        site: joined,
        now: now().getTime(),
        logger,
        readConfig: async () => {
          if (typeof orgId !== 'string' || !orgId || orgId.includes('/')) return null
          const snap = await db.doc(configPath(orgId)).get()
          return snap.exists ? snap.data() : null
        },
      })
    },

    async getSession(waId) {
      const snap = await db.doc(`waSessions/${hash(waId)}`).get()
      return snap.exists ? snap.data() || null : null
    },

    async setSession(waId, session = {}) {
      const choiceKind =
        session.choiceKind === 'org' || session.choiceKind === 'site' ? session.choiceKind : null
      const step = session.step === 'org' || session.step === 'site' ? session.step : null
      await db.doc(`waSessions/${hash(waId)}`).set({
        uid: session.uid ?? null,
        orgId: session.orgId ?? null,
        lastOrgId: session.lastOrgId || session.orgId || null,
        step,
        choiceKind,
        choices: (session.choices || []).filter((id) => typeof id === 'string').slice(0, 10),
        // Older writers set only expiresAtMs and meant the list. Keep that as
        // the list clock when the conversation clock was not split out. An
        // explicit 0 means "no list", and must not be replaced by the 24 h clock.
        choicesExpireAtMs:
          session.choicesExpireAtMs != null
            ? Number(session.choicesExpireAtMs) || 0
            : Number(session.expiresAtMs) || 0,
        expiresAtMs: Number(session.expiresAtMs) || 0,
      })
    },

    async clearSession(waId) {
      await db.doc(`waSessions/${hash(waId)}`).delete()
    },

    async log(row, waId) {
      const at = now()
      await db.collection('waQueryLog').add({
        orgId: row.orgId || null,
        uid: row.uid || null,
        phoneHash: waId ? hash(waId) : null,
        siteId: row.siteId || null,
        intent: row.intent || null,
        outcome: row.outcome || null,
        at: Timestamp.fromDate(at),
      })
    },
  }
}
