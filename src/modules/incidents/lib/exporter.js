import * as XLSX from 'xlsx'
import {
  INCIDENT_TYPE_BY_KEY, SEVERITY_BY_KEY, LIFECYCLE_BY_KEY, ACTION_STATUS_BY_KEY,
  INVESTIGATION_METHOD_BY_KEY,
} from './constants'
import { incidentInvestigations } from './incidents'

/**
 * The incident register as a spreadsheet.
 *
 * Two sheets, because two different questions get asked of this data and one
 * shape cannot answer both. "What happened, and where did it get to" is one row
 * per incident. "What are we supposed to be doing about it, and is it done" is
 * one row per action — and flattening several actions into a single cell makes
 * that second question un-pivotable, which is the one people actually take to a
 * meeting.
 *
 * Labels, not keys. A column reading `investigation_team` is a database
 * artefact; the person opening this file wants "Team Formed".
 */

const label = (map, key, fallback = '') => map[key]?.label || key || fallback

// The labels the 5-Why toolbar creates before anyone types over them. Exporting
// "Why?" as a root cause is worse than exporting nothing: it fills the column
// that an audit reads, so the gap stops looking like a gap.
const PLACEHOLDER = /^(problem:?.*|why\??|why did this happen\??|why\? \(new path\)|root cause)$/i

/**
 * The answer at the end of a 5-Why chain.
 *
 * A 5-Why is a diagram, not prose: the finding is the LAST why — the node
 * nothing else hangs off. An explicitly added "Add Root Cause" node wins when
 * there is one, because someone marked it deliberately; otherwise every leaf is
 * taken, since the toolbar's "Add Branch" exists precisely so a chain can fork
 * into parallel causes and reporting only one of them would hide the rest.
 *
 * The problem node is excluded — it restates the incident, which the export
 * already carries as Description.
 */
export function fiveWhyFindings(diagram) {
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : []
  const edges = Array.isArray(diagram?.edges) ? diagram.edges : []
  if (!nodes.length) return []

  const hasOutgoing = new Set(edges.map((e) => e?.source).filter(Boolean))
  const notProblem = (n) => n?.id !== 'problem'

  const explicit = nodes.filter((n) => notProblem(n) && n?.data?.kind === 'root')
  const terminals = explicit.length
    ? explicit
    : nodes.filter((n) => notProblem(n) && !hasOutgoing.has(n?.id))

  return terminals
    .map((n) => String(n?.data?.label || '').trim())
    .filter((l) => l && !PLACEHOLDER.test(l))
}

/**
 * Root cause, per investigation.
 *
 * Two sources, and the order matters. For a 5-Why the finding lives in the
 * diagram — the last why — and that is the answer, so it leads. The wizard's
 * free-text summary ("Summarize the root cause(s) and key findings") follows as
 * the reasoning. Before this, an investigation whose whole analysis was drawn
 * and never re-typed into the summary box exported as an empty Root Cause,
 * which is exactly the record an audit asks for.
 */
export function rootCauseOf(incident) {
  return incidentInvestigations(incident)
    .map((inv) => {
      const parts = []
      if (inv?.method === '5why') {
        const findings = fiveWhyFindings(inv.diagram)
        if (findings.length) parts.push(findings.join('; '))
      }
      const summary = String(inv?.summary || '').trim()
      if (summary) parts.push(summary)
      if (!parts.length) return ''
      const method = label(INVESTIGATION_METHOD_BY_KEY, inv?.method)
      return method ? `${method}: ${parts.join(' — ')}` : parts.join(' — ')
    })
    .filter(Boolean)
    .join('\n')
}

const capaOf = (incident) => (Array.isArray(incident?.capa) ? incident.capa.filter(Boolean) : [])

/** One line per action, readable in a wrapped cell. */
export function actionsSummary(incident) {
  return capaOf(incident)
    .map((a) => {
      const bits = [a.description || 'Action']
      if (a.ownerName) bits.push(a.ownerName)
      if (a.dueDate) bits.push(`due ${a.dueDate}`)
      bits.push(label(ACTION_STATUS_BY_KEY, a.status, 'open'))
      return `• ${bits.join(' · ')}`
    })
    .join('\n')
}

/** Sheet 1 — one row per incident. */
export function incidentRows(incidents = []) {
  return (incidents || []).filter(Boolean).map((i) => {
    const actions = capaOf(i)
    // 'closed' is the only terminal state in ACTION_STATUS. Guessing at
    // synonyms would quietly count nothing and report every action as open.
    const done = actions.filter((a) => a.status === 'closed').length
    return {
      Reference: i.refNo || i.docId || i.id || '',
      Date: i.incidentDate || '',
      Time: i.incidentTime || '',
      Site: i.siteName || i.site || '',
      Location: i.location || '',
      'Incident Type': label(INCIDENT_TYPE_BY_KEY, i.type),
      Severity: label(SEVERITY_BY_KEY, i.severity),
      Description: i.narrative || '',
      'Root Cause': rootCauseOf(i),
      Actions: actionsSummary(i),
      'Actions Total': actions.length,
      'Actions Closed': done,
      Status: label(LIFECYCLE_BY_KEY, i.lifecycle),
      'Reported By': i.reportedByName || i.createdByName || '',
    }
  })
}

/** Sheet 2 — one row per corrective/preventive action, carrying its incident. */
export function actionRows(incidents = []) {
  const out = []
  for (const i of (incidents || []).filter(Boolean)) {
    for (const a of capaOf(i)) {
      out.push({
        Reference: i.refNo || i.docId || i.id || '',
        Date: i.incidentDate || '',
        Site: i.siteName || i.site || '',
        'Incident Type': label(INCIDENT_TYPE_BY_KEY, i.type),
        'Incident Status': label(LIFECYCLE_BY_KEY, i.lifecycle),
        Action: a.description || '',
        Owner: a.ownerName || '',
        Due: a.dueDate || '',
        'Action Status': label(ACTION_STATUS_BY_KEY, a.status, 'open'),
      })
    }
  }
  return out
}

// Wide enough to read without every reader resizing columns by hand; the free
// text ones are capped because a 5000-character narrative would otherwise make
// one column wider than the screen.
const INCIDENT_WIDTHS = [16, 12, 8, 20, 20, 18, 12, 60, 45, 45, 12, 12, 18, 20]
const ACTION_WIDTHS = [16, 12, 20, 18, 18, 50, 20, 12, 14]

/**
 * Write the workbook. Returns the row count so the caller can say what it did.
 *
 * An empty register still writes a file, with headers: a download that silently
 * does nothing is indistinguishable from a broken button.
 */
export function exportIncidents(incidents = [], filename = 'incidents.xlsx') {
  const rows = incidentRows(incidents)
  const actions = actionRows(incidents)

  const wb = XLSX.utils.book_new()
  const s1 = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    Reference: '', Date: '', Time: '', Site: '', Location: '', 'Incident Type': '',
    Severity: '', Description: '', 'Root Cause': '', Actions: '', 'Actions Total': '',
    'Actions Closed': '', Status: '', 'Reported By': '',
  }])
  s1['!cols'] = INCIDENT_WIDTHS.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, s1, 'Incidents')

  const s2 = XLSX.utils.json_to_sheet(actions.length ? actions : [{
    Reference: '', Date: '', Site: '', 'Incident Type': '', 'Incident Status': '',
    Action: '', Owner: '', Due: '', 'Action Status': '',
  }])
  s2['!cols'] = ACTION_WIDTHS.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, s2, 'Actions')

  XLSX.writeFile(wb, filename)
  return { incidents: rows.length, actions: actions.length }
}
