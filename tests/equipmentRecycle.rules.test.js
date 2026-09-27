// Soft-delete of extinguishers, AEDs and fire-alarm panels.
//
// deletedAt used to be an ordinary field, so any member could set it, and the
// hard delete was any manager. The bin is now a real retention step: changing
// deletedAt takes a manager who can reach the unit, and destroying the
// document takes an org admin. These send the writes a console would send.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'

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
const anon = () => testEnv.unauthenticatedContext().firestore()
const ext = (uid, id = 'e-1') => doc(as(uid), 'organizations', ORG, 'extinguishers', id)

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    const people = [
      ['adm', 'admin', {}],
      ['mgr', 'manager', { sites: ['site-a'], regions: [], entities: [] }],
      ['reg', 'manager', { sites: [], regions: ['South'], entities: [] }],
      ['ent', 'manager', { sites: [], regions: [], entities: ['COCO'] }],
      ['out', 'manager', { sites: ['site-z'], regions: ['North'], entities: ['Other'] }],
      ['mem', 'member', { sites: ['site-a'], regions: [], entities: [] }],
      ['aud', 'auditor', {}],
    ]
    for (const [uid, role, access] of people) {
      await setDoc(doc(db, 'users', uid), {
        orgId: ORG,
        role,
        status: 'approved',
        name: uid,
        email: `${uid}@t.co`,
        access,
        siteId: '',
      })
    }
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'e-1'), {
      serialNo: 'FE-0001',
      siteId: 'site-a',
      region: 'South',
      entity: 'COCO',
      qrToken: 'tok-1',
      status: 'active',
      deletedAt: null,
    })
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'e-old'), {
      serialNo: 'FE-OLD',
      siteId: 'site-a',
      region: 'South',
      entity: 'COCO',
      status: 'active',
    })
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'e-bin'), {
      serialNo: 'FE-0009',
      siteId: 'site-a',
      region: 'South',
      entity: 'COCO',
      qrToken: 'tok-bin',
      deletedAt: new Date(),
      deletedBy: 'mgr',
    })
    await setDoc(doc(db, 'qr', 'tok-1'), {
      orgId: ORG,
      extId: 'e-1',
      token: 'tok-1',
      status: 'active',
      serialNo: 'FE-0001',
    })
    await setDoc(doc(db, 'qr', 'tok-bin'), {
      orgId: ORG,
      extId: 'e-bin',
      token: 'tok-bin',
      status: 'active',
      deletedAt: new Date(),
    })
  })
})

describe('who may move an extinguisher into the bin and back', () => {
  it('lets a manager who holds the site, the region, or the entity', async () => {
    await assertSucceeds(updateDoc(ext('mgr'), { deletedAt: new Date(), deletedBy: 'mgr' }))
    await assertSucceeds(updateDoc(ext('reg', 'e-bin'), { deletedAt: null, deletedBy: null }))
    await assertSucceeds(updateDoc(ext('ent', 'e-1'), { deletedAt: new Date() }))
  })

  it('lets an org admin, including a unit they have no site grant for', async () => {
    await assertSucceeds(updateDoc(ext('adm'), { deletedAt: new Date(), deletedBy: 'adm' }))
  })

  it('refuses a manager outside the unit, a member, and an auditor', async () => {
    await assertFails(updateDoc(ext('out'), { deletedAt: new Date(), deletedBy: 'out' }))
    await assertFails(updateDoc(ext('mem'), { deletedAt: new Date(), deletedBy: 'mem' }))
    await assertFails(updateDoc(ext('aud'), { deletedAt: new Date() }))
    await assertFails(updateDoc(ext('mem', 'e-bin'), { deletedAt: null, deletedBy: null }))
    await assertFails(updateDoc(ext('out', 'e-bin'), { deletedAt: null }))
  })

  it("refuses a delete that also moves the unit onto the writer's site", async () => {
    await assertFails(updateDoc(ext('out'), { deletedAt: new Date(), siteId: 'site-z' }))
  })

  it('still lets a member edit a live unit, and backfill a missing deletedAt to null', async () => {
    await assertSucceeds(updateDoc(ext('mem'), { status: 'closed' }))
    await assertSucceeds(updateDoc(ext('mem', 'e-old'), { deletedAt: null }))
  })

  it('refuses a create that is born already deleted', async () => {
    await assertFails(
      setDoc(ext('adm', 'e-new'), {
        serialNo: 'FE-NEW',
        siteId: 'site-a',
        deletedAt: new Date('2020-01-01'),
      })
    )
    await assertSucceeds(
      setDoc(ext('mem', 'e-new'), {
        serialNo: 'FE-NEW',
        siteId: 'site-a',
        status: 'active',
      })
    )
  })
})

describe('permanent delete is the org admin', () => {
  it('lets an admin destroy the document and refuses a manager', async () => {
    await assertFails(deleteDoc(ext('mgr')))
    await assertFails(deleteDoc(ext('out', 'e-bin')))
    await assertSucceeds(deleteDoc(ext('adm', 'e-bin')))
  })
})

describe('the public QR mirror stays, and says deleted only with the asset', () => {
  const mirror = (uid, token) => doc(as(uid), 'qr', token)

  it('refuses a mirror flagged deleted while the asset is still live', async () => {
    await assertFails(updateDoc(mirror('mgr', 'tok-1'), { deletedAt: new Date() }))
  })

  it('accepts the flag in the same batch that retires the asset', async () => {
    const db = as('mgr')
    const batch = writeBatch(db)
    batch.update(doc(db, 'organizations', ORG, 'extinguishers', 'e-1'), {
      deletedAt: new Date(),
      deletedBy: 'mgr',
    })
    batch.set(doc(db, 'qr', 'tok-1'), { deletedAt: new Date() }, { merge: true })
    await assertSucceeds(batch.commit())
  })

  it('refuses a scan report against a deleted unit, and still accepts a live one', async () => {
    const report = {
      source: 'qr',
      kind: 'defect',
      approvalStatus: 'pending',
      reportedBy: 'public',
      extId: 'e-bin',
      note: 'pin missing',
      token: 'tok-bin',
    }
    await assertFails(setDoc(doc(anon(), 'organizations', ORG, 'reports', 'r-bin'), report))
    await assertSucceeds(
      setDoc(doc(anon(), 'organizations', ORG, 'reports', 'r-live'), {
        ...report,
        extId: 'e-1',
        token: 'tok-1',
      })
    )
  })

  it('refuses a member stripping the mirror of a unit that still exists', async () => {
    await assertFails(deleteDoc(mirror('mem', 'tok-1')))
    await assertSucceeds(deleteDoc(mirror('adm', 'tok-bin')))
  })
})
