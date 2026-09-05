// ─────────────────────────────────────────────────────────────────────────────
// What a public QR mirror may CONTAIN, as opposed to what it may speak for.
//
// The binding lives in qrMirrorBinding.rules.test.js; this is the other half.
// These are world-readable documents, so the field list is worth stating rather
// than inferring from whatever the writer happened to send.
//
// Enforced on create AND on update. Create alone would be decorative: anyone
// could publish a clean mirror and then update it with whatever they liked.
//
// The update rule is deliberately NOT a plain hasOnly, and that is the part
// worth reading. A mirror written by an older build can carry a field the
// builders no longer produce — the permit mirror published `participants` and
// `fireWatchers` until S-07 replaced them with counts, and those documents are
// still out there. A plain hasOnly on the post-state would refuse every update
// to one of them forever, so it could never be corrected and never be
// WITHDRAWN: S-20 re-opened, on precisely the permits most likely to need it.
//
// So the rule is: conform to the allow-list, OR introduce no key the document
// did not already have.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgVictim'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

const extMirror = (over = {}) => ({ orgId: ORG, extId: 'ext-1', token: 'tok-ext', status: 'Active', ...over })
const permitMirror = (over = {}) => ({ orgId: ORG, permitId: 'permit-1', token: 'tok-permit', permitNo: 'PTW-1', ...over })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: ORG, createdBy: 'vic' })
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: ORG, role: 'member', status: 'approved', name: 'Mem', email: 'mem@t.co',
    })
    // The equipment and permits these mirrors speak for.
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'ext-1'), { qrToken: 'tok-ext' })
    await setDoc(doc(db, 'organizations', ORG, 'aeds', 'aed-1'), { qrToken: 'tok-aed' })
    await setDoc(doc(db, 'organizations', ORG, 'fas', 'fas-1'), { qrToken: 'tok-fas' })
    await setDoc(doc(db, 'organizations', ORG, 'stretchers', 'str-1'), { qrToken: 'tok-str' })
    await setDoc(doc(db, 'organizations', ORG, 'permits', 'permit-1'), { qrToken: 'tok-permit' })
    await setDoc(doc(db, 'organizations', ORG, 'permits', 'permit-legacy'), { qrToken: 'tok-legacy' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const qr = (db, token) => doc(db, 'qr', token)
const pqr = (db, token) => doc(db, 'permitQr', token)

describe('an equipment mirror carries only what the builders write', () => {
  it('accepts the full extinguisher payload', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-ext'), {
      orgId: ORG, orgName: 'Victim Ltd', extId: 'ext-1', token: 'tok-ext',
      serialNo: 'FE-0001', type: 'CO2', capacity: '5kg', entity: 'E', region: 'R',
      centerName: 'C', dateOfDeployment: '2026-01-01', dateOfNextRefill: '2027-01-01',
      dateOfNextHPT: '2031-01-01', status: 'Active', physicalDefects: [],
    }))
  })

  it('accepts the full AED payload', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-aed'), {
      assetKind: 'aed', orgId: ORG, orgName: 'V', assetRefId: 'aed-1', token: 'tok-aed',
      label: 'AED-0001', brand: 'B', model: 'M', centerName: 'C', region: 'R', entity: 'E',
      location: 'L', status: 'ready', batteryExpiry: '2027-01-01', padExpiry: '2027-01-01',
      lastInspection: '2026-01-01', nextInspection: '2026-07-01',
    }))
  })

  it('accepts the full FAS payload', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-fas'), {
      assetKind: 'fas', orgId: ORG, orgName: 'V', assetRefId: 'fas-1', token: 'tok-fas',
      label: 'FAS-0001', deviceType: 'Control Panel', zone: 'Z1', centerName: 'C',
      region: 'R', entity: 'E', location: 'L', status: 'operational',
      lastService: '2026-01-01', nextService: '2026-07-01', amcVendor: 'V',
    }))
  })

  it('accepts the full stretcher payload', async () => {
    await assertSucceeds(setDoc(qr(as('mem'), 'tok-str'), {
      assetKind: 'stretcher', orgId: ORG, orgName: 'V', assetRefId: 'str-1', token: 'tok-str',
      label: 'STR-0001', stretcherType: 'Scoop', brand: 'B', model: 'M', centerName: 'C',
      region: 'R', entity: 'E', location: 'L', status: 'ready',
      lastInspection: '2026-01-01', nextInspection: '2026-07-01',
    }))
  })

  it('REFUSES a field no builder writes', async () => {
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), extMirror({ notes: 'anything at all' })))
  })

  it('REFUSES a payload padded out with junk', async () => {
    await assertFails(setDoc(qr(as('mem'), 'tok-ext'), extMirror({ a: 1, b: 2, c: 3, d: 4, e: 5 })))
  })
})

describe('a permit mirror carries only what the builders write', () => {
  it('accepts the full live payload', async () => {
    await assertSucceeds(setDoc(pqr(as('mem'), 'tok-permit'), {
      orgId: ORG, orgName: 'V', permitId: 'permit-1', token: 'tok-permit',
      permitNo: 'PTW-1', docId: 'PTW-ACME_0001', site: 'S',
      typeOfWork: 'Hot work', jobLocation: 'Bay 3', jobDescription: 'Weld a bracket',
      issuingDepartment: 'Maintenance', issuedToName: 'R. Nair',
      hazards: [], ppe: [], precautions: [], jsa: [],
      participantCount: 2, fireWatcherCount: 1, hasConfinedWatcher: false, withdrawn: false,
      storedStatus: 'approved', engineering: { status: 'approved' }, operations: { status: 'approved' },
      closure: null, extension: null, closedDueToObservation: null,
      validFrom: null, validTo: null,
    }))
  })

  it('REFUSES republishing the crew as NAMES', async () => {
    // The S-07 finding, now refused by shape as well as by the builders. This
    // is the field that put every participant's name and employer on an
    // unauthenticated URL for the life of the permit, and then forever.
    await assertFails(setDoc(pqr(as('mem'), 'tok-permit'), permitMirror({
      participants: [{ name: 'R. Nair', employer: 'Acme' }],
    })))
  })

  it('REFUSES any other unlisted field', async () => {
    await assertFails(setDoc(pqr(as('mem'), 'tok-permit'), permitMirror({ internalNotes: 'x' })))
  })
})

describe('an update cannot smuggle a field in', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'qr', 'tok-ext'), extMirror())
      await setDoc(doc(db, 'permitQr', 'tok-permit'), permitMirror())
      // A mirror from an older build, still carrying fields S-07 retired.
      await setDoc(doc(db, 'permitQr', 'tok-legacy'), {
        orgId: ORG, permitId: 'permit-legacy', token: 'tok-legacy', permitNo: 'PTW-9',
        storedStatus: 'approved', withdrawn: false,
        participants: [{ name: 'R. Nair' }],
        fireWatchers: [{ name: 'A. Singh' }],
      })
    })
  })

  it('REFUSES adding an unlisted field to an equipment mirror', async () => {
    // Without this the create-side check is decorative: publish a clean mirror,
    // then update it with whatever you like.
    await assertFails(updateDoc(qr(as('mem'), 'tok-ext'), { notes: 'smuggled' }))
  })

  it('REFUSES adding one to a permit mirror', async () => {
    await assertFails(updateDoc(pqr(as('mem'), 'tok-permit'), { participants: [{ name: 'R. Nair' }] }))
  })

  it('still allows an ordinary status update', async () => {
    await assertSucceeds(updateDoc(qr(as('mem'), 'tok-ext'), { status: 'Discharged' }))
    await assertSucceeds(updateDoc(pqr(as('mem'), 'tok-permit'), { storedStatus: 'closed' }))
  })

  it('KEEPS A LEGACY MIRROR MAINTAINABLE, retired fields and all', async () => {
    // The reason the update rule is not a plain hasOnly. A mirror carrying
    // `participants` from before S-07 must stay updatable, or it can never be
    // withdrawn — S-20 re-opened, on the permits most likely to need it.
    await assertSucceeds(updateDoc(pqr(as('mem'), 'tok-legacy'), { storedStatus: 'closed' }))
  })

  it('lets a legacy mirror be WITHDRAWN, which is the whole point', async () => {
    await assertSucceeds(updateDoc(pqr(as('mem'), 'tok-legacy'), {
      withdrawn: true, jobDescription: '', jobLocation: '', issuedToName: '',
    }))
  })

  it('still refuses a NEW field on a legacy mirror', async () => {
    // The escape hatch is "adds no key the document did not have" — not "any
    // key at all, because this document is old".
    await assertFails(updateDoc(pqr(as('mem'), 'tok-legacy'), { somethingNew: 'x' }))
  })
})
