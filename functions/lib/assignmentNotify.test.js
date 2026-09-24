import { describe, it, expect } from 'vitest'
import {
  readableText,
  planAssignmentMails,
  deliveryDecision,
  renderAssignmentMail,
  writtenData,
  deliverAssignments,
  MAX_MAILS_PER_WRITE,
} from './assignmentNotify.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const member = (over = {}) => ({
  orgId: 'orgA',
  status: 'approved',
  name: 'Ravi Kumar',
  email: 'ravi@example.com',
  ...over,
})

function dbWith(users = {}) {
  const docs = new Map(Object.entries(users))
  const reads = []
  return {
    docs,
    reads,
    doc(path) {
      return {
        path,
        async get() {
          reads.push(path)
          const data = docs.get(path)
          return { exists: data !== undefined, data: () => data }
        },
        async create(data) {
          if (docs.has(path)) {
            const err = new Error('already exists')
            err.code = 6
            throw err
          }
          docs.set(path, { ...data })
        },
        async update(patch) {
          docs.set(path, { ...docs.get(path), ...patch })
        },
      }
    },
  }
}

function mailer() {
  const sent = []
  return {
    sent,
    config: {
      host: 'smtp.example',
      from: 'safety@example.com',
      pass: 'secret',
      appOrigin: 'https://app.example',
      configured: true,
    },
    async send(msg) {
      sent.push(msg)
    },
  }
}

const log = () => {
  const entries = []
  return {
    entries,
    info: (msg, extra) => entries.push({ level: 'info', msg, extra }),
    error: (msg, extra) => entries.push({ level: 'error', msg, extra }),
  }
}

describe('readableText', () => {
  it('drops an envelope so ciphertext never becomes a subject line', () => {
    expect(readableText(SEALED)).toBe('')
    expect(readableText('enk:1:medical:wrapped:iviviviviviviviv:ciphertextciphertext')).toBe('')
  })

  it('keeps ordinary text', () => {
    expect(readableText('  Fix the guard  ')).toBe('Fix the guard')
    expect(readableText(null)).toBe('')
  })
})

describe('planAssignmentMails', () => {
  const capa = (over = {}) => ({
    id: 'a1',
    description: 'Fix the guard',
    ownerUid: 'u1',
    dueDate: '2026-10-01',
    status: 'open',
    ...over,
  })

  it('mails a new incident owner and not a resave of the same owner', () => {
    const after = { refNo: 'IRA-2026-0001', capa: [capa()] }
    expect(
      planAssignmentMails({ collection: 'incidents', before: null, after, docId: 'i1' })
    ).toMatchObject([
      {
        slotId: 'a1',
        assigneeUid: 'u1',
        title: 'Fix the guard',
        due: '2026-10-01',
        path: '/incidents/i1',
      },
    ])
    expect(
      planAssignmentMails({ collection: 'incidents', before: after, after, docId: 'i1' })
    ).toEqual([])
  })

  it('mails when the owner changes, including back to someone who held it before', () => {
    const before = { capa: [capa({ ownerUid: 'u1' })] }
    const after = { capa: [capa({ ownerUid: 'u2', assignedByUid: 'u9' })] }
    expect(
      planAssignmentMails({ collection: 'incidents', before, after, docId: 'i1' })
    ).toMatchObject([{ assigneeUid: 'u2', actorUid: 'u9' }])
  })

  it('does not mail a closed action, or an incident that was soft-deleted in the same write', () => {
    expect(
      planAssignmentMails({
        collection: 'incidents',
        before: null,
        docId: 'i1',
        after: { capa: [capa({ status: 'closed' })] },
      })
    ).toEqual([])
    expect(
      planAssignmentMails({
        collection: 'incidents',
        before: null,
        docId: 'i1',
        after: { deletedAt: { seconds: 1 }, capa: [capa()] },
      })
    ).toEqual([])
  })

  it('ignores a sealed description and still names the record', () => {
    const [plan] = planAssignmentMails({
      collection: 'incidents',
      before: null,
      docId: 'i1',
      after: { refNo: 'IRA-1', capa: [capa({ description: SEALED })] },
    })
    expect(plan.title).toBe('')
    expect(plan.context).toBe('IRA-1')
  })

  it('never copies illness action text, even when encryption is off', () => {
    const [plan] = planAssignmentMails({
      collection: 'illnesses',
      before: null,
      docId: 'ill1',
      after: {
        refNo: 'ILL-2026-0003',
        actions: [
          {
            id: 'a1',
            description: 'Review the asthma case',
            ownerUid: 'u1',
            dueDate: '2026-11-01',
            status: 'open',
          },
        ],
      },
    })
    expect(plan.title).toBe('')
    expect(plan.includeTitle).toBe(false)
    expect(plan.context).toBe('ILL-2026-0003')
    expect(plan.path).toBe('/incidents/illness/ill1')
    expect(JSON.stringify(plan)).not.toContain('asthma')
  })

  it('mails each new drill assignee and not the one already on the row', () => {
    const row = (assignees, status = 'Open') => ({
      action: 'Check the assembly point',
      assignees,
      status,
      due: '2026-10-02',
    })
    const before = { scenario: 'Fire Emergency', capa: [row([{ uid: 'u1' }])] }
    const after = {
      scenario: 'Fire Emergency',
      capa: [row([{ uid: 'u1' }, { uid: 'u2', name: 'Priya' }])],
    }
    const plans = planAssignmentMails({ collection: 'mockDrills', before, after, docId: 'd1' })
    expect(plans.map((p) => p.assigneeUid)).toEqual(['u2'])
    expect(plans[0].path).toBe('/mock-drills')
    expect(plans[0].context).toBe('Fire Emergency')
  })

  it('mails a new training assignment and not a due-date edit or a completion', () => {
    const assigned = {
      employeeUid: 'u1',
      assignedBy: 'u9',
      courseName: 'Working at Height',
      dueDate: '2026-06-15',
      status: 'assigned',
    }
    expect(
      planAssignmentMails({
        collection: 'trainingAssignments',
        before: null,
        after: assigned,
        docId: 'as1',
      })
    ).toMatchObject([
      { assigneeUid: 'u1', actorUid: 'u9', title: 'Working at Height', path: '/training/my' },
    ])
    expect(
      planAssignmentMails({
        collection: 'trainingAssignments',
        before: assigned,
        after: { ...assigned, dueDate: '2026-07-01' },
        docId: 'as1',
      })
    ).toEqual([])
    expect(
      planAssignmentMails({
        collection: 'trainingAssignments',
        before: assigned,
        after: { ...assigned, status: 'completed' },
        docId: 'as1',
      })
    ).toEqual([])
  })

  it('mails again when a completed course is reassigned', () => {
    const plans = planAssignmentMails({
      collection: 'trainingAssignments',
      before: { employeeUid: 'u1', status: 'completed', courseName: 'Working at Height' },
      after: { employeeUid: 'u1', status: 'assigned', courseName: 'Working at Height' },
      docId: 'as1',
    })
    expect(plans).toHaveLength(1)
  })

  it('ignores hostile shapes instead of throwing', () => {
    expect(
      planAssignmentMails({
        collection: 'incidents',
        before: null,
        after: { capa: 'nonsense' },
        docId: 'i1',
      })
    ).toEqual([])
    expect(
      planAssignmentMails({
        collection: 'incidents',
        before: null,
        docId: 'i1',
        after: { capa: [null, 'x', { ownerUid: { bad: true } }, { id: 'a1' }] },
      })
    ).toEqual([])
    expect(
      planAssignmentMails({ collection: 'nope', before: null, after: {}, docId: 'i1' })
    ).toEqual([])
    expect(
      planAssignmentMails({
        collection: 'mockDrills',
        before: null,
        after: { capa: [{ assignees: 'nope' }] },
        docId: 'd1',
      })
    ).toEqual([])
  })

  it('refuses a document id that would change the link', () => {
    const [plan] = planAssignmentMails({
      collection: 'incidents',
      before: null,
      docId: 'a/b',
      after: { capa: [{ id: 'a1', ownerUid: 'u1', status: 'open' }] },
    })
    expect(plan.path).toBe('/incidents')
  })
})

describe('deliveryDecision', () => {
  it('sends to an approved member of the same org', () => {
    expect(
      deliveryDecision({ assigneeUid: 'u1', actorUid: 'u9', user: member(), orgId: 'orgA' })
    ).toEqual({
      send: true,
      email: 'ravi@example.com',
    })
  })

  it('skips self-assignment', () => {
    expect(
      deliveryDecision({ assigneeUid: 'u1', actorUid: 'u1', user: member(), orgId: 'orgA' }).reason
    ).toBe('self')
  })

  it('skips another tenant, a missing email, and someone who cannot sign in', () => {
    expect(
      deliveryDecision({ assigneeUid: 'u1', user: member({ orgId: 'orgB' }), orgId: 'orgA' }).reason
    ).toBe('cross-tenant')
    expect(
      deliveryDecision({ assigneeUid: 'u1', user: member({ email: '' }), orgId: 'orgA' }).reason
    ).toBe('no-email')
    expect(
      deliveryDecision({
        assigneeUid: 'u1',
        user: member({ email: 'not-an-email' }),
        orgId: 'orgA',
      }).reason
    ).toBe('no-email')
    expect(
      deliveryDecision({ assigneeUid: 'u1', user: member({ status: 'pending' }), orgId: 'orgA' })
        .reason
    ).toBe('not-approved')
    expect(deliveryDecision({ assigneeUid: 'u1', user: null, orgId: 'orgA' }).reason).toBe(
      'no-user'
    )
  })

  it('refuses a uid that is a path', () => {
    expect(
      deliveryDecision({ assigneeUid: 'u1/secret', user: member(), orgId: 'orgA' }).reason
    ).toBe('bad-uid')
  })

  it('still sends when the profile predates the status field', () => {
    const user = member()
    delete user.status
    expect(deliveryDecision({ assigneeUid: 'u1', user, orgId: 'orgA' }).send).toBe(true)
  })
})

describe('renderAssignmentMail', () => {
  it('names the action, the assigner, the due date and an absolute link', () => {
    const message = renderAssignmentMail(
      {
        kind: 'assignment.incident_capa',
        includeTitle: true,
        title: 'Fix the guard',
        what: 'corrective action',
        context: 'IRA-2026-0001',
        due: '2026-10-01',
        path: '/incidents/i1',
      },
      { assignerName: 'Priya Menon', appOrigin: 'https://app.example/' }
    )
    expect(message.subject).toBe('Incident CAPA: Fix the guard (IRA-2026-0001)')
    expect(message.text).toContain('What: Fix the guard')
    expect(message.text).toContain('Record: IRA-2026-0001')
    expect(message.text).toContain('Assigned by: Priya Menon')
    expect(message.text).toContain('Due: 2026-10-01')
    expect(message.text).toContain('Open it: https://app.example/incidents/i1')
    expect(message.html).toContain('href="https://app.example/incidents/i1"')
    expect(message.html).toContain('Open the incident')
  })

  it('keeps a newline in the title out of the subject', () => {
    const message = renderAssignmentMail({
      kind: 'assignment.incident_capa',
      includeTitle: true,
      title: 'Fix it\nBcc: evil@example.com',
      what: 'corrective action',
      context: '',
      due: '',
      path: '/incidents/i1',
    })
    expect(message.subject).not.toMatch(/[\r\n]/)
    expect(message.text).not.toMatch(/[\r\n]Bcc:/)
    expect(message.text).toContain('Open it in the app: /incidents/i1')
  })

  it('does not invent a description for an illness', () => {
    const message = renderAssignmentMail({
      kind: 'assignment.illness_action',
      includeTitle: false,
      title: 'Review the asthma case',
      what: 'corrective action on an occupational illness record',
      context: 'ILL-1',
      due: '2026-11-01',
      path: '/incidents/illness/ill1',
    })
    expect(message.subject).not.toContain('asthma')
    expect(message.text).not.toContain('asthma')
    expect(message.html).not.toContain('asthma')
    expect(message.text).toContain('ILL-1')
  })
})

describe('writtenData', () => {
  it('reads an admin snapshot and a client snapshot, and treats a delete as nothing', () => {
    expect(writtenData({ exists: true, data: () => ({ capa: [] }) })).toEqual({ capa: [] })
    expect(writtenData({ exists: () => true, data: () => ({ n: 1 }) })).toEqual({ n: 1 })
    expect(writtenData({ exists: false, data: () => ({ capa: [] }) })).toBeNull()
    expect(
      writtenData({
        exists: () => false,
        data: () => {
          throw new Error('no')
        },
      })
    ).toBeNull()
    expect(writtenData(null)).toBeNull()
  })
})

describe('deliverAssignments', () => {
  const after = {
    refNo: 'IRA-1',
    capa: [
      {
        id: 'a1',
        description: 'Fix the guard',
        ownerUid: 'u1',
        dueDate: '2026-10-01',
        status: 'open',
        assignedByUid: 'u9',
      },
    ],
  }

  it('does not copy a sealed action description into the mail', async () => {
    const db = dbWith({ 'users/u1': member() })
    const box = mailer()
    await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      eventId: 'evt-1',
      mailer: box,
      logger: log(),
      after: {
        refNo: 'IRA-1',
        capa: [{ id: 'a1', description: SEALED, ownerUid: 'u1', status: 'open' }],
      },
    })
    expect(box.sent).toHaveLength(1)
    expect(box.sent[0].subject).not.toContain('enc:')
    expect(box.sent[0].text).not.toContain('enc:')
    expect(box.sent[0].html).not.toContain('enc:')
    expect(box.sent[0].text).toContain('IRA-1')
    expect(box.sent[0].html).toContain('IRA-1')
    expect(box.sent[0].text).toContain('Open it: https://app.example/incidents/i1')
  })

  it('sends to the assignee and claims the ledger before the second event can', async () => {
    const db = dbWith({
      'users/u1': member(),
      'users/u9': member({ name: 'Priya Menon', email: 'priya@example.com' }),
    })
    const box = mailer()
    const logger = log()
    const result = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      after,
      eventId: 'evt-1',
      mailer: box,
      logger,
    })
    expect(result).toMatchObject({ sent: 1, failed: 0 })
    expect(box.sent).toHaveLength(1)
    expect(box.sent[0].to).toBe('ravi@example.com')
    expect(box.sent[0].text).toContain('Assigned by: Priya Menon')
    expect(box.sent[0].html).toContain('Priya Menon')
    expect(box.sent[0].text).toContain('https://app.example/incidents/i1')
    expect(box.sent[0].html).toContain('https://app.example/incidents/i1')
    expect(box.sent[0].text).toContain('Sent by EHS notifications ·')
    expect(box.sent[0].senderName).toBe('EHS notifications')
    const ledger = [...db.docs.keys()].filter((k) => k.includes('/notifications/'))
    expect(ledger).toHaveLength(1)
    expect(db.docs.get(ledger[0]).status).toBe('sent')

    const again = mailer()
    const second = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      after,
      eventId: 'evt-1',
      mailer: again,
      logger,
    })
    expect(second.sent).toBe(0)
    expect(again.sent).toEqual([])
  })

  it('uses the organisation name as the sender when the org document has one', async () => {
    const db = dbWith({
      'users/u1': member(),
      'organizations/orgA': { name: 'Northwind Steel' },
    })
    const box = mailer()
    await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      after,
      eventId: 'evt-1',
      mailer: box,
      logger: log(),
    })
    expect(box.sent).toHaveLength(1)
    expect(box.sent[0].senderName).toBe('Northwind Steel')
    expect(box.sent[0].text).toContain('Sent by Northwind Steel ·')
    expect(box.sent[0].html).toContain('Northwind Steel')
    expect(`${box.sent[0].text}\n${box.sent[0].html}`).not.toContain('WEEHS')
    expect(db.reads).toContain('organizations/orgA')
  })

  it('does not email the assigner when they picked themselves, and does not read their profile to decide that', async () => {
    const db = dbWith({ 'users/u1': member() })
    const box = mailer()
    const self = {
      ...after,
      capa: [{ ...after.capa[0], assignedByUid: 'u1' }],
    }
    const result = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      after: self,
      eventId: 'evt-1',
      mailer: box,
      logger: log(),
    })
    expect(result.sent).toBe(0)
    expect(box.sent).toEqual([])
    expect(db.reads).toEqual([])
  })

  it('does not email a user from another org, or one with no address', async () => {
    const db = dbWith({
      'users/u1': member({ orgId: 'orgB' }),
      'users/u2': member({ email: '' }),
    })
    const box = mailer()
    const result = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      eventId: 'evt-1',
      mailer: box,
      logger: log(),
      after: {
        capa: [
          { id: 'a1', ownerUid: 'u1', status: 'open', description: 'One' },
          { id: 'a2', ownerUid: 'u2', status: 'open', description: 'Two' },
          { id: 'a3', ownerUid: 'missing', status: 'open', description: 'Three' },
        ],
      },
    })
    expect(result.sent).toBe(0)
    expect(box.sent).toEqual([])
    expect([...db.docs.keys()].some((k) => k.includes('/notifications/'))).toBe(false)
  })

  it('logs and skips when SMTP is not configured, without claiming the ledger', async () => {
    const db = dbWith({ 'users/u1': member() })
    const logger = log()
    const result = await deliverAssignments({
      db,
      collection: 'trainingAssignments',
      orgId: 'orgA',
      docId: 'as1',
      before: null,
      after: {
        employeeUid: 'u1',
        status: 'assigned',
        courseName: 'Working at Height',
        assignedBy: 'u9',
      },
      eventId: 'evt-1',
      mailer: {
        config: { host: '', from: '', pass: '' },
        async send() {
          throw new Error('should not send')
        },
      },
      logger,
    })
    expect(result.reason).toBe('not-configured')
    expect(result.sent).toBe(0)
    expect(
      logger.entries.some(
        (e) => e.level === 'error' && e.msg === 'assignment mail is not configured'
      )
    ).toBe(true)
    expect(logger.entries[0].extra.missing).toEqual(['SMTP_HOST', 'MAIL_FROM', 'SMTP_PASS'])
    expect([...db.docs.keys()].some((k) => k.includes('/notifications/'))).toBe(false)
    expect(db.reads).toEqual([])
  })

  it('records a failed send and still returns, so the assignment write is not retried as a failure', async () => {
    const db = dbWith({ 'users/u1': member() })
    const logger = log()
    const result = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      after,
      eventId: 'evt-1',
      logger,
      mailer: {
        config: mailer().config,
        async send() {
          throw new Error('smtp down')
        },
      },
    })
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    const row = [...db.docs.values()].find((d) => d && d.kind)
    expect(row.status).toBe('failed')
    expect(
      logger.entries.some((e) => e.level === 'error' && e.msg === 'assignment mail failed')
    ).toBe(true)
  })

  it('caps a write that names more people than a real assignment batch', async () => {
    const capa = Array.from({ length: MAX_MAILS_PER_WRITE + 5 }, (_, i) => ({
      id: `a${i}`,
      ownerUid: 'u1',
      status: 'open',
      description: 'Fix',
    }))
    // Same assignee on many slots: each slot is its own action, so each would
    // mail. The cap is what stops one document from becoming that many sends.
    const db = dbWith({ 'users/u1': member() })
    const box = mailer()
    const logger = log()
    const result = await deliverAssignments({
      db,
      collection: 'incidents',
      orgId: 'orgA',
      docId: 'i1',
      before: null,
      eventId: 'evt-1',
      mailer: box,
      logger,
      after: { capa },
    })
    expect(box.sent).toHaveLength(MAX_MAILS_PER_WRITE)
    expect(result.sent).toBe(MAX_MAILS_PER_WRITE)
    expect(logger.entries.some((e) => e.msg === 'assignment mail capped')).toBe(true)
  })
})
