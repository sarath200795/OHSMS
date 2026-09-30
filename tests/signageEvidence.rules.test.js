// A signage record may only BECOME Deployed with at least one photo (`photos` list,
// or the legacy single `photo`) and a last-checked date. How many photos a FERP /
// Fire Extinguisher sign ideally has is NOT enforced
// (firestore.rules → keepsSignageEvidence). These send the writes the
// register would send, and the ones an SDK client could send instead.
//
// The point of the "already Deployed" cases is the other half of the rule:
// records saved before it existed have neither, and must stay editable.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORG = 'orgOne'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => {
  await testEnv?.cleanup()
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const sign = (uid, id) => doc(as(uid), 'organizations', ORG, 'signages', id)

const PHOTO = { path: `orgs/${ORG}/signage-photos/a-signage.jpg`, contentType: 'image/jpeg' }
const PHOTOS = (n) => Array.from({ length: n }, (_, i) => ({ path: `orgs/${ORG}/signage-photos/p${i}.jpg`, contentType: 'image/jpeg' }))
const base = { centerName: 'Alpha', type: 'No Smoking', quantity: 1, siteId: 's1' }

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    for (const [uid, role] of [['mem', 'member'], ['mgr', 'manager'], ['adm', 'admin'], ['aud', 'auditor']]) {
      await setDoc(doc(db, 'users', uid), {
        orgId: ORG, role, status: 'approved', name: uid, email: `${uid}@t.co`, access: {}, siteId: '',
      })
    }
    const col = (id, data) => setDoc(doc(db, 'organizations', ORG, 'signages', id), data)
    await col('legacy', { ...base }) // written before status existed
    await col('planned', { ...base, status: 'Planned' })
    await col('deployed-bare', { ...base, status: 'Deployed', photo: null, lastChecked: '' })
    await col('deployed-full', { ...base, status: 'Deployed', photo: PHOTO, lastChecked: '2026-09-01' })
  })
})

describe('creating a signage record', () => {
  it('Deployed with a photo and a date is accepted', async () => {
    await assertSucceeds(setDoc(sign('mem', 'n1'), { ...base, status: 'Deployed', photo: PHOTO, lastChecked: '2026-09-01' }))
  })
  it.each([
    ['no photo key', { lastChecked: '2026-09-01' }],
    ['a null photo', { photo: null, lastChecked: '2026-09-01' }],
    ['an empty photo', { photo: {}, lastChecked: '2026-09-01' }],
    ['a photo that is not a map', { photo: 'yes', lastChecked: '2026-09-01' }],
    ['no date', { photo: PHOTO }],
    ['a blank date', { photo: PHOTO, lastChecked: '' }],
    ['neither', {}],
  ])('Deployed with %s is refused', async (_n, extra) => {
    await assertFails(setDoc(sign('mem', 'n2'), { ...base, status: 'Deployed', ...extra }))
  })
  it('Planned, Removed, and no status at all need nothing', async () => {
    await assertSucceeds(setDoc(sign('mem', 'n3'), { ...base, status: 'Planned' }))
    await assertSucceeds(setDoc(sign('mem', 'n4'), { ...base, status: 'Removed' }))
    await assertSucceeds(setDoc(sign('mem', 'n5'), { ...base }))
  })
})

describe('moving a stored record to Deployed', () => {
  it.each(['legacy', 'planned'])('from %s: refused without the evidence, allowed with it', async (id) => {
    await assertFails(updateDoc(sign('mem', id), { status: 'Deployed' }))
    await assertFails(updateDoc(sign('mem', id), { status: 'Deployed', photo: PHOTO }))
    await assertFails(updateDoc(sign('mem', id), { status: 'Deployed', lastChecked: '2026-09-01' }))
    await assertSucceeds(updateDoc(sign('mem', id), { status: 'Deployed', photo: PHOTO, lastChecked: '2026-09-01' }))
  })
  it('a manager is held to it as well — it is evidence, not a decision', async () => {
    await assertFails(updateDoc(sign('mgr', 'planned'), { status: 'Deployed' }))
    await assertFails(updateDoc(sign('adm', 'planned'), { status: 'Deployed' }))
  })
  it('an auditor still cannot write at all', async () => {
    await assertFails(updateDoc(sign('aud', 'planned'), { status: 'Planned', notes: 'x' }))
  })
})

describe('records that are already Deployed stay editable', () => {
  it('without a photo or date, for other fields', async () => {
    await assertSucceeds(updateDoc(sign('mem', 'deployed-bare'), { location: 'Gate 2', notes: 'repainted' }))
  })
  it('leaving Deployed is always allowed', async () => {
    await assertSucceeds(updateDoc(sign('mem', 'deployed-bare'), { status: 'Removed' }))
    await assertSucceeds(updateDoc(sign('mem', 'deployed-full'), { status: 'Planned' }))
  })
  it('the site-link batch (which touches neither field) still works', async () => {
    const db = as('mgr')
    const batch = writeBatch(db)
    batch.update(doc(db, 'organizations', ORG, 'signages', 'deployed-bare'), { siteId: 's2', centerName: 'Beta' })
    batch.update(doc(db, 'organizations', ORG, 'signages', 'legacy'), { siteId: 's2', centerName: 'Beta' })
    await assertSucceeds(batch.commit())
  })
})

describe('the photos list (and the legacy single photo)', () => {
  const D = { ...base, status: 'Deployed', lastChecked: '2026-09-01' }
  it('a photos list with one entry satisfies an ordinary type', async () => {
    await assertSucceeds(setDoc(sign('mem', 'l1'), { ...D, photos: PHOTOS(1) }))
    await assertSucceeds(setDoc(sign('mem', 'l2'), { ...D, photos: PHOTOS(3) }))
  })
  it.each([
    ['an empty list', { photos: [] }],
    ['a photos value that is not a list', { photos: 'yes' }],
    ['a null list', { photos: null }],
  ])('%s is refused', async (_n, extra) => {
    await assertFails(setDoc(sign('mem', 'l3'), { ...D, ...extra }))
  })
  it('an empty photos list is the truth: it does not fall back to the legacy photo', async () => {
    await assertFails(setDoc(sign('mem', 'l4'), { ...D, photos: [], photo: PHOTO }))
  })
  it('migrating a Planned record: photos list in, legacy photo removed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'signages', 'legacy-photo'), { ...base, status: 'Planned', photo: PHOTO })
    })
    // The legacy photo alone already counts as one for an ordinary type.
    await assertSucceeds(updateDoc(sign('mem', 'legacy-photo'), { status: 'Deployed', lastChecked: '2026-09-01' }))
  })
})

describe('the photo COUNT per type is not enforced', () => {
  const D = { ...base, status: 'Deployed', lastChecked: '2026-09-01' }
  it('Fire Extinguisher Sign: one photo is enough whatever the quantity', async () => {
    await assertSucceeds(setDoc(sign('mem', 'e1'), { ...D, type: 'Fire Extinguisher Sign', quantity: 5, photos: PHOTOS(1) }))
    await assertSucceeds(setDoc(sign('mem', 'e2'), { ...D, type: 'Fire Extinguisher Sign', quantity: 5, photo: PHOTO }))
  })
  it('FERP: one photo is enough whatever the floors', async () => {
    await assertSucceeds(setDoc(sign('mem', 'f1'), { ...D, type: 'FERP Signage', allFloors: true, totalFloors: 8, floorsCovered: 8, photos: PHOTOS(1) }))
    await assertSucceeds(setDoc(sign('mem', 'f2'), { ...D, type: 'FERP Signage', allFloors: false, totalFloors: 8, floorsCovered: 3, photos: PHOTOS(2) }))
  })
  it('but zero photos is still refused for them', async () => {
    await assertFails(setDoc(sign('mem', 'z1'), { ...D, type: 'Fire Extinguisher Sign', quantity: 5, photos: [] }))
    await assertFails(setDoc(sign('mem', 'z2'), { ...D, type: 'FERP Signage', allFloors: true, totalFloors: 3 }))
  })
  it('moving a stored Planned extinguisher sign to Deployed needs one photo and a date', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'signages', 'ext-planned'), { ...base, type: 'Fire Extinguisher Sign', quantity: 4, status: 'Planned' })
    })
    await assertFails(updateDoc(sign('mem', 'ext-planned'), { status: 'Deployed', lastChecked: '2026-09-01' }))
    await assertFails(updateDoc(sign('mem', 'ext-planned'), { status: 'Deployed', photos: PHOTOS(1) }))
    await assertSucceeds(updateDoc(sign('mem', 'ext-planned'), { status: 'Deployed', lastChecked: '2026-09-01', photos: PHOTOS(1) }))
  })
  it('an already-Deployed extinguisher record stays editable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'signages', 'ext-old'), { ...base, type: 'Fire Extinguisher Sign', quantity: 5, status: 'Deployed', photo: PHOTO })
    })
    await assertSucceeds(updateDoc(sign('mem', 'ext-old'), { quantity: 8, notes: 'more units' }))
  })
})

describe('other collections are untouched by the rule', () => {
  it('a record elsewhere with status Deployed and no photo is fine', async () => {
    await assertSucceeds(setDoc(doc(as('mem'), 'organizations', ORG, 'stretchers', 'x'), { status: 'Deployed' }))
  })
})
