// The mail that goes out when an incident is first reported.
//
// Description is `narrative` (the register export calls that column
// Description). 5 Why is not a text field: it is an investigation whose
// method is `5why`, stored on `investigations[]` (older incidents used a
// single `investigation` object). The chain is the diagram; the summary box
// is the prose underneath it. `narrative`, `probableCause` and
// `investigations[].summary` are sealed when encryption is on. Diagram labels
// are not, today; each one still goes through readableText so sealing them
// later cannot put an envelope in an inbox. A sealed field uses the same
// stand-in as a sealed CAPA title: the mail says the words are in the app,
// and never the ciphertext.
import { safeOrigin } from '../mailer.js'
import { safePathSegment } from '../assignmentNotify.js'
import { renderLayout } from './layout.js'
import { readableText, safeLine, safeMailPath } from './safe.js'

// Keys mirror src/modules/incidents/lib/constants.js. An unknown key is shown
// as stored, so a lifecycle added there still appears, rather than vanishing
// until this map is updated.
const SEVERITY_LABEL = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}
const LIFECYCLE_LABEL = {
  reporting: 'Reporting',
  investigation_team: 'Team Formed',
  investigation: 'Investigation',
  capa: 'CAPA',
  horizontal: 'Horizontal Deployment',
  closed: 'Closed',
}
const TYPE_LABEL = {
  near_miss: 'Near Miss',
  first_aid: 'First Aid Injury',
  lost_time: 'Lost Time Injury',
  reportable: 'Reportable Injury',
  property_damage: 'Property Damage',
}

// The labels the 5-Why toolbar creates before anyone types over them. Same
// pattern as fiveWhyFindings in src/modules/incidents/lib/exporter.js: exporting
// "Why?" as analysis fills the gap an audit would otherwise see.
const PLACEHOLDER = /^(problem:?.*|why\??|why did this happen\??|why\? \(new path\)|root cause)$/i

export const SEALED_NOTE = 'Sealed — open the incident in the app'
export const NOT_RECORDED = 'Not recorded yet'

function classify(value) {
  if (typeof value !== 'string') return { kind: 'empty' }
  const raw = value.trim()
  if (!raw) return { kind: 'empty' }
  const text = readableText(raw)
  if (!text) return { kind: 'sealed' }
  return { kind: 'text', text }
}

function safeProse(value, max = 4000) {
  const text = readableText(value)
  if (!text) return ''
  // C0 controls other than newline become spaces. A character class would be
  // the short way, and no-control-regex rejects it: those escapes are how a
  // pattern silently matches the wrong byte. Newlines stay so a narrative
  // keeps its paragraphs; carriage returns were already folded into them.
  let flattened = ''
  for (const ch of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
    const code = ch.codePointAt(0)
    flattened += code === 10 || code > 31 ? ch : ' '
  }
  const cleaned = flattened
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1).trimEnd()}…`
}

function labelled(map, value) {
  const text = readableText(value)
  if (!text) return ''
  return safeLine(map[text] || text, 80)
}

/**
 * Same normalisation as incidentInvestigations in
 * src/modules/incidents/lib/incidents.js. An empty array is authoritative:
 * it does not fall through to the legacy object.
 */
export function investigationsOf(incident) {
  if (Array.isArray(incident?.investigations)) return incident.investigations.filter(Boolean)
  const legacy = incident?.investigation
  if (legacy && typeof legacy === 'object' && legacy.method) return [legacy]
  return []
}

function whyChain(diagram) {
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : []
  const edges = Array.isArray(diagram?.edges) ? diagram.edges : []
  const byId = new Map()
  for (const node of nodes) {
    if (node && typeof node.id === 'string' && !byId.has(node.id)) byId.set(node.id, node)
  }
  const children = new Map()
  for (const edge of edges) {
    if (typeof edge?.source !== 'string' || typeof edge?.target !== 'string') continue
    if (!children.has(edge.source)) children.set(edge.source, [])
    children.get(edge.source).push(edge.target)
  }
  const ordered = []
  const seen = new Set()
  const visit = (id) => {
    if (typeof id !== 'string' || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
    for (const child of children.get(id) || []) visit(child)
  }
  if (byId.has('problem')) visit('problem')
  else {
    const incoming = new Set(
      edges.map((edge) => edge?.target).filter((id) => typeof id === 'string')
    )
    for (const node of nodes) {
      if (typeof node?.id === 'string' && !incoming.has(node.id)) visit(node.id)
    }
  }
  for (const node of nodes) if (typeof node?.id === 'string') visit(node.id)

  const out = []
  for (const id of ordered) {
    if (id === 'problem') continue
    const state = classify(byId.get(id)?.data?.label)
    if (state.kind === 'sealed') out.push({ sealed: true })
    else if (state.kind === 'text' && !PLACEHOLDER.test(state.text)) out.push({ text: state.text })
  }
  return out
}

/**
 * The 5 Why section. Absent, sealed, or the chain plus any unsealed summary.
 * A fishbone (or any other method) is not walked: its diagram is a different
 * shape, and mining it for "whys" would invent an analysis nobody drew.
 */
export function fiveWhyText(incident) {
  const investigations = investigationsOf(incident).filter((inv) => inv?.method === '5why')
  if (!investigations.length) return NOT_RECORDED

  const parts = []
  let sawText = false
  let sawSealed = false
  investigations.forEach((inv, index) => {
    const labels = whyChain(inv?.diagram)
    const lines = []
    let n = 0
    for (const item of labels) {
      if (item.sealed) {
        sawSealed = true
        continue
      }
      n += 1
      sawText = true
      lines.push(`${n}. ${safeLine(item.text, 300)}`)
    }
    const summary = classify(inv?.summary)
    if (summary.kind === 'sealed') sawSealed = true
    if (summary.kind === 'text') {
      sawText = true
      const prose = safeProse(summary.text, 1000)
      if (prose) lines.push(`Summary: ${prose}`)
    }
    if (!lines.length) return
    const heading = investigations.length > 1 ? `Analysis ${index + 1}\n` : ''
    parts.push(`${heading}${lines.join('\n')}`)
  })

  if (!sawText && sawSealed) return SEALED_NOTE
  if (!sawText) return NOT_RECORDED
  if (sawSealed) parts.push('Part of this analysis is sealed in the app.')
  return parts.join('\n\n')
}

function descriptionText(incident) {
  const state = classify(incident?.narrative)
  if (state.kind === 'sealed') return SEALED_NOTE
  if (state.kind === 'text') return safeProse(state.text, 4000) || NOT_RECORDED
  return NOT_RECORDED
}

function probableCauseBlock(incident) {
  const state = classify(incident?.probableCause)
  if (state.kind === 'sealed') return SEALED_NOTE
  if (state.kind === 'text') return safeProse(state.text, 2000)
  return ''
}

function earliestDue(incident) {
  const capa = Array.isArray(incident?.capa) ? incident.capa : []
  const dates = []
  for (const row of capa) {
    const due = safeLine(readableText(row?.dueDate), 40)
    if (due) dates.push(due)
  }
  dates.sort()
  return dates[0] || ''
}

function clean(value) {
  return readableText(value)
}

export function renderIncidentReportedMail(
  incident = {},
  { docId = '', appOrigin = '', site = null, sender = '' } = {}
) {
  const ref = safeLine(clean(incident.refNo) || clean(incident.docId) || docId, 80)
  const subject = safeLine(ref ? `Incident reported: ${ref}` : 'Incident reported', 120)
  const when = [
    safeLine(clean(incident.incidentDate), 40),
    safeLine(clean(incident.incidentTime), 20),
  ]
    .filter(Boolean)
    .join(' ')

  const rows = []
  if (ref) rows.push({ label: 'Reference', value: ref })
  if (when) rows.push({ label: 'When', value: when })
  const severity = labelled(SEVERITY_LABEL, incident.severity)
  if (severity) rows.push({ label: 'Severity', value: severity })
  const status = labelled(LIFECYCLE_LABEL, incident.lifecycle)
  if (status) rows.push({ label: 'Status', value: status })
  const type = labelled(TYPE_LABEL, incident.type)
  if (type) rows.push({ label: 'Type', value: type })
  const siteName = safeLine(clean(incident.site) || clean(site?.name), 80)
  if (siteName) rows.push({ label: 'Site', value: siteName })
  const region = safeLine(clean(incident.region) || clean(site?.region), 80)
  if (region) rows.push({ label: 'Region', value: region })
  const entity = safeLine(clean(incident.entity) || clean(site?.entity), 80)
  if (entity) rows.push({ label: 'Entity', value: entity })
  const location = safeLine(clean(incident.location), 80)
  if (location) rows.push({ label: 'Location', value: location })
  const due = earliestDue(incident)
  if (due) rows.push({ label: 'Action due', value: due })

  const blocks = [
    { label: 'Description', text: descriptionText(incident) },
    { label: 'Probable cause', text: probableCauseBlock(incident) },
    { label: '5 Why', text: fiveWhyText(incident) },
  ]

  const segment = safePathSegment(typeof docId === 'string' ? docId : '')
  const path = safeMailPath(segment ? `/incidents/${segment}` : '/incidents')
  const origin = safeOrigin(appOrigin)
  const url = path && origin ? `${origin}${path}` : ''

  const { text, html, senderName } = renderLayout({
    subject,
    label: 'Incident reported',
    headline: 'An incident has been reported.',
    rows,
    blocks,
    actionLabel: 'Open the incident',
    url,
    path,
    sender,
  })
  return { subject, text, html, senderName }
}
