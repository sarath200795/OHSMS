// ─────────────────────────────────────────────────────────────────────────────
// Module entitlements, and the platform grant that governs them.
//
// The property under test is one sentence: an organization cannot give itself
// modules. Everything below is a way of trying, from the position that matters
// — an admin of the tenant, who is the most privileged person the product has
// and is still not the person who decides this.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgAcme'
const OTHER = 'orgRival'

// uid → who they are
//   own  — admin of ORG
//   mem  — approved member of ORG
//   pend — pending joiner of ORG
//   riv  — admin of OTHER
//   ops  — holds the platform grant (and is a plain member of OTHER, to prove
//          the grant is what carries the authority, not the role)
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
    for (const org of [ORG, OTHER]) {
      await setDoc(doc(db, 'organizations', org), { name: org, createdBy: 'own' })
    }
    const people = [
      ['own', ORG, 'admin', 'approved'],
      ['mem', ORG, 'member', 'approved'],
      ['pend', ORG, 'member', 'pending'],
      ['riv', OTHER, 'admin', 'approved'],
      ['ops', OTHER, 'member', 'approved'],
    ]
    for (const [uid, orgId, role, status] of people) {
      await setDoc(doc(db, 'users', uid), { orgId, role, status, name: uid, email: `${uid}@t.co` })
    }
    // The grant. Written here the only way it can be written: out of band.
    await setDoc(doc(db, 'platformAdmins', 'ops'), { email: 'ops@t.co', note: 'platform owner' })
    // The shape the product actually ships: an operator account belonging to NO
    // organization. It gets no /users document at all — deliberately, so it can
    // never be mistaken for a member of a tenant.
    await setDoc(doc(db, 'platformAdmins', 'lone'), { email: 'lone@t.co', note: 'operator, no org' })
    await setDoc(doc(db, 'moduleEntitlements', ORG), {
      modules: { incidents: true, loto: false },
      updatedAt: new Date(),
      updatedBy: 'ops',
      updatedByEmail: 'ops@t.co',
    })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

const payload = (uid, modules) => ({
  modules,
  updatedAt: new Date(),
  updatedBy: uid,
  updatedByEmail: `${uid}@t.co`,
})

describe('the platform grant itself', () => {
  it('lets a signed-in user ask whether THEY hold it', async () => {
    await assertSucceeds(getDoc(doc(as('ops'), 'platformAdmins', 'ops')))
    // And a plain no for everyone else, without an error the console shouts about.
    const snap = await getDoc(doc(as('own'), 'platformAdmins', 'own'))
    expect(snap.exists()).toBe(false)
  })

  it('refuses reading someone ELSE\'s grant', async () => {
    await assertFails(getDoc(doc(as('own'), 'platformAdmins', 'ops')))
  })

  // Listing would turn "am I an operator?" into a roster of the platform's
  // operators — a target list for anyone who can sign up.
  it('refuses enumerating the operators', async () => {
    await assertFails(getDocs(collection(as('own'), 'platformAdmins')))
    await assertFails(getDocs(collection(as('ops'), 'platformAdmins')))
  })

  it('refuses an org admin minting themselves the grant', async () => {
    await assertFails(setDoc(doc(as('own'), 'platformAdmins', 'own'), { email: 'own@t.co' }))
  })

  // Including the operator: nothing in the app writes this collection, so a
  // compromised operator session cannot add a second operator either.
  it('refuses even an operator granting it to someone else', async () => {
    await assertFails(setDoc(doc(as('ops'), 'platformAdmins', 'own'), { email: 'own@t.co' }))
    await assertFails(deleteDoc(doc(as('ops'), 'platformAdmins', 'ops')))
  })

  it('refuses an anonymous read', async () => {
    await assertFails(getDoc(doc(anon(), 'platformAdmins', 'ops')))
  })
})

describe('an organization cannot give itself modules', () => {
  it('refuses its own admin switching one back on', async () => {
    await assertFails(updateDoc(doc(as('own'), 'moduleEntitlements', ORG), { 'modules.loto': true }))
  })

  it('refuses its own admin replacing the document wholesale', async () => {
    await assertFails(setDoc(doc(as('own'), 'moduleEntitlements', ORG), payload('own', { loto: true })))
  })

  // Deleting restores the default, which is the full product — so delete is
  // exactly as much of a privilege escalation as an update, and is refused.
  it('refuses its own admin deleting the document to get the default back', async () => {
    await assertFails(deleteDoc(doc(as('own'), 'moduleEntitlements', ORG)))
  })

  it('refuses an org that has never been configured writing its first record', async () => {
    await assertFails(setDoc(doc(as('riv'), 'moduleEntitlements', OTHER), payload('riv', { loto: true })))
  })

  it('refuses one tenant editing another\'s entitlement', async () => {
    await assertFails(setDoc(doc(as('riv'), 'moduleEntitlements', ORG), payload('riv', { loto: true })))
  })
})

describe('an organization can read what it has been given', () => {
  it('lets an approved member read their own record', async () => {
    const snap = await getDoc(doc(as('mem'), 'moduleEntitlements', ORG))
    expect(snap.data().modules.loto).toBe(false)
  })

  it('refuses a member reading another tenant\'s record', async () => {
    await assertFails(getDoc(doc(as('mem'), 'moduleEntitlements', OTHER)))
  })

  // A pending joiner has no tenant yet; /pending is the whole of their app.
  it('refuses a pending joiner', async () => {
    await assertFails(getDoc(doc(as('pend'), 'moduleEntitlements', ORG)))
  })

  it('refuses an anonymous read', async () => {
    await assertFails(getDoc(doc(anon(), 'moduleEntitlements', ORG)))
  })

  // The console lists every organization on the platform; nobody else may.
  it('refuses a tenant admin listing the collection', async () => {
    await assertFails(getDocs(collection(as('own'), 'moduleEntitlements')))
  })
})

describe('the platform operator', () => {
  it('may list every organization\'s entitlement', async () => {
    await assertSucceeds(getDocs(collection(as('ops'), 'moduleEntitlements')))
  })

  it('may read a tenant they are not a member of', async () => {
    await assertSucceeds(getDoc(doc(as('ops'), 'moduleEntitlements', ORG)))
  })

  it('may switch a module off, and back on', async () => {
    await assertSucceeds(setDoc(doc(as('ops'), 'moduleEntitlements', ORG), payload('ops', { incidents: false, loto: false })))
    await assertSucceeds(setDoc(doc(as('ops'), 'moduleEntitlements', ORG), payload('ops', { incidents: true, loto: true })))
  })

  it('may create a record for an org that has none', async () => {
    await assertSucceeds(setDoc(doc(as('ops'), 'moduleEntitlements', OTHER), payload('ops', { cctv: false })))
  })

  it('may delete a record to restore the default', async () => {
    await assertSucceeds(deleteDoc(doc(as('ops'), 'moduleEntitlements', ORG)))
  })

  // The document is readable by every member of the tenant, so it is not a
  // place to park anything else.
  it('cannot park unrelated fields in a document the whole tenant reads', async () => {
    await assertFails(setDoc(doc(as('ops'), 'moduleEntitlements', ORG), {
      ...payload('ops', { loto: false }),
      internalNotes: 'renewal at risk, chasing payment',
    }))
  })

  it('cannot write a record attributed to somebody else', async () => {
    await assertFails(setDoc(doc(as('ops'), 'moduleEntitlements', ORG), payload('own', { loto: false })))
  })

  // The console's guard never asks for a tenant profile, so the rules must not
  // either — otherwise the dedicated operator account, which is the recommended
  // way to run this, could read the console and save nothing from it.
  it('works with no tenant profile at all — no /users document, no org', async () => {
    await assertSucceeds(getDocs(collection(as('lone'), 'moduleEntitlements')))
    await assertSucceeds(getDoc(doc(as('lone'), 'moduleEntitlements', ORG)))
    await assertSucceeds(setDoc(doc(as('lone'), 'moduleEntitlements', ORG), payload('lone', { loto: false })))
    await assertSucceeds(deleteDoc(doc(as('lone'), 'moduleEntitlements', OTHER)))
  })

  // Belt and braces on the same account: being profile-less is not itself a
  // privilege. Without the grant it reaches nothing.
  it('a profile-less account WITHOUT the grant reaches nothing', async () => {
    await assertFails(getDocs(collection(as('nobody'), 'moduleEntitlements')))
    await assertFails(getDoc(doc(as('nobody'), 'moduleEntitlements', ORG)))
    await assertFails(setDoc(doc(as('nobody'), 'moduleEntitlements', ORG), payload('nobody', { loto: false })))
  })

  it('cannot write a modules field that is not a map', async () => {
    await assertFails(setDoc(doc(as('ops'), 'moduleEntitlements', ORG), {
      ...payload('ops', {}), modules: 'all',
    }))
  })
})
