// Hostile payloads against the write surfaces that take free text.
//
// A rules test that only sends the shape the form sends tests the app. These
// send the extra key, the megabyte string, the nested map, and the approval
// status a stranger would set to skip the queue.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
let testEnv

const ORG = 'orgA'
const huge = 'x'.repeat(2000)

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
    await setDoc(doc(db, 'organizations', ORG), { name: 'Acme', createdBy: 'alice' })
    await setDoc(doc(db, 'users', 'alice'), {
      orgId: ORG,
      role: 'admin',
      status: 'approved',
      name: 'Alice',
      email: 'a@t.co',
    })
    await setDoc(doc(db, 'organizations', ORG, 'extinguishers', 'ext1'), { qrToken: 'tok1' })
    await setDoc(doc(db, 'organizations', ORG, 'permits', 'p1'), { qrToken: 'ptok' })
    await setDoc(doc(db, 'qr', 'tok1'), { orgId: ORG, extId: 'ext1', token: 'tok1' })
    await setDoc(doc(db, 'permitQr', 'ptok'), { orgId: ORG, permitId: 'p1', token: 'ptok' })
  })
})

const alice = () => testEnv.authenticatedContext('alice').firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

const extReport = {
  source: 'qr',
  kind: 'defect',
  approvalStatus: 'pending',
  reportedBy: 'public',
  extId: 'ext1',
  note: 'pin missing',
  token: 'tok1',
}

describe('anonymous QR writes reject unbounded values', () => {
  it('refuses a report timestamp that is a string or a map', async () => {
    const db = anon()
    await assertFails(
      setDoc(doc(db, 'organizations', ORG, 'reports', 'r1'), { ...extReport, reportedAt: huge })
    )
    await assertFails(
      setDoc(doc(db, 'organizations', ORG, 'reports', 'r2'), {
        ...extReport,
        reportedAt: { blob: huge },
      })
    )
    await assertFails(
      setDoc(doc(db, 'organizations', ORG, 'reports', 'r3'), { ...extReport, createdAt: huge })
    )
  })

  it('still accepts a real timestamp on that report', async () => {
    await assertSucceeds(
      setDoc(doc(anon(), 'organizations', ORG, 'reports', 'r4'), {
        ...extReport,
        reportedAt: new Date(),
      })
    )
  })

  it('refuses a token used as a blob', async () => {
    await assertFails(
      setDoc(doc(anon(), 'organizations', ORG, 'reports', 'r5'), {
        ...extReport,
        token: huge,
      })
    )
    await assertFails(
      setDoc(doc(anon(), 'organizations', ORG, 'defectLocks', 'ext1__pin'), {
        extId: 'ext1',
        defectType: 'pin',
        token: huge,
        createdAt: new Date(),
      })
    )
  })

  it('refuses an observation time that is a map, and a pre-set approval', async () => {
    const scan = {
      source: 'qr',
      approvalStatus: 'pending',
      observedBy: 'public',
      type: 'unsafe',
      permitId: 'p1',
      note: 'no watch',
      token: 'ptok',
    }
    await assertFails(
      setDoc(doc(anon(), 'organizations', ORG, 'observations', 'o1'), {
        ...scan,
        at: { blob: huge },
      })
    )
    await assertFails(
      setDoc(doc(anon(), 'organizations', ORG, 'observations', 'o2'), { ...scan, at: huge })
    )
    await assertSucceeds(
      setDoc(doc(anon(), 'organizations', ORG, 'observations', 'o3'), { ...scan, at: new Date() })
    )
  })
})

describe('public mirrors reject unbounded values', () => {
  it('refuses a megabyte location on an equipment mirror', async () => {
    await assertFails(
      setDoc(doc(alice(), 'qr', 'tok1'), {
        orgId: ORG,
        extId: 'ext1',
        token: 'tok1',
        location: huge,
      })
    )
  })

  it('still accepts the short extinguisher mirror', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'qr', 'tok1'), {
        orgId: ORG,
        orgName: 'Acme',
        extId: 'ext1',
        token: 'tok1',
        serialNo: 'FE-1',
        type: 'CO2',
        capacity: '5kg',
        status: 'Active',
        centerName: 'Bay',
        physicalDefects: ['pin'],
        updatedAt: new Date(),
      })
    )
  })

  it('refuses a nested extra key and a huge job description on a permit mirror', async () => {
    const base = {
      orgId: ORG,
      orgName: 'Acme',
      permitId: 'p1',
      token: 'ptok',
      permitNo: 'PTW-1',
      storedStatus: 'approved',
      engineering: { status: 'approved' },
      operations: { status: 'pending' },
      hazards: ['Fire'],
      ppe: [],
      precautions: [],
      jsa: [],
      participantCount: 1,
      fireWatcherCount: 0,
      hasConfinedWatcher: false,
      withdrawn: false,
    }
    await assertSucceeds(setDoc(doc(alice(), 'permitQr', 'ptok'), base))
    // A live permit ticks a full checklist. That write has to stay under the
    // rules expression ceiling or the printed QR stops updating.
    const full = {
      ...base,
      hazards: Array.from({ length: 22 }, (_, i) => `Hazard ${i}`),
      ppe: Array.from({ length: 14 }, (_, i) => `PPE ${i}`),
      precautions: Array.from({ length: 24 }, (_, i) => `Precaution ${i}`),
      jsa: [{ step: 'Set up', hazard: 'Sparks', precaution: 'Screen' }],
    }
    await assertSucceeds(setDoc(doc(alice(), 'permitQr', 'ptok'), full))
    await assertFails(setDoc(doc(alice(), 'permitQr', 'ptok'), {
      ...base, hazards: ['h'.repeat(200)],
    }))
    await assertFails(
      setDoc(doc(alice(), 'permitQr', 'ptok'), {
        ...base,
        engineering: { status: 'approved', note: huge },
      })
    )
    await assertFails(
      setDoc(doc(alice(), 'permitQr', 'ptok'), { ...base, jobDescription: 'j'.repeat(4001) })
    )
  })
})

describe('signup profiles reject extra keys and huge names', () => {
  it('still lets someone join as a pending member', async () => {
    const newbie = testEnv.authenticatedContext('newbie').firestore()
    await assertSucceeds(
      setDoc(doc(newbie, 'users', 'newbie'), {
        orgId: ORG,
        role: 'member',
        status: 'pending',
        name: 'Newbie',
        email: 'n@t.co',
      })
    )
  })

  it('refuses an extra key and a huge name on that profile', async () => {
    const newbie = testEnv.authenticatedContext('newbie').firestore()
    await assertFails(
      setDoc(doc(newbie, 'users', 'newbie'), {
        orgId: ORG,
        role: 'member',
        status: 'pending',
        name: 'Newbie',
        email: 'n@t.co',
        password: 'secret',
      })
    )
    await assertFails(
      setDoc(doc(newbie, 'users', 'newbie2'), {
        orgId: ORG,
        role: 'member',
        status: 'pending',
        name: huge,
        email: 'n@t.co',
      })
    )
  })

  it('refuses an extra key on the organization created at registration', async () => {
    const founder = testEnv.authenticatedContext('founder').firestore()
    await assertFails(
      setDoc(doc(founder, 'organizations', 'orgNew'), {
        name: 'New Org',
        createdBy: 'founder',
        serviceRoleKey: huge,
      })
    )
    await assertSucceeds(
      setDoc(doc(founder, 'organizations', 'orgNew'), {
        name: 'New Org',
        createdBy: 'founder',
      })
    )
  })

  it('refuses a member renaming themselves with a megabyte', async () => {
    await assertFails(updateDoc(doc(alice(), 'users', 'alice'), { name: huge }))
  })
})
