// Own-database provisioning requests.
//
// A client may create a non-secret request and, in the same batch, reserve the
// organization name. It may not read the contact back unless it is a platform
// operator, it may not add a secret field, and it may not move status off
// `requested`. The public orgIndex row says the name uses its own sign-in.
// That is the whole grant. docs/CUSTOM-STACK.md.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
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

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'admin'), {
      orgId: 'orgA',
      role: 'admin',
      status: 'approved',
      name: 'Admin',
      email: 'admin@t.co',
    })
    await setDoc(doc(db, 'organizations', 'orgA'), { name: 'orgA', createdBy: 'admin' })
    await setDoc(doc(db, 'platformAdmins', 'ops'), { email: 'ops@t.co' })
  })
})

const anon = () => testEnv.unauthenticatedContext().firestore()
const as = (uid) => testEnv.authenticatedContext(uid).firestore()

function body(over = {}) {
  return {
    status: 'requested',
    orgName: 'Northwind Metals',
    address: 'Pune',
    contactName: 'Asha Rao',
    contactEmail: 'asha@northwind.test',
    handoffContact: 'asha@northwind.test',
    mode: 'bring',
    engine: 'mysql',
    authMethod: 'oidc',
    authIssuer: 'https://login.northwind.test/realms/staff',
    authClientId: 'ohsms-northwind',
    bucketMode: 'provision',
    bucketName: '',
    bucketRegion: '',
    presignUrl: '',
    createdAt: serverTimestamp(),
    ...over,
  }
}

async function file(db, data, requestId = 'reqNorthwind1') {
  const batch = writeBatch(db)
  batch.set(doc(db, 'provisioningRequests', requestId), data)
  batch.set(doc(db, 'orgIndex', data.orgName.trim().toLowerCase()), {
    name: data.orgName,
    stack: 'own',
    requestId,
  })
  await batch.commit()
}

describe('filing an own-database request', () => {
  it('lets anyone file a non-secret request and reserve the name', async () => {
    await assertSucceeds(file(anon(), body()))
    const index = await getDoc(doc(anon(), 'orgIndex', 'northwind metals'))
    expect(index.data()).toEqual({
      name: 'Northwind Metals',
      stack: 'own',
      requestId: 'reqNorthwind1',
    })
  })

  it('lets a signed-in person file one too', async () => {
    await assertSucceeds(
      file(
        as('mallory'),
        body({
          orgName: 'Harbor Glass',
          contactEmail: 'a@harbor.test',
          handoffContact: 'a@harbor.test',
        }),
        'reqHarborGlas1'
      )
    )
  })

  it('accepts any brought engine, including supabase, and a brought bucket', async () => {
    await assertSucceeds(
      file(
        anon(),
        body({
          orgName: 'Harbor Glass',
          contactEmail: 'a@harbor.test',
          handoffContact: 'a@harbor.test',
          engine: 'supabase',
          authMethod: 'supabase',
          authIssuer: 'https://harbor.supabase.co',
          authClientId: '',
          bucketMode: 'bring',
          bucketName: 'harbor-glass-files',
          bucketRegion: 'ap-south-1',
          presignUrl: 'https://files.harbor.test/sign',
        }),
        'reqHarborGlas1'
      )
    )
  })

  it('accepts WEEHS-provisioned Postgres and refuses another engine for that mode', async () => {
    await assertSucceeds(
      file(
        anon(),
        body({
          orgName: 'Keel Works',
          contactEmail: 'a@keel.test',
          handoffContact: 'a@keel.test',
          mode: 'weehs-operated',
          engine: 'postgres',
          authMethod: 'saml',
        }),
        'reqKeelWorks01'
      )
    )
    await assertFails(
      file(
        anon(),
        body({
          orgName: 'Keel Rival',
          contactEmail: 'a@rival.test',
          handoffContact: 'a@rival.test',
          mode: 'company-cloud',
          engine: 'supabase',
        }),
        'reqKeelRival01'
      )
    )
  })

  it('refuses a second reservation of the same name', async () => {
    await assertSucceeds(file(anon(), body()))
    await assertFails(file(anon(), body({ contactEmail: 'other@northwind.test' }), 'reqNorthwind2'))
  })

  it('refuses the request without the name reservation, and the reservation without the request', async () => {
    const db = anon()
    await assertFails(setDoc(doc(db, 'provisioningRequests', 'reqNorthwind1'), body()))
    await assertFails(
      setDoc(doc(db, 'orgIndex', 'northwind metals'), {
        name: 'Northwind Metals',
        stack: 'own',
        requestId: 'reqNorthwind1',
      })
    )
  })

  it('refuses a reservation that names a different organization than the request', async () => {
    const db = anon()
    const batch = writeBatch(db)
    batch.set(doc(db, 'provisioningRequests', 'reqNorthwind1'), body())
    batch.set(doc(db, 'orgIndex', 'other metals'), {
      name: 'Other Metals',
      stack: 'own',
      requestId: 'reqNorthwind1',
    })
    await assertFails(batch.commit())
  })

  it('refuses to reserve a name a WEEHS organization already holds', async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'orgIndex', 'northwind metals'), {
        orgId: 'orgA',
        name: 'Northwind Metals',
      })
    )
    await assertFails(file(anon(), body()))
  })
})

describe('what a client must not put on the request', () => {
  it.each([
    ['password', { password: 'hunter2' }],
    ['database url', { databaseUrl: 'postgres://u:p@db/app' }],
    ['service role', { serviceRoleKey: 'service_role_secret' }],
    ['client secret', { clientSecret: 'secret' }],
    ['master key', { DATA_KEY_MASTER: 'master' }],
    ['provisioned status', { status: 'provisioned' }],
    ['connection string engine', { engine: 'postgres://u:p@db/app' }],
    ['secret in the address', { address: 'DATA_KEY_MASTER=abc' }],
    [
      'userinfo in the issuer',
      { authIssuer: 'https://user:pass@login.northwind.test/realms/staff' },
    ],
    [
      'query on the presign url',
      {
        bucketMode: 'bring',
        bucketName: 'harbor-glass-files',
        bucketRegion: 'ap-south-1',
        presignUrl: 'https://files.harbor.test/sign?X-Amz-Credential=abc',
      },
    ],
  ])('refuses %s and leaves nothing behind', async (_label, extra) => {
    await assertFails(file(anon(), body(extra)))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'provisioningRequests', 'reqNorthwind1'))
      expect(snap.exists()).toBe(false)
    })
  })

  it('still refuses the WEEHS index shape to someone who is not registering an organization', async () => {
    await assertFails(
      setDoc(doc(anon(), 'orgIndex', 'northwind metals'), {
        orgId: 'orgEvil',
        name: 'Northwind Metals',
      })
    )
  })
})

describe('who can read and change a request', () => {
  beforeEach(async () => {
    await file(anon(), body())
  })

  it('hides the contact from anonymous readers and from a tenant admin', async () => {
    await assertFails(getDoc(doc(anon(), 'provisioningRequests', 'reqNorthwind1')))
    await assertFails(getDoc(doc(as('admin'), 'provisioningRequests', 'reqNorthwind1')))
    await assertFails(getDocs(collection(anon(), 'provisioningRequests')))
    await assertFails(getDocs(collection(as('admin'), 'provisioningRequests')))
  })

  it('lets a platform operator read it, and the document has no secret field', async () => {
    const snap = await getDoc(doc(as('ops'), 'provisioningRequests', 'reqNorthwind1'))
    expect(snap.exists()).toBe(true)
    expect(snap.data().status).toBe('requested')
    expect(snap.data().contactEmail).toBe('asha@northwind.test')
    expect(snap.data().password).toBeUndefined()
    expect(snap.data().DATA_KEY_MASTER).toBeUndefined()
    await assertSucceeds(getDocs(collection(as('ops'), 'provisioningRequests')))
  })

  it('refuses updates and deletes, including from the operator', async () => {
    for (const db of [anon(), as('admin'), as('ops')]) {
      await assertFails(
        updateDoc(doc(db, 'provisioningRequests', 'reqNorthwind1'), { status: 'provisioned' })
      )
      await assertFails(
        updateDoc(doc(db, 'provisioningRequests', 'reqNorthwind1'), { password: 'hunter2' })
      )
      await assertFails(deleteDoc(doc(db, 'provisioningRequests', 'reqNorthwind1')))
      await assertFails(
        updateDoc(doc(db, 'orgIndex', 'northwind metals'), {
          name: 'Northwind Metals',
          stack: 'own',
          requestId: 'reqOther00001',
        })
      )
      await assertFails(deleteDoc(doc(db, 'orgIndex', 'northwind metals')))
    }
  })
})

// Registration mail (functions/lib/registrationMail.js) keeps two server-only
// stores: the send-once ledger under each request, and mailThrottle, which
// caps mail to an address a stranger typed into the form. A client that could
// read the ledger would learn which requests were mailed; one that could write
// either could pre-claim a send (suppressing it) or reset a counter (lifting
// the cap). Neither has a match block, so both rely on the default deny —
// these hold that true if a later broad match is ever added.
describe('registration mail stores are server-only', () => {
  const ledger = (db) => doc(db, 'provisioningRequests', 'reqABCDEFGH12', 'notifications', 'n1')
  const throttle = (db) => doc(db, 'mailThrottle', 'abc123')

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(ledger(db), { kind: 'provisioning.received', status: 'sent' })
      await setDoc(throttle(db), { count: 3 })
    })
  })

  for (const [who, db] of [
    ['anonymous', () => anon()],
    ['a tenant admin', () => as('admin')],
    ['a platform operator', () => as('ops')],
  ]) {
    it(`refuses ${who} reading, pre-claiming or deleting a send`, async () => {
      await assertFails(getDoc(ledger(db())))
      await assertFails(
        getDocs(collection(db(), 'provisioningRequests', 'reqABCDEFGH12', 'notifications'))
      )
      await assertFails(
        setDoc(doc(db(), 'provisioningRequests', 'reqABCDEFGH12', 'notifications', 'n2'), {
          status: 'claimed',
        })
      )
      await assertFails(deleteDoc(ledger(db())))
    })

    it(`refuses ${who} reading or resetting the mail throttle`, async () => {
      await assertFails(getDoc(throttle(db())))
      await assertFails(setDoc(throttle(db()), { count: 0 }))
      await assertFails(updateDoc(throttle(db()), { count: 0 }))
      await assertFails(deleteDoc(throttle(db())))
      await assertFails(setDoc(doc(db(), 'mailThrottle', 'fresh'), { count: 0 }))
    })
  }
})
