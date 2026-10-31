// A department action can be closed by someone in that department, and by an
// admin or manager. Another department cannot. The profile field is
// `department`; `dept` counts only when `department` was never set.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORG = 'orgOne'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-demo',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => { await testEnv?.cleanup() })

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const meeting = (uid, id) => doc(as(uid), 'organizations', ORG, 'consultations', id)

const openDept = (department) => ({
  action: 'Mop the yard',
  ownerKind: 'department',
  department,
  owner: '',
  status: 'Open',
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    const user = (uid, data) => setDoc(doc(db, 'users', uid), {
      orgId: ORG, status: 'approved', name: uid, email: `${uid}@t.co`, ...data,
    })
    await user('adm', { role: 'admin', department: 'Safety' })
    await user('mgr', { role: 'manager', department: 'Safety' })
    await user('house', { role: 'member', department: 'Housekeeping' })
    await user('safety', { role: 'member', department: 'Safety' })
    await user('legacy', { role: 'member', dept: 'Housekeeping' })
    await user('both', { role: 'member', department: 'Safety', dept: 'Housekeeping' })
    await user('aud', { role: 'auditor', department: 'Housekeeping' })
    await setDoc(doc(db, 'organizations', ORG, 'consultations', 'm-1'), {
      subject: 'Quarterly',
      actions: [openDept('Housekeeping')],
    })
  })
})

describe('closing a department action', () => {
  const closed = [({ ...openDept('Housekeeping'), status: 'Closed' })]

  it('allows a member of that department', async () => {
    await assertSucceeds(updateDoc(meeting('house', 'm-1'), { actions: closed }))
  })

  it('allows an admin and a manager from another department', async () => {
    await assertSucceeds(updateDoc(meeting('adm', 'm-1'), { actions: closed }))
    await assertSucceeds(updateDoc(meeting('mgr', 'm-1'), { actions: closed }))
  })

  it('refuses a member of a different department', async () => {
    await assertFails(updateDoc(meeting('safety', 'm-1'), { actions: closed }))
  })

  it('uses dept only when department is blank', async () => {
    await assertSucceeds(updateDoc(meeting('legacy', 'm-1'), { actions: closed }))
  })

  it('ignores dept when department is set to somewhere else', async () => {
    await assertFails(updateDoc(meeting('both', 'm-1'), { actions: closed }))
  })

  it('refuses an auditor even when the department matches', async () => {
    await assertFails(updateDoc(meeting('aud', 'm-1'), { actions: closed }))
  })

  it('still lets another department edit the meeting without closing the action', async () => {
    await assertSucceeds(updateDoc(meeting('safety', 'm-1'), { subject: 'Quarterly, revised' }))
  })

  it('refuses retargeting the action onto your own department and closing it', async () => {
    await assertFails(updateDoc(meeting('safety', 'm-1'), {
      actions: [{ ...openDept('Safety'), status: 'Closed' }],
    }))
  })

  it('lets a member record a new meeting that closes their own department', async () => {
    await assertSucceeds(setDoc(meeting('house', 'm-new'), {
      subject: 'Toolbox',
      actions: [{ ...openDept('Housekeeping'), status: 'Closed' }],
    }))
  })

  it('refuses a member recording a new meeting that closes another department', async () => {
    await assertFails(setDoc(meeting('safety', 'm-new'), {
      subject: 'Toolbox',
      actions: [{ ...openDept('Housekeeping'), status: 'Closed' }],
    }))
  })
})
