// A department action can be closed by someone in that department, and by an
// admin or manager. Another department cannot. The profile field is
// `department`; `dept` counts only when `department` was never set.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteField } from 'firebase/firestore'

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
    const user = (uid, data) =>
      setDoc(doc(db, 'users', uid), {
        orgId: ORG,
        status: 'approved',
        name: uid,
        email: `${uid}@t.co`,
        ...data,
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
  const closed = [{ ...openDept('Housekeeping'), status: 'Closed' }]

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
    await assertFails(
      updateDoc(meeting('safety', 'm-1'), {
        actions: [{ ...openDept('Safety'), status: 'Closed' }],
      })
    )
  })

  it('lets a member record a new meeting that closes their own department', async () => {
    await assertSucceeds(
      setDoc(meeting('house', 'm-new'), {
        subject: 'Toolbox',
        actions: [{ ...openDept('Housekeeping'), status: 'Closed' }],
      })
    )
  })

  it('refuses a member recording a new meeting that closes another department', async () => {
    await assertFails(
      setDoc(meeting('safety', 'm-new'), {
        subject: 'Toolbox',
        actions: [{ ...openDept('Housekeeping'), status: 'Closed' }],
      })
    )
  })
})

// department and dept decide who may close a department action. A member used
// to be able to write either key on their own profile, and a joiner could
// write them at signup — approval only sets status, so the value they chose
// became the grant. These are the writes that must not.
describe('department is assigned by an admin, not by the profile owner', () => {
  const profile = (uid, id = uid) => doc(as(uid), 'users', id)
  const closed = [{ ...openDept('Housekeeping'), status: 'Closed' }]

  it('refuses a member changing, adding, clearing, or swapping either alias', async () => {
    await assertFails(updateDoc(profile('safety'), { department: 'Housekeeping' }))
    await assertFails(updateDoc(profile('safety'), { dept: 'Housekeeping' }))
    await assertFails(updateDoc(profile('safety'), { department: null }))
    await assertFails(updateDoc(profile('safety'), { department: deleteField() }))
    await assertFails(
      setDoc(profile('safety'), {
        orgId: ORG,
        role: 'member',
        status: 'approved',
        name: 'safety',
        email: 'safety@t.co',
      })
    )
    await assertFails(updateDoc(profile('both'), { department: 'Housekeeping', dept: 'Safety' }))
    await assertFails(updateDoc(profile('legacy'), { department: 'Housekeeping' }))
    await assertFails(updateDoc(profile('legacy'), { dept: 'Safety' }))
  })

  it('still lets that member edit a field that is not the grant', async () => {
    await assertSucceeds(updateDoc(profile('safety'), { name: 'Safety Renamed' }))
    await assertSucceeds(
      updateDoc(profile('safety'), {
        accessRequest: { sites: ['site-2'], regions: [], entities: [], department: 'Housekeeping' },
      })
    )
    await assertFails(updateDoc(meeting('safety', 'm-1'), { actions: closed }))
  })

  it('refuses an auditor, a suspended member, and a manager the same write', async () => {
    await assertFails(updateDoc(profile('aud'), { department: 'Safety' }))
    await assertFails(updateDoc(profile('mgr'), { department: 'Housekeeping' }))
    await assertFails(updateDoc(profile('mgr', 'house'), { department: 'Safety' }))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'paused'), {
        orgId: ORG,
        role: 'member',
        status: 'suspended',
        name: 'paused',
        email: 'paused@t.co',
        department: 'Safety',
      })
    })
    await assertFails(updateDoc(profile('paused'), { department: 'Housekeeping' }))
    await assertFails(updateDoc(meeting('paused', 'm-1'), { actions: closed }))
    await assertFails(updateDoc(meeting('aud', 'm-1'), { actions: closed }))
  })

  it('lets an admin of this org reassign, clear, and provision a department', async () => {
    await assertSucceeds(updateDoc(profile('adm', 'house'), { department: 'Projects' }))
    await assertSucceeds(updateDoc(profile('adm', 'house'), { department: '', dept: '' }))
    await assertSucceeds(updateDoc(profile('adm', 'house'), { department: 'Housekeeping' }))
    await assertFails(
      setDoc(profile('adm', 'hired-open'), {
        orgId: ORG,
        role: 'member',
        status: 'approved',
        name: 'hired',
        email: 'hired@t.co',
        department: 'Housekeeping',
        dept: '',
        access: { sites: [], regions: [], entities: [] },
      })
    )
    await assertSucceeds(
      setDoc(profile('adm', 'hired'), {
        orgId: ORG,
        role: 'member',
        status: 'approved',
        name: 'hired',
        email: 'hired@t.co',
        department: 'Housekeeping',
        dept: '',
        mustChangePassword: true,
        access: { sites: [], regions: [], entities: [] },
      })
    )
    // The department is assigned, and the account is still on the temporary
    // password. passwordIsOwn refuses the close until that flag is cleared,
    // which completePasswordChange does and a client update cannot.
    await assertFails(updateDoc(meeting('hired', 'm-1'), { actions: closed }))
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users', 'hired'), { mustChangePassword: false })
    })
    await assertSucceeds(updateDoc(meeting('hired', 'm-1'), { actions: closed }))
  })

  it('refuses an admin of another org', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'organizations', 'orgTwo'), { name: 'Two', createdBy: 'outsider' })
      await setDoc(doc(db, 'users', 'outsider'), {
        orgId: 'orgTwo',
        role: 'admin',
        status: 'approved',
        name: 'outsider',
        email: 'outsider@t.co',
      })
    })
    const outsider = as('outsider')
    await assertFails(updateDoc(doc(outsider, 'users', 'house'), { department: 'Housekeeping' }))
    await assertFails(
      updateDoc(doc(outsider, 'users', 'outsider'), { orgId: ORG, department: 'Housekeeping' })
    )
  })

  it('does not turn a self-declared department into a close after approval', async () => {
    const join = {
      orgId: ORG,
      role: 'member',
      status: 'pending',
      name: 'Joiner',
      email: 'joiner@t.co',
      department: '',
      dept: '',
      departmentRequest: 'Housekeeping',
    }
    await assertFails(setDoc(profile('joiner'), { ...join, department: 'Housekeeping' }))
    await assertFails(setDoc(profile('joiner'), { ...join, dept: 'Housekeeping' }))
    await assertSucceeds(setDoc(profile('joiner'), join))
    await assertFails(updateDoc(profile('joiner'), { department: 'Housekeeping' }))
    await assertSucceeds(updateDoc(profile('adm', 'joiner'), { status: 'approved' }))
    await assertFails(updateDoc(meeting('joiner', 'm-1'), { actions: closed }))
    await assertSucceeds(updateDoc(profile('adm', 'joiner'), { department: 'Housekeeping' }))
    await assertSucceeds(updateDoc(meeting('joiner', 'm-1'), { actions: closed }))
  })
})
