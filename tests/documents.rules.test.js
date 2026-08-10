// ─────────────────────────────────────────────────────────────────────────────
// Site-scoped document reads.
//
// The rule is only worth anything if two things hold at once: a member cannot
// GET a document for a site they cannot reach, and the query the app actually
// runs still returns the ones they can. Firestore rules are not filters, so the
// second half fails loudly the moment the query stops matching the rule — and
// the module service turns a read failure into an empty list, which on screen
// looks like a library with nothing in it. Both halves are tested here.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc, deleteDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'ohsms-demo'
const ORG = 'orgA'

let testEnv

const user = (uid, extra = {}) => ({
  orgId: ORG, role: 'member', status: 'approved', name: uid, email: `${uid}@t.co`, ...extra,
})

// One site-level document, and everything a viewer might be judged against.
const SITE_DOC = {
  title: 'Plant 2 evacuation plan',
  level: 'site',
  siteId: 'site-plant2',
  site: 'Plant 2',
  visibility: 'site',
  siteRegion: 'South',
  siteEntity: 'COCO',
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: ORG, createdBy: 'admin1' })

    await setDoc(doc(db, 'users', 'admin1'), user('admin1', { role: 'admin' }))
    await setDoc(doc(db, 'users', 'manager1'), user('manager1', { role: 'manager' }))
    await setDoc(doc(db, 'users', 'auditor1'), user('auditor1', { role: 'auditor' }))
    // The restricted cases: a member with no reach, then one of each way of
    // reaching the site the document belongs to.
    await setDoc(doc(db, 'users', 'outsider'), user('outsider'))
    await setDoc(doc(db, 'users', 'bySite'), user('bySite', { access: { sites: ['site-plant2'] } }))
    await setDoc(doc(db, 'users', 'byPosting'), user('byPosting', { siteId: 'site-plant2' }))
    await setDoc(doc(db, 'users', 'byRegion'), user('byRegion', { access: { regions: ['South'] } }))
    await setDoc(doc(db, 'users', 'byEntity'), user('byEntity', { access: { entities: ['COCO'] } }))
    await setDoc(doc(db, 'users', 'wrongSite'), user('wrongSite', { access: { sites: ['site-other'] } }))
    // Another org entirely.
    await setDoc(doc(db, 'organizations', 'orgB'), { name: 'orgB', createdBy: 'stranger' })
    await setDoc(doc(db, 'users', 'stranger'), user('stranger', { orgId: 'orgB' }))

    const docs = collection(db, 'organizations', ORG, 'documents')
    await setDoc(doc(docs, 'siteDoc'), SITE_DOC)
    await setDoc(doc(docs, 'orgDoc'), { title: 'HSE Policy', level: 'org', visibility: 'all', siteId: '' })
    // Written before the field existed. Must keep the access it has today.
    await setDoc(doc(docs, 'legacyDoc'), { title: 'Old SOP', version: '1.0' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const getDocument = (uid, id) => getDoc(doc(as(uid), 'organizations', ORG, 'documents', id))

describe('a site-level document is readable only by people who reach that site', () => {
  it('refuses a member with no access to the site', async () => {
    await assertFails(getDocument('outsider', 'siteDoc'))
  })

  it('refuses a member whose access names a different site', async () => {
    await assertFails(getDocument('wrongSite', 'siteDoc'))
  })

  it('allows a member granted that site explicitly', async () => {
    await assertSucceeds(getDocument('bySite', 'siteDoc'))
  })

  // Their own posting counts, exactly as resolveAccessibleSites() has it.
  it('allows a member posted to that site', async () => {
    await assertSucceeds(getDocument('byPosting', 'siteDoc'))
  })

  it('allows a member granted the whole region', async () => {
    await assertSucceeds(getDocument('byRegion', 'siteDoc'))
  })

  it('allows a member granted the whole entity', async () => {
    await assertSucceeds(getDocument('byEntity', 'siteDoc'))
  })

  it('refuses another org entirely, however they are mapped', async () => {
    await assertFails(getDocument('stranger', 'siteDoc'))
  })
})

describe('elevated roles are not site-scoped', () => {
  it('lets an admin read it', async () => {
    await assertSucceeds(getDocument('admin1', 'siteDoc'))
  })

  it('lets a manager read it', async () => {
    await assertSucceeds(getDocument('manager1', 'siteDoc'))
  })

  it('lets an auditor read it', async () => {
    await assertSucceeds(getDocument('auditor1', 'siteDoc'))
  })
})

describe('everything else in the library stays org-wide', () => {
  it('lets an unmapped member read an organization-level document', async () => {
    await assertSucceeds(getDocument('outsider', 'orgDoc'))
  })

  it('still refuses another org its neighbour\'s org-level document', async () => {
    await assertFails(getDocument('stranger', 'orgDoc'))
  })
})

// This is the sharp edge of the design, pinned so nobody softens it by accident.
//
// The rule reads `visibility` directly because that is the only form Firestore
// can use to constrain a list query — every defensive alternative leaves an
// unfiltered list returning the whole collection. Direct access to a field that
// is not there errors, and an erroring rule denies. So a document that has not
// been stamped is readable by NOBODY except elevated roles, which is precisely
// why the backfill has to run before these rules do.
describe('a document that predates the field', () => {
  it('is refused even to a member who could see everything before', async () => {
    await assertFails(getDocument('outsider', 'legacyDoc'))
  })

  it('is still reachable by an admin, so the gap is recoverable', async () => {
    await assertSucceeds(getDocument('admin1', 'legacyDoc'))
  })
})

// A document claiming to be site-scoped while naming no site cannot be checked
// against anything, so it must fail closed rather than fall through to open.
describe('a site-scoped document that names no site', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'documents', 'nameless'), {
        title: 'Nameless', level: 'site', visibility: 'site', siteId: '',
      })
    })
  })

  it('is refused to a member', async () => {
    await assertFails(getDocument('outsider', 'nameless'))
  })

  it('is still readable by an admin, so it can be found and fixed', async () => {
    await assertSucceeds(getDocument('admin1', 'nameless'))
  })
})

// The half that breaks the app rather than leaking it.
describe('listing the library', () => {
  const docsOf = (uid) => collection(as(uid), 'organizations', ORG, 'documents')

  it('refuses an unfiltered list to a restricted member', async () => {
    // Rules are not filters: one unreadable row fails the whole query. This is
    // exactly why the module cannot keep asking for the collection.
    await assertFails(getDocs(docsOf('outsider')))
  })

  it('allows the queries the app actually runs for that member', async () => {
    await assertSucceeds(getDocs(query(docsOf('outsider'), where('visibility', '==', 'all'))))
  })

  it('allows a member to list the sites they can reach', async () => {
    await assertSucceeds(
      getDocs(query(docsOf('bySite'), where('siteId', 'in', ['site-plant2'])))
    )
  })

  it('refuses a member asking for a site they cannot reach', async () => {
    await assertFails(getDocs(query(docsOf('outsider'), where('siteId', 'in', ['site-plant2']))))
  })

  it('lets an elevated viewer list the whole library in one query', async () => {
    await assertSucceeds(getDocs(docsOf('manager1')))
    await assertSucceeds(getDocs(docsOf('auditor1')))
  })
})

// Narrowing reads must not have narrowed anything else.
describe('writing is unchanged', () => {
  it('a member can still create and update a document', async () => {
    const db = as('outsider')
    const ref = doc(db, 'organizations', ORG, 'documents', 'newDoc')
    await assertSucceeds(setDoc(ref, { title: 'New', level: 'org', visibility: 'all' }))
    await assertSucceeds(setDoc(ref, { title: 'New v2', level: 'org', visibility: 'all' }))
  })

  it('a member still cannot delete one', async () => {
    await assertFails(deleteDoc(doc(as('outsider'), 'organizations', ORG, 'documents', 'orgDoc')))
  })

  it('a manager still can', async () => {
    await assertSucceeds(deleteDoc(doc(as('manager1'), 'organizations', ORG, 'documents', 'orgDoc')))
  })

  it('another org still cannot write into this one', async () => {
    await assertFails(
      setDoc(doc(as('stranger'), 'organizations', ORG, 'documents', 'evil'), { title: 'no' })
    )
  })
})

// The generic /{col}/{docId} rule grants read to any approved member. If
// `documents` were not excluded from it, every test above would pass for the
// wrong reason — the union would hand the access straight back. Other
// collections must keep working, which is what proves the exclusion was
// surgical rather than a blanket lockout.
describe('the exclusion from the generic rule is surgical', () => {
  it('a member can still read a different collection org-wide', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', ORG, 'incidents', 'i1'), { title: 'x' })
    })
    await assertSucceeds(getDoc(doc(as('outsider'), 'organizations', ORG, 'incidents', 'i1')))
    await assertSucceeds(getDocs(collection(as('outsider'), 'organizations', ORG, 'incidents')))
  })
})
