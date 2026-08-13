import { describe, it, expect } from 'vitest'
import { incidentRows, actionRows, rootCauseOf, actionsSummary, fiveWhyFindings } from './exporter'

const incident = {
  id: 'i1',
  refNo: 'INC-2026-0007',
  incidentDate: '2026-03-14',
  incidentTime: '09:15',
  siteName: 'Plant 2',
  location: 'Bay C',
  type: 'near_miss',
  severity: 'low',
  lifecycle: 'capa',
  narrative: 'A pallet fell from the second rack while the forklift was reversing.',
  reportedByName: 'R. Osei',
  investigations: [
    { id: 'v1', method: '5why', summary: 'Rack beam not seated after last reconfiguration.' },
  ],
  capa: [
    { id: 'a1', description: 'Re-seat and inspect all beams in Bay C', ownerName: 'Sam', dueDate: '2026-03-20', status: 'closed' },
    { id: 'a2', description: 'Add beam check to the weekly racking inspection', ownerName: 'Priya', dueDate: '2026-04-01', status: 'open' },
  ],
}

describe('the incident sheet', () => {
  const row = () => incidentRows([incident])[0]

  it('carries the five things asked for, in words rather than keys', () => {
    const r = row()
    expect(r['Incident Type']).toBe('Near Miss')
    expect(r.Description).toContain('A pallet fell')
    expect(r['Root Cause']).toContain('Rack beam not seated')
    expect(r.Actions).toContain('Re-seat and inspect all beams')
    expect(r.Status).toBe('CAPA')
  })

  // A column reading `investigation_team` is a database artefact. Anyone
  // opening this file wants the label they see in the app.
  it('never leaks a raw key into a labelled column', () => {
    const r = row()
    expect(r['Incident Type']).not.toBe('near_miss')
    expect(r.Severity).not.toBe('low')
    expect(r.Status).not.toBe('capa')
  })

  it('counts the actions and how many are actually closed', () => {
    expect(row()).toMatchObject({ 'Actions Total': 2, 'Actions Closed': 1 })
  })

  it('names the incident so a row can be traced back', () => {
    expect(row().Reference).toBe('INC-2026-0007')
    expect(incidentRows([{ ...incident, refNo: '' }])[0].Reference).toBe('i1')
  })

  it('leaves an incident with nothing recorded blank rather than undefined', () => {
    const r = incidentRows([{ id: 'x' }])[0]
    expect(r.Description).toBe('')
    expect(r['Root Cause']).toBe('')
    expect(r.Actions).toBe('')
    expect(r['Actions Total']).toBe(0)
    expect(Object.values(r).every((v) => v !== undefined && v !== null)).toBe(true)
  })

  it('survives junk', () => {
    expect(incidentRows()).toEqual([])
    expect(incidentRows([null])).toEqual([])
    expect(() => incidentRows([{ capa: 'nonsense', investigations: 'nonsense' }])).not.toThrow()
  })
})

describe('root cause', () => {
  it('names the method that produced each finding', () => {
    expect(rootCauseOf(incident)).toBe('5-Why Analysis: Rack beam not seated after last reconfiguration.')
  })

  it('joins several investigations', () => {
    const multi = { investigations: [
      { method: '5why', summary: 'One.' },
      { method: 'fishbone', summary: 'Two.' },
    ] }
    expect(rootCauseOf(multi).split('\n')).toHaveLength(2)
  })

  it('skips an investigation that was started but never summarised', () => {
    expect(rootCauseOf({ investigations: [{ method: '5why', summary: '   ' }] })).toBe('')
  })

  // Older incidents stored a single `investigation` object. Their root cause is
  // still a root cause, and an export that dropped it would quietly under-report
  // exactly the historic records an audit asks for.
  it('reads the legacy single-investigation shape', () => {
    expect(rootCauseOf({ investigation: { method: '5why', summary: 'Legacy finding.' } }))
      .toContain('Legacy finding.')
  })
})

describe('the actions sheet', () => {
  it('gives every action its own row, carrying its incident', () => {
    const rows = actionRows([incident])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      Reference: 'INC-2026-0007',
      'Incident Type': 'Near Miss',
      Action: 'Re-seat and inspect all beams in Bay C',
      Owner: 'Sam',
      Due: '2026-03-20',
      'Action Status': 'Closed',
    })
  })

  // The reason there are two sheets: several actions flattened into one cell
  // cannot be filtered or pivoted, which is the whole point of taking this to
  // a meeting.
  it('is one row per action, not one per incident', () => {
    expect(actionRows([incident, incident])).toHaveLength(4)
  })

  it('is empty, not broken, for an incident with no actions', () => {
    expect(actionRows([{ id: 'x' }])).toEqual([])
    expect(actionRows()).toEqual([])
  })

  it('reads as a bulleted list on the incident sheet', () => {
    const s = actionsSummary(incident)
    expect(s.split('\n')).toHaveLength(2)
    expect(s).toContain('• Re-seat and inspect all beams in Bay C · Sam · due 2026-03-20 · Closed')
  })
})

// A 5-Why is a diagram, not prose. The finding is the last why — the node
// nothing else hangs off — and an investigation drawn but never re-typed into
// the summary box used to export an empty Root Cause, which is exactly the
// record an audit asks for.
describe('the last why of a 5-Why', () => {
  const node = (id, labelText, kind = 'box') => ({ id, data: { label: labelText, kind } })
  const edge = (source, target) => ({ id: `e_${source}_${target}`, source, target })

  const chain = {
    nodes: [
      node('problem', 'Problem: pallet fell', 'root'),
      node('w1', 'Rack beam gave way'),
      node('w2', 'Beam was not seated'),
      node('w3', 'Reconfiguration was not checked'),
    ],
    edges: [edge('problem', 'w1'), edge('w1', 'w2'), edge('w2', 'w3')],
  }

  it('takes the end of the chain, not the problem it started from', () => {
    expect(fiveWhyFindings(chain)).toEqual(['Reconfiguration was not checked'])
  })

  // Add Branch exists so a chain can fork into parallel causes. Reporting one
  // of them would hide the rest.
  it('takes every leaf when the chain forks', () => {
    const forked = {
      nodes: [...chain.nodes, node('w2b', 'Nobody signed off the change')],
      edges: [...chain.edges, edge('w1', 'w2b')],
    }
    expect(fiveWhyFindings(forked)).toEqual(['Reconfiguration was not checked', 'Nobody signed off the change'])
  })

  // Someone marking a node with "Add Root Cause" said which one it is.
  it('prefers a node explicitly marked as the root cause', () => {
    const marked = {
      nodes: [...chain.nodes, node('rc', 'No change-control on racking', 'root')],
      edges: [...chain.edges, edge('w3', 'rc')],
    }
    expect(fiveWhyFindings(marked)).toEqual(['No change-control on racking'])
  })

  // Exporting "Why?" fills the column an audit reads, so the gap stops looking
  // like a gap. Worse than exporting nothing.
  it('ignores the placeholders the toolbar creates', () => {
    const untouched = {
      nodes: [node('problem', 'Problem: …', 'root'), node('w1', 'Why did this happen?'), node('w2', 'Why?')],
      edges: [edge('problem', 'w1'), edge('w1', 'w2')],
    }
    expect(fiveWhyFindings(untouched)).toEqual([])
  })

  it('copes with no diagram at all', () => {
    expect(fiveWhyFindings()).toEqual([])
    expect(fiveWhyFindings({})).toEqual([])
    expect(fiveWhyFindings({ nodes: 'nonsense', edges: null })).toEqual([])
  })

  it('leads the Root Cause column, with the summary as the reasoning', () => {
    const inc = { investigations: [{ method: '5why', diagram: chain, summary: 'Change control gap.' }] }
    expect(rootCauseOf(inc)).toBe('5-Why Analysis: Reconfiguration was not checked — Change control gap.')
  })

  it('still reports the diagram when nobody wrote a summary', () => {
    const inc = { investigations: [{ method: '5why', diagram: chain, summary: '' }] }
    expect(rootCauseOf(inc)).toBe('5-Why Analysis: Reconfiguration was not checked')
  })

  // Only 5-Why has a chain to walk; a fishbone's diagram is a different shape
  // and must not be mined for a "last why" that does not exist.
  it('does not walk the diagram of another method', () => {
    const inc = { investigations: [{ method: 'fishbone', diagram: chain, summary: 'Man/Method.' }] }
    expect(rootCauseOf(inc)).toBe('Fishbone (Ishikawa): Man/Method.')
  })
})
