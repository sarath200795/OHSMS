import { describe, it, expect } from 'vitest'
import { newAssignments, ACTION_SOURCES } from './actionSources.js'

const drill = (capa) => ({ scenario: 'Fire evacuation', centerName: 'Hosur', capa })

describe('ACTION_SOURCES', () => {
  it('knows which field each collection keeps its actions in', () => {
    expect(ACTION_SOURCES.incidents.field).toBe('capa')
    expect(ACTION_SOURCES.illnesses.field).toBe('actions')
    expect(ACTION_SOURCES.auditFindings.field).toBe('findings')
  })
})

describe('newAssignments', () => {
  it('reports every assignee on a newly added row', () => {
    const after = drill([{ id: 'a1', description: 'Clear the exit', assignees: [{ uid: 'u1', name: 'Ravi' }, { uid: 'u2', name: 'Priya' }] }])
    const out = newAssignments('mockDrills', null, after)
    expect(out).toHaveLength(1)
    expect(out[0].refs.map((r) => r.uid)).toEqual(['u1', 'u2'])
    expect(out[0].action.title).toBe('Clear the exit')
    expect(out[0].action.site).toBe('Hosur')
    expect(out[0].action.source).toBe('Mock drill')
  })

  it('reports only the assignee that was added to an existing row', () => {
    const before = drill([{ id: 'a1', assignees: [{ uid: 'u1' }] }])
    const after = drill([{ id: 'a1', assignees: [{ uid: 'u1' }, { uid: 'u2' }] }])
    const out = newAssignments('mockDrills', before, after)
    expect(out[0].refs.map((r) => r.uid)).toEqual(['u2'])
  })

  // Otherwise every edit to a drill re-mails everyone attached to it.
  it('stays silent when an unrelated field changes', () => {
    const before = drill([{ id: 'a1', dueDate: '2026-08-10', assignees: [{ uid: 'u1' }] }])
    const after = drill([{ id: 'a1', dueDate: '2026-08-20', status: 'in_progress', assignees: [{ uid: 'u1' }] }])
    expect(newAssignments('mockDrills', before, after)).toEqual([])
  })

  it('stays silent for rows nobody is assigned to', () => {
    expect(newAssignments('mockDrills', null, drill([{ id: 'a1', description: 'orphan' }]))).toEqual([])
  })

  it('does not mail out work that is already closed', () => {
    const after = drill([{ id: 'a1', status: 'closed', assignees: [{ uid: 'u1' }] }])
    expect(newAssignments('mockDrills', null, after)).toEqual([])
  })

  it('falls back to the legacy free-text owner', () => {
    const after = { refNo: 'INC-14', capa: [{ id: 'c1', description: 'Fix guard', owner: 'Ravi Kumar' }] }
    const out = newAssignments('incidents', null, after)
    expect(out[0].refs).toEqual([{ name: 'Ravi Kumar' }])
    expect(out[0].action.context).toBe('INC-14')
  })

  it('prefers structured assignees over a stale owner string', () => {
    const after = drill([{ id: 'a1', owner: 'Someone Else', assignees: [{ uid: 'u1', name: 'Ravi' }] }])
    expect(newAssignments('mockDrills', null, after)[0].refs).toEqual([{ uid: 'u1', name: 'Ravi' }])
  })

  it('treats a row with no id by its position', () => {
    const before = { capa: [{ description: 'first', owner: 'A' }] }
    const after = { capa: [{ description: 'first', owner: 'A' }, { description: 'second', owner: 'B' }] }
    const out = newAssignments('incidents', before, after)
    expect(out).toHaveLength(1)
    expect(out[0].action.title).toBe('second')
  })

  it('ignores collections that keep no corrective actions', () => {
    expect(newAssignments('permits', null, { capa: [{ id: 'x', owner: 'A' }] })).toEqual([])
  })

  it('survives a deleted document and malformed arrays', () => {
    expect(newAssignments('incidents', { capa: [] }, null)).toEqual([])
    expect(newAssignments('incidents', null, { capa: 'not an array' })).toEqual([])
    expect(newAssignments('incidents', null, { capa: [null, undefined] })).toEqual([])
  })
})

// The shape InternalAudit.jsx actually writes. A finding has no owner, no
// description and no dueDate — nothing the CAPA-row reading looks for — and the
// person responsible for it is on the audit rather than on the row.
const audit = (over = {}) => ({
  docId: 'ACME-S1-IAF-14023',
  status: 'Reported',
  auditor: 'Meera Nair',
  taskDetails: { auditee: 'Ravi Kumar', dept: 'Maintenance', criteria: 'ISO 45001' },
  findings: [
    {
      id: 'AF-10001',
      type: 'Minor NC',
      desc: 'Extinguisher blocked by pallets',
      clause: '8.1',
      evidence: 'data:image/png;base64,AAA',
      fileName: 'bay.png',
      auditeeDueDate: '2026-08-26',
    },
  ],
  ...over,
})

describe('audit findings', () => {
  it('addresses a finding to the auditee named on the audit, not on the row', () => {
    const out = newAssignments('auditFindings', null, audit())
    expect(out).toHaveLength(1)
    expect(out[0].refs).toEqual([{ name: 'Ravi Kumar' }])
    expect(out[0].action.title).toBe('Minor NC: Extinguisher blocked by pallets (clause 8.1)')
    expect(out[0].action.dueDate).toBe('2026-08-26')
    expect(out[0].action.context).toBe('ACME-S1-IAF-14023 · Maintenance')
    expect(out[0].action.source).toBe('Audit finding')
  })

  it('falls back to the auditor when the audit names no auditee', () => {
    const out = newAssignments('auditFindings', null, audit({ taskDetails: { dept: 'Maintenance' } }))
    expect(out[0].refs).toEqual([{ name: 'Meera Nair' }])
  })

  it('hands the finding to the CAPA owner once the auditee has answered it', () => {
    const before = audit()
    const after = audit({
      findings: [{ ...before.findings[0], response: { owner: 'Priya Sharma', capa: 'Re-mark the bay', status: 'Completed' } }],
    })
    expect(newAssignments('auditFindings', before, after)[0].refs).toEqual([{ name: 'Priya Sharma' }])
  })

  it('stays silent when the audit is written for some other reason', () => {
    expect(newAssignments('auditFindings', audit(), audit({ submissionDate: '2026-08-14' }))).toEqual([])
  })

  // A finding carries no status of its own until the action tracker gives it
  // one, so a verified-and-closed audit would otherwise keep mailing forever.
  it('stops mailing findings once the audit itself is closed', () => {
    expect(newAssignments('auditFindings', null, audit({ status: 'Closed' }))).toEqual([])
  })

  it('says nothing about an audit that names nobody at all', () => {
    expect(newAssignments('auditFindings', null, audit({ taskDetails: {}, auditor: '' }))).toEqual([])
  })
})

// Drill CAPA and consultation rows carry no id of their own, so before this the
// array index WAS the identity — and an index is a position, not an identity.
describe('rows that carry no id of their own', () => {
  const rows = [
    { description: 'Clear the exit', owner: 'Ravi' },
    { description: 'Test the alarm', owner: 'Priya' },
    { description: 'Refill the hoses', owner: 'Anil' },
  ]

  it('does not re-mail the rows below one that was deleted', () => {
    const before = drill(rows)
    const after = drill([rows[0], rows[2]])
    // Under index identity, 'Refill the hoses' moved from slot 2 to slot 1 and
    // read as a brand new assignment, so Anil was told again about work he was
    // given weeks ago. Closing one action re-notified the rest of the list.
    expect(newAssignments('mockDrills', before, after)).toEqual([])
  })

  it('does not re-mail anyone when a row is inserted above them', () => {
    const before = drill(rows)
    const after = drill([{ description: 'Prop the fire door', owner: 'Meena' }, ...rows])
    const out = newAssignments('mockDrills', before, after)
    expect(out).toHaveLength(1)
    expect(out[0].refs[0].name).toBe('Meena')
  })

  it('still reports a genuinely new row', () => {
    const out = newAssignments('mockDrills', drill(rows), drill([...rows, { description: 'Log the drill', owner: 'Sita' }]))
    expect(out).toHaveLength(1)
    expect(out[0].refs[0].name).toBe('Sita')
  })

  // The cost of content identity, stated so it is a decision and not a surprise:
  // rewording an action reads as a new row. One mail to one person, against a
  // cascade to everyone below a deletion.
  it('treats a reworded action as a new one', () => {
    const after = drill([{ description: 'Clear the exit route', owner: 'Ravi' }, rows[1], rows[2]])
    const out = newAssignments('mockDrills', drill(rows), after)
    expect(out).toHaveLength(1)
    expect(out[0].refs[0].name).toBe('Ravi')
  })

  // Status is deliberately not part of the identity.
  it('says nothing when a row only changes status', () => {
    const after = drill([{ ...rows[0], actionStatus: 'in-progress' }, rows[1], rows[2]])
    expect(newAssignments('mockDrills', drill(rows), after)).toEqual([])
  })
})
