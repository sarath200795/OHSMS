// Extinguisher transitions the screens refuse, enforced in the rules.
//
// A member with the console can update an extinguisher directly. These send
// the writes the UI now blocks, and the writes it still has to allow: receiving
// a unit back while its hydrostatic date is overdue, closing a refill, editing
// a unit whose date is already past, and recording a refilled-and-closed with
// future dates and a certificate.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORG = 'orgOne'
let testEnv

// The rules add 5h30m to request.time. The emulator's clock is this machine's.
function istToday() {
  const d = new Date(Date.now() + 330 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

const FUTURE_REFILL = '2031-06-01'
const FUTURE_HPT = '2032-06-01'
const cert = {
  result: 'pass',
  nextDueOn: FUTURE_HPT,
  fileName: 'hpt.pdf',
  testedOn: '2026-10-01',
  vendor: 'Acme Test',
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ohsms-ext-workflow',
    firestore: { rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
  })
})
afterAll(async () => {
  await testEnv?.cleanup()
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const rec = (uid, id) => doc(as(uid), 'organizations', ORG, 'extinguishers', id)

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'organizations', ORG), { name: 'One', createdBy: 'adm' })
    await setDoc(doc(db, 'users', 'mem'), {
      orgId: ORG,
      role: 'member',
      status: 'approved',
      name: 'mem',
      email: 'mem@t.co',
    })
    const org = (id, data) => setDoc(doc(db, 'organizations', ORG, 'extinguishers', id), data)
    await org('overdue', {
      extId: 'EXT-OVER',
      status: 'active',
      dateOfNextHPT: '2020-01-01',
      dateOfNextRefill: '2020-01-01',
      physicalDefects: ['pin', 'empty'],
    })
    await org('ahead', {
      extId: 'EXT-AHEAD',
      status: 'active',
      dateOfNextHPT: FUTURE_HPT,
      dateOfNextRefill: FUTURE_REFILL,
      physicalDefects: ['pin'],
    })
    await org('nodate', {
      extId: 'EXT-NONE',
      status: 'active',
      physicalDefects: ['pin'],
    })
    await org('with-vendor', {
      extId: 'EXT-VEND',
      status: 'in_process_refilling',
      dateOfNextHPT: '2020-01-01',
      dateOfNextRefill: '2020-01-01',
      physicalDefects: ['pin', 'empty'],
    })
  })
})

describe('a direct write cannot skip an overdue hydrostatic test', () => {
  it('refuses clearing a physical defect while the test is overdue', async () => {
    await assertFails(updateDoc(rec('mem', 'overdue'), { physicalDefects: ['empty'] }))
  })

  it('refuses sending the unit to the vendor while the test is overdue', async () => {
    await assertFails(updateDoc(rec('mem', 'overdue'), { status: 'in_process_refilling' }))
  })

  it('refuses a send that also moves the due date, because the old date is what matters', async () => {
    await assertFails(
      updateDoc(rec('mem', 'overdue'), {
        status: 'in_process_refilling',
        dateOfNextHPT: FUTURE_HPT,
      })
    )
  })

  it('still lets a unit with no hydrostatic date be sent out and resolved', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'nodate'), { status: 'in_process_refilling' }))
    await assertSucceeds(updateDoc(rec('mem', 'nodate'), { physicalDefects: [] }))
  })

  it('still lets a member resolve and send a unit whose test is ahead', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'ahead'), { physicalDefects: [] }))
    await assertSucceeds(updateDoc(rec('mem', 'ahead'), { status: 'in_process_refilling' }))
  })

  it('still lets a member edit an overdue unit without clearing the defect', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'overdue'), { location: 'Bay 4' }))
  })
})

describe('refilled & closed dates, and receiving a unit back', () => {
  const closed = (extra) =>
    updateDoc(rec('mem', 'with-vendor'), {
      status: 'active',
      dateOfNextRefill: FUTURE_REFILL,
      dateOfNextHPT: FUTURE_HPT,
      lastRefilledAt: istToday(),
      physicalDefects: [],
      ...extra,
    })

  it('refuses a close whose new dates are not after today', async () => {
    const today = istToday()
    await assertFails(
      updateDoc(rec('mem', 'with-vendor'), {
        status: 'active',
        dateOfNextRefill: today,
        dateOfNextHPT: today,
        lastRefilledAt: today,
        physicalDefects: [],
        hpt: { ...cert, nextDueOn: today },
      })
    )
  })

  it('refuses a close that moves the hydrostatic date without a certificate', async () => {
    await assertFails(closed())
  })

  it('accepts a close that moves both dates and carries the certificate', async () => {
    await assertSucceeds(closed({ hpt: cert }))
  })

  it('still accepts receiving the unit back while the test stays overdue', async () => {
    await assertSucceeds(
      updateDoc(rec('mem', 'with-vendor'), {
        status: 'active',
        receivedAt: '2026-10-15',
        lastRefilledAt: '2026-10-15',
        dateOfNextRefill: FUTURE_REFILL,
        physicalDefects: ['pin'],
      })
    )
  })

  it('refuses a receive that also clears the physical defect while the test is overdue', async () => {
    await assertFails(
      updateDoc(rec('mem', 'with-vendor'), {
        status: 'active',
        receivedAt: '2026-10-15',
        lastRefilledAt: '2026-10-15',
        dateOfNextRefill: FUTURE_REFILL,
        physicalDefects: [],
      })
    )
  })

  it('still lets a member close off a refill without touching the dates', async () => {
    await assertSucceeds(updateDoc(rec('mem', 'with-vendor'), { status: 'closed' }))
  })
})
