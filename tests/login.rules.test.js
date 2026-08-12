// ─────────────────────────────────────────────────────────────────────────────
// The reads that happen between typing a password and seeing the portal.
//
// "Missing or insufficient permissions" at the login screen is the worst class
// of rules bug in this app: it locks out everyone at once, it names no
// collection, and it looks identical whether the cause is App Check, a rule, or
// one malformed document. Nothing pinned this path, so every diagnosis of it
// started from scratch.
//
// The sequence below is the real one, traced through the code:
//   AuthContext.jsx:157  getDoc(users/{uid})            — own profile
//   AuthContext.jsx:108  onSnapshot(organizations/{id}) — live org doc
//   Home.jsx:174         query(users, where orgId ==)   — the staff directory
//   Home.jsx:159         query(org/sites, orderBy name)
//   Home.jsx:172/178     query(org/<collection>, limit) — the portal burst
//
// The adversarial part is the seed data, not the queries. A rule that reads
// resource.data.<field> directly denies an entire query if a candidate document
// lacks that field, so these tests put the malformed documents IN the
// collection and then ask whether an ordinary approved admin can still sign in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, collection, query, where, orderBy, limit } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgAcme'
const OTHER = 'orgOther'
const ADMIN = 'adminUid'

// The collections the portal opens on mount (Home.jsx:144-147 and the Action
// Tracker's sources). Kept as a list so a new portal collection that cannot be
// read shows up here rather than at someone's login screen.
const PORTAL_COLLECTIONS = [
  'extinguishers', 'aeds', 'fas', 'signages', 'incidents',
  'consultations', 'mockDrills', 'permits', 'observations',
]

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
    await setDoc(doc(db, 'organizations', ORG), { name: 'Acme', createdBy: ADMIN })
    await setDoc(doc(db, 'organizations', OTHER), { name: 'Other', createdBy: 'x' })
    await setDoc(doc(db, 'users', ADMIN), {
      orgId: ORG, role: 'admin', status: 'approved', name: 'Admin', email: 'a@t.co',
    })
    // Ordinary colleagues, plus the states a real directory accumulates.
    await setDoc(doc(db, 'users', 'mate'), {
      orgId: ORG, role: 'member', status: 'approved', name: 'Mate', email: 'm@t.co',
    })
    await setDoc(doc(db, 'users', 'waiting'), {
      orgId: ORG, role: 'member', status: 'pending', name: 'Waiting', email: 'w@t.co',
    })
    await setDoc(doc(db, 'users', 'stranger'), {
      orgId: OTHER, role: 'admin', status: 'approved', name: 'Stranger', email: 's@t.co',
    })
    await setDoc(doc(db, 'organizations', ORG, 'sites', 'site-1'), { name: 'Plant 1' })
    for (const name of PORTAL_COLLECTIONS) {
      await setDoc(doc(db, 'organizations', ORG, name, 'row-1'), { title: 'x' })
    }
  })
})

const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore()

describe('signing in as an approved admin', () => {
  it('reads its own profile — the first call after the password is accepted', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'users', ADMIN)))
  })

  it('opens the live organization document', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'organizations', ORG)))
  })

  it('lists the staff directory for its own org', async () => {
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })

  it('lists the site registry', async () => {
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'organizations', ORG, 'sites'), orderBy('name'))))
  })

  it('opens every collection the portal mounts', async () => {
    const db = asAdmin()
    for (const name of PORTAL_COLLECTIONS) {
      await assertSucceeds(getDocs(query(collection(db, 'organizations', ORG, name), limit(5000))))
    }
  })
})

// Each of these seeds one malformed document and then repeats the sign-in. The
// question is never "is the bad document readable" — it is "does one bad
// document take the whole login down with it", which is what a rule that reads
// resource.data.<field> directly can do.
describe('a malformed document in the directory does not lock everyone out', () => {
  const seed = async (uid, data) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), data)
    })
  }

  it('survives a legacy profile with no orgId at all', async () => {
    await seed('legacy', { role: 'member', status: 'approved', name: 'Legacy' })
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })

  it('survives a profile whose orgId is null', async () => {
    await seed('nulled', { orgId: null, role: 'member', status: 'approved', name: 'Nulled' })
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })

  it('survives a profile in this org with no status', async () => {
    await seed('nostatus', { orgId: ORG, role: 'member', name: 'No Status' })
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })

  it('survives a profile in this org with no role', async () => {
    await seed('norole', { orgId: ORG, status: 'approved', name: 'No Role' })
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })

  // Every candidate document re-evaluates isApprovedMemberOf, which reaches for
  // the caller's own profile. Rules cap document access per request, so a big
  // directory is the case where a rule that passes on four users stops passing.
  it('survives a directory large enough to test the rule access budget', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      for (let i = 0; i < 60; i++) {
        await setDoc(doc(db, 'users', `bulk-${i}`), {
          orgId: ORG, role: 'member', status: 'approved', name: `Bulk ${i}`, email: `b${i}@t.co`,
        })
      }
    })
    const db = asAdmin()
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
  })
})

// The boundary the directory read must not cross. If these ever pass, the fix
// for the tests above went too far.
describe('the directory stays inside its own tenant', () => {
  it('refuses an unfiltered list of every user in the database', async () => {
    await assertFails(getDocs(collection(asAdmin(), 'users')))
  })

  it('refuses listing another organization by name', async () => {
    const db = asAdmin()
    await assertFails(getDocs(query(collection(db, 'users'), where('orgId', '==', OTHER))))
  })

  it('refuses a pending member the directory', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'pend'), {
        orgId: ORG, role: 'member', status: 'pending', name: 'Pend', email: 'p@t.co',
      })
    })
    const db = testEnv.authenticatedContext('pend').firestore()
    await assertFails(getDocs(query(collection(db, 'users'), where('orgId', '==', ORG))))
    // …but it can always read itself, or it could never reach the pending screen.
    await assertSucceeds(getDoc(doc(db, 'users', 'pend')))
  })
})
