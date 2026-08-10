// ─────────────────────────────────────────────────────────────────────────────
// The write-boundary fixes from the security audit, pinned.
//
// Every one of these was a rule that read the POST state, or a privilege the
// app gated only in React. They share a shape: the existing tests all sent
// well-behaved payloads, so the hole sat under a green suite. These send the
// payload an attacker would.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, deleteDoc, collection, addDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const VICTIM = 'orgVictim'
const ATTACKER = 'orgAttacker'

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
    for (const [org, uid] of [[VICTIM, 'vic'], [ATTACKER, 'mal']]) {
      await setDoc(doc(db, 'organizations', org), { name: org, createdBy: uid })
      await setDoc(doc(db, 'users', uid), {
        orgId: org, role: 'admin', status: 'approved', name: uid, email: `${uid}@t.co`,
      })
    }
    // A plain member and an auditor in the victim org.
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: VICTIM, role: 'member', status: 'approved', name: 'Mem', email: 'mem@t.co',
      siteId: 'site-1', access: { sites: ['site-1'], regions: [], entities: [] },
    })
    await setDoc(doc(db, 'users', 'aud'), {
      orgId: VICTIM, role: 'auditor', status: 'approved', name: 'Aud', email: 'aud@t.co',
    })
    // The victim's public QR mirrors.
    await setDoc(doc(db, 'qr', 'tok-ext'), {
      orgId: VICTIM, orgName: 'Victim Ltd', extId: 'EXT-1', kind: 'extinguisher', status: 'Active',
    })
    await setDoc(doc(db, 'permitQr', 'tok-permit'), {
      orgId: VICTIM, permitId: 'p1', storedStatus: 'closed',
    })
    // A LOTO procedure, tenanted by field rather than by path.
    await setDoc(doc(db, 'procedures', 'proc-1'), { orgId: VICTIM, title: 'Line 2 isolation' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

// The token is printed on the sticker — it is not a secret, only unguessable.
// So "attacker holds the token" is the realistic case, not a stretch.
describe('public QR mirrors cannot be captured by another tenant', () => {
  it('refuses re-pointing an extinguisher mirror into the attacker\'s org', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'qr', 'tok-ext'), { orgId: ATTACKER }))
  })

  it('refuses re-pointing a permit mirror', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'permitQr', 'tok-permit'), { orgId: ATTACKER }))
  })

  // Not just the orgId: with the old rule, one capture write made every later
  // write legitimate, so the mirror the next scanner reads could be rewritten.
  it('refuses a stranger rewriting what the next scanner will see', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'qr', 'tok-ext'), { status: 'Active', physicalDefects: [] }))
  })

  it('refuses a stranger deleting the mirror behind a printed label', async () => {
    await assertFails(deleteDoc(doc(as('mal'), 'qr', 'tok-ext')))
  })

  // The owner must still be able to maintain its own mirrors, or the fix has
  // simply broken the product.
  it('still lets the owning org update its own mirror', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'qr', 'tok-ext'), { status: 'Discharged' }))
    await assertSucceeds(updateDoc(doc(as('vic'), 'permitQr', 'tok-permit'), { storedStatus: 'approved' }))
  })

  it('still lets anyone scan one', async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'qr', 'tok-ext')))
  })
})

describe('LOTO documents cannot be captured by another tenant', () => {
  it('refuses rewriting another org\'s procedure into the attacker\'s org', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'procedures', 'proc-1'), { orgId: ATTACKER }))
  })

  it('refuses editing it in place', async () => {
    await assertFails(updateDoc(doc(as('mal'), 'procedures', 'proc-1'), { title: 'Safe to work' }))
  })

  it('still lets the owner edit its own', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'procedures', 'proc-1'), { title: 'Line 2 isolation v2' }))
  })
})

describe('a member cannot widen their own reach', () => {
  it('refuses self-granting extra sites', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), {
      access: { sites: ['site-1', 'site-2'], regions: ['South'], entities: [] },
    }))
  })

  it('refuses moving their own posting to another site', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), { siteId: 'site-9' }))
  })

  it('refuses granting themselves a whole region', async () => {
    await assertFails(updateDoc(doc(as('mem'), 'users', 'mem'), {
      access: { sites: ['site-1'], regions: ['South'], entities: [] },
    }))
  })

  // They must still be able to edit the harmless parts of their own profile,
  // and to ASK for access — the request is not the grant.
  it('still lets them edit their own name', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'users', 'mem'), { name: 'Mem Renamed' }))
  })

  it('still lets them request access without granting it', async () => {
    await assertSucceeds(updateDoc(doc(as('mem'), 'users', 'mem'), {
      accessRequest: { sites: ['site-2'], regions: [], entities: [] },
    }))
  })

  it('still lets an admin grant access', async () => {
    await assertSucceeds(updateDoc(doc(as('vic'), 'users', 'mem'), {
      access: { sites: ['site-1', 'site-2'], regions: [], entities: [] },
    }))
  })
})

describe('a joiner cannot choose an elevated role', () => {
  it('refuses self-joining as a manager', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'manager', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })

  it('refuses self-joining as an auditor', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'auditor', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })

  it('still lets them join as a pending member', async () => {
    await assertSucceeds(setDoc(doc(as('newbie'), 'users', 'newbie'), {
      orgId: VICTIM, role: 'member', status: 'pending', name: 'New', email: 'n@t.co',
    }))
  })
})

describe('auditor is read-only in the rules, not just in the UI', () => {
  it('refuses an auditor creating a record', async () => {
    await assertFails(
      addDoc(collection(as('aud'), 'organizations', VICTIM, 'incidents'), { title: 'invented' })
    )
  })

  it('refuses an auditor editing one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'real' })
    })
    await assertFails(
      updateDoc(doc(as('aud'), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'edited' })
    )
  })

  it('still lets an auditor read everything they are there to inspect', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations', VICTIM, 'incidents', 'i1'), { title: 'real' })
    })
    await assertSucceeds(getDoc(doc(as('aud'), 'organizations', VICTIM, 'incidents', 'i1')))
  })

  it('still lets a member write', async () => {
    await assertSucceeds(
      addDoc(collection(as('mem'), 'organizations', VICTIM, 'incidents'), { title: 'genuine' })
    )
  })
})
