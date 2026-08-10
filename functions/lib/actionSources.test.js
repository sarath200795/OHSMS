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
