// ─────────────────────────────────────────────────────────────────────────────
// A public QR mirror must speak for equipment that actually exists.
//
// /qr and /permitQr are keyed by a random TOKEN, so unlike /procedureQr there is
// nothing in the document path tying a mirror to the thing it describes.
// `isWriterOf(request.resource.data.orgId)` proves only that the writer owns the
// org they NAMED — never that the extinguisher, AED or permit is real, is
// theirs, or has anything to do with this token.
//
// So a member could publish a world-readable page describing equipment nobody
// owns, or park one at a token that has not been printed yet and wait for the
// sticker to catch up. The permit case is sharper: that mirror is what somebody
// at a barrier reads to decide whether the work in front of them is authorised.
//
// The binding runs the opposite way round to /procedureQr's — the ASSET has to
// claim the token — because the token is the only thing the path gives us.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgVictim'
const OTHER = 'orgAttacker'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [org, uid] of [[ORG, 'vic'], [OTHER, 'mal']]) {
      await setDoc(doc(db, 'organizations', org), { name: org, createdBy: uid })
      await setDoc(doc(db, 'users', uid), {
        orgId: org, role: 'admin', status: 'approved', name: uid, email: `${uid}@t.co`,
      })
    }
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: ORG, role: 'member', status: 'approved', name: 'Mem', email: 'mem@t.co',
    })
    await setDoc(doc(db, 'users', 'aud'), {
      orgId: ORG, role: 'auditor', status: 'approved', name: 'Aud', email: 'aud@t.co',
    })

    // Equipment that already carries its printed token.
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'ext-1'), { qrToken: 'tok-ext', serialNo: 'FE-0001' })
    await setDoc(doc(db, 'organizations', ORG, 'aeds', 'aed-1'), { qrToken: 'tok-aed', assetId: 'AED-0001' })
    await setDoc(doc(db, 'organizations', ORG, 'fas', 'fas-1'), { qrToken: 'tok-fas', deviceId: 'FAS-0001' })
    await setDoc(doc(db, 'organizations', ORG, 'stretchers', 'str-1'), { qrToken: 'tok-str', assetId: 'STR-0001' })
    await setDoc(doc(db, 'organizations', ORG, 'permits', 'permit-1'), { qrToken: 'tok-permit', permitNo: 'PTW-1' })
    // One unit with no token at all — nothing may be published for it.
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'ext-none'), { serialNo: 'FE-0002' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

const extMirror = (over = {}) => ({ orgId: ORG, extId: 'ext-1', token: 'tok-ext', status: 'Active', ...over })
const assetMirror = (kind, refId, token, over = {}) =>
  ({ assetKind: kind, orgId: ORG, assetRefId: refId, token, label: 'X', status: 'ready', ...over })
const permitMirror = (over = {}) => ({ orgId: ORG, permitId: 'permit-1', token: 'tok-permit', permitNo: 'PTW-1', ...over })

const qr = (db, token) => doc(db, 'qr', token)
const pqr = (db, token) => doc(db, 'permitQr', token)

describe('an equipment mirror the asset actually claims', () => {
  it('publishes for an extinguisher holding that token', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-ext'), extMirror()))
  })

  it('publishes for an AED, a FAS panel and a stretcher', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-aed'), assetMirror('aed', 'aed-1', 'tok-aed')))
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-fas'), assetMirror('fas', 'fas-1', 'tok-fas')))
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-str'), assetMirror('stretcher', 'str-1', 'tok-str')))
  })

  it('publishes when the asset and the mirror are written in ONE batch', async () => {
    // The add path: the extinguisher does not exist yet at get() time, which is
    // why the rule uses getAfter. If this ever starts failing, adding a unit
    // has stopped publishing its QR page.
    const db = as('mem')
    const batch = writeBatch(db)
    batch.set(doc(db, 'organizations', ORG, 'extinguishers', 'ext-new'), { qrToken: 'tok-new', serialNo: 'FE-9' })
    batch.set(qr(db, 'tok-new'), extMirror({ extId: 'ext-new', token: 'tok-new' }))
    await assertSucceeds(batch.commit())
  })

  it('still refuses an auditor — read-only is read-only', async () => {
    await assertFails(setDoc(qr(as('aud'), 'tok-ext'), extMirror()))
  })

  it('still refuses a stranger with no account', async () => {
    await assertFails(setDoc(qr(anon(), 'tok-ext'), extMirror()))
  })
})

describe('an equipment mirror that speaks for nothing', () => {
  it('REFUSES a mirror at a token no asset carries', async () => {
    // The sticker has not been printed yet. Parking a page there and waiting
    // for it to catch up is the whole point of binding this.
    await assertFails(setDoc(qr(as('mem'), 'tok-unprinted'), extMirror({ token: 'tok-unprinted' })))
  })

  it('REFUSES a mirror naming an extinguisher that does not exist', async () => {
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), extMirror({ extId: 'no-such-unit' })))
  })

  it('REFUSES a mirror naming a real asset that claims a DIFFERENT token', async () => {
    // ext-1 holds tok-ext, so it cannot also speak at tok-aed.
    await assertFails(setDoc(qr(as('mem'), 'tok-aed'), extMirror({ token: 'tok-aed' })))
  })

  it('REFUSES a mirror for a unit that has no token at all', async () => {
    await assertFails(setDoc(qr(as('mem'), 'tok-anything'), extMirror({ extId: 'ext-none', token: 'tok-anything' })))
  })

  it('REFUSES a mirror with no asset id', async () => {
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), { orgId: ORG, token: 'tok-ext', status: 'Active' }))
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), extMirror({ extId: '' })))
  })

  it('REFUSES an assetKind the rule does not know', async () => {
    // No default into a real collection: an unknown kind resolves to '' and is
    // refused, rather than being read as an extinguisher.
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), assetMirror('sprinkler', 'ext-1', 'tok-ext')))
  })

  it('REFUSES an AED mirror pointed at an extinguisher id', async () => {
    // The kind decides the collection, so this looks in /aeds and finds nothing.
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), assetMirror('aed', 'ext-1', 'tok-ext')))
  })
})

describe('another tenant', () => {
  it('cannot publish a mirror for the victim’s equipment', async () => {
    await assertFails(setDoc(qr(as('mal'), 'tok-ext'), extMirror()))
  })

  it('cannot publish one by naming its OWN org at the victim’s token', async () => {
    // isWriterOf passes — it is their org — so the binding is what refuses:
    // there is no extinguisher at organizations/orgAttacker/extinguishers/ext-1.
    await assertFails(setDoc(qr(as('mal'), 'tok-ext'), extMirror({ orgId: OTHER })))
  })
})

describe('the permit mirror', () => {
  it('publishes for a permit holding that token', async () => {
    await assertSucceeds(setDoc(pqr(as('mem'), 'tok-permit'), permitMirror()))
  })

  it('REFUSES one at a token no permit carries', async () => {
    // The page a fire watcher reads at a barrier. Unbound, this says work is
    // authorised when no permit exists.
    await assertFails(setDoc(pqr(as('mem'), 'tok-unprinted'), permitMirror({ token: 'tok-unprinted' })))
  })

  it('REFUSES one naming a permit that does not exist', async () => {
    await assertFails(setDoc(pqr(as('mem'), 'tok-permit'), permitMirror({ permitId: 'no-such-permit' })))
  })

  it('REFUSES one with no permitId', async () => {
    await assertFails(setDoc(pqr(as('mem'), 'tok-permit'), { orgId: ORG, token: 'tok-permit' }))
  })

  it('REFUSES another tenant, naming either org', async () => {
    await assertFails(setDoc(pqr(as('mal'), 'tok-permit'), permitMirror()))
    await assertFails(setDoc(pqr(as('mal'), 'tok-permit'), permitMirror({ orgId: OTHER })))
  })
})

// The binding is on CREATE. Update and delete were already pinned to the
// mirror's existing org by the S-07 fix, and must stay exactly as they were —
// a create-side change that broke the maintenance path would take every QR
// page stale instead of wrong, which is not an improvement.
describe('maintaining a published mirror still works', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tok-ext'), extMirror())
      await setDoc(doc(db, 'permitQr', 'tok-permit'), permitMirror())
    })
  })

  it('lets the owner update its own equipment mirror', async () => {
    await assertSucceeds(updateDoc(qr(as('mem'), 'tok-ext'), { status: 'Discharged' }))
  })

  it('lets the owner update its own permit mirror', async () => {
    await assertSucceeds(updateDoc(pqr(as('mem'), 'tok-permit'), { storedStatus: 'approved' }))
  })

  it('lets the owner delete a mirror when the asset goes', async () => {
    await assertSucceeds(deleteDoc(qr(as('mem'), 'tok-ext')))
  })

  it('still refuses another tenant re-pointing a live mirror', async () => {
    await assertFails(updateDoc(qr(as('mal'), 'tok-ext'), { orgId: OTHER }))
  })

  it('still lets anyone scan one', async () => {
    await assertSucceeds(getDoc(qr(anon(), 'tok-ext')))
    await assertSucceeds(getDoc(pqr(anon(), 'tok-permit')))
  })
})
