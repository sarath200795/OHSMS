// The four reports the lifecycle mails attach.
//
// Each one is the print the app already shows — MockDrillReport, the committee
// minutes overlay, IncidentReportDoc (the initial report, `full=false`) and
// PermitPrintable — written out as text because those layouts are HTML the
// browser prints. Functions cannot run that print, and the app does not save
// the result. The sections match. The bytes are not a second design of the
// record; they are the same fields, with two cuts the print does not need
// because the browser has already decrypted:
//
//   • A sealed field is the stand-in, never the envelope. The function does
//     not hold the content key, and ciphertext in an inbox is both unreadable
//     and a copy of the sealed value.
//   • Photographs and any other sealed object are left in Storage. The print
//     embeds them only after the client has opened them.
//
// Injury clinical detail is a third cut. The initial-report print includes it
// only when the reader may open /injuries. This mail also goes to members, so
// the mailed copy uses the print's omission sentence and stops there.
import { safeOrigin } from './mailer.js'
import { renderTextPdf } from './pdfDoc.js'
import {
  decodeDataUrl,
  isSealedPointer,
  permitObjectPath,
  publicFileName,
  reportPdfName,
  sniffType,
  withExtension,
} from './mailAttachments.js'
import { classifyMailText, readableText, SEALED_STAND_IN } from './mailTemplates/safe.js'

// How many repeating rows one mail will carry. The document is client-writable
// and this function still has to finish the SMTP send. The rest are counted.
const ROW_CAP = 40
const PROSE_CAP = 6000

// The eight teams on the printed drill report. The record stores a boolean per
// index, not the name (src/modules/fire/lib/mockDrillTemplates.js).
const EMERGENCY_TEAMS = [
  'Transportation Team',
  'Spill Response Team',
  'Fire Fighting Team',
  'Evacuation Team',
  'Medical Emergency Team',
  'Security',
  'Public Relation',
]

// Keys mirror src/modules/incidents/lib/constants.js. An unknown key is shown
// as stored, so a value added there still appears.
const INCIDENT_TYPE = {
  near_miss: 'Near Miss',
  first_aid: 'First Aid Injury',
  lost_time: 'Lost Time Injury',
  reportable: 'Reportable Injury',
  property_damage: 'Property Damage',
}
const SEVERITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const HSE_CATEGORY = {
  slip_trip_fall: 'Slip, Trip or Fall (same level)',
  fall_from_height: 'Fall from Height',
  struck_by_moving_object: 'Struck by Moving / Falling Object',
  contact_with_machinery: 'Contact with Machinery',
  manual_handling: 'Manual Handling / Lifting',
  vehicle: 'Struck by Vehicle',
  electricity: 'Contact with Electricity',
  exposure_to_substance: 'Exposure to Harmful Substance',
  fire_explosion: 'Fire / Explosion',
  assault: 'Act of Violence / Assault',
  other: 'Other',
}

function field(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const found = classifyMailText(value)
  if (found.kind === 'text') return found.text
  if (found.kind === 'sealed') return SEALED_STAND_IN
  return '—'
}

/** Readable primary, then a readable fallback. An envelope is never the line. */
function prefer(primary, fallback) {
  const first = classifyMailText(primary)
  if (first.kind === 'text') return first.text
  const second = classifyMailText(fallback)
  if (second.kind === 'text') return second.text
  if (first.kind === 'sealed' || second.kind === 'sealed') return SEALED_STAND_IN
  return '—'
}

function prose(value) {
  const text = field(value)
  if (text === '—' || text === SEALED_STAND_IN) return text
  if (text.length <= PROSE_CAP) return text
  return `${text.slice(0, PROSE_CAP - 1).trimEnd()}…`
}

function enumLabel(map, key) {
  const text = readableText(key)
  if (!text) return field(key)
  return map[text] || text.replace(/_/g, ' ')
}

function rowsOf(list) {
  const all = Array.isArray(list) ? list : []
  return { rows: all.slice(0, ROW_CAP), more: Math.max(0, all.length - ROW_CAP) }
}

function formatWhen(value) {
  const text = readableText(value)
  if (!text) return ''
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return text.slice(0, 40)
  return `${new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function pdf(blocks, filename) {
  return { filename, content: renderTextPdf(blocks), contentType: 'application/pdf' }
}

function pushMore(blocks, more) {
  if (more > 0) blocks.push({ kind: 'body', text: `${more} further items are in the app.` })
}

export function drillReportPdf(record, scope = {}) {
  const r = record || {}
  const eventType = readableText(r.eventType) || 'Mock Drill'
  const blocks = [
    { kind: 'kicker', text: 'WEHS · Fire Marshal' },
    { kind: 'title', text: `${eventType} report` },
    { kind: 'body', text: `ID ${field(r.docId)}` },
    { kind: 'body', text: `Date ${field(r.date)}` },
    { kind: 'gap' },
    { kind: 'body', text: `Scenario: ${field(r.scenario)}` },
    { kind: 'body', text: `Site / location: ${prefer(r.centerName, scope.siteName)}` },
    { kind: 'body', text: `Time: ${field(r.time)}` },
    { kind: 'body', text: `Region: ${prefer(r.region, scope.region)}` },
    { kind: 'body', text: `Entity: ${prefer(r.entity, scope.entity)}` },
    { kind: 'body', text: `Commander(s): ${field(r.commander)}` },
  ]
  if (readableText(r.fireSource))
    blocks.push({ kind: 'body', text: `Fire source: ${field(r.fireSource)}` })
  if (readableText(r.medicalIncidentType)) {
    blocks.push({ kind: 'body', text: `Medical incident: ${field(r.medicalIncidentType)}` })
  }

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '1. Execution metrics' })
  blocks.push({ kind: 'body', text: `Evacuation time: ${minutes(r.evacTimeMin)}` })
  blocks.push({ kind: 'body', text: `ERT response: ${minutes(r.ertResponseMin)}` })
  blocks.push({ kind: 'body', text: `Head count: ${field(r.headCount)}` })
  blocks.push({ kind: 'body', text: `Outcome: ${field(r.outcome)}` })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '2. Teams activated' })
  const alerted = r.teamsAlerted || {}
  for (let i = 0; i < EMERGENCY_TEAMS.length; i += 1) {
    blocks.push({ kind: 'body', text: `${alerted[i] ? '[x]' : '[ ]'} ${EMERGENCY_TEAMS[i]}` })
  }

  const checklistTitle =
    r.scenario === 'Medical Emergency'
      ? '3. Medical examination & response checklist'
      : '3. Procedural execution checklist'
  blocks.push({ kind: 'gap' }, { kind: 'section', text: checklistTitle })
  const checklist = rowsOf(r.checklist)
  const status = r.checklistStatus || {}
  if (!checklist.rows.length) blocks.push({ kind: 'body', text: 'No checklist data.' })
  checklist.rows.forEach((item, idx) => {
    blocks.push({ kind: 'body', text: `${status[idx] ? 'PASS' : 'FAIL'}  ${field(item)}` })
  })
  pushMore(blocks, checklist.more)
  blocks.push({ kind: 'body', text: `Overall protocol score: ${scoreLabel(r.score)}` })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '4. Chronological action log' })
  const actions = rowsOf(r.actionLog)
  if (!actions.rows.length) blocks.push({ kind: 'body', text: 'No action logs recorded.' })
  actions.rows.forEach((row) => {
    blocks.push({
      kind: 'body',
      text: `${field(row?.time)}  ${field(row?.action)}  ${field(row?.observation)}`,
    })
  })
  pushMore(blocks, actions.more)

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '5. Debrief and CAPA plan' })
  const debrief = prose(r.debrief)
  blocks.push({
    kind: 'body',
    text: `Debrief notes: ${debrief === '—' ? 'None recorded.' : debrief}`,
  })
  const capa = rowsOf(r.capa)
  if (!capa.rows.length) blocks.push({ kind: 'body', text: 'No CAPA items required.' })
  capa.rows.forEach((item) => {
    const due = field(item?.due)
    const state = readableText(item?.status) || 'Open'
    blocks.push({
      kind: 'body',
      text: `${field(item?.action)} | ${field(item?.owner)} | ${due} | ${state}`,
    })
  })
  pushMore(blocks, capa.more)

  // Evidence photos are sealed objects (policy mockDrills/photos, files: true).
  // The print shows them after the browser decrypts. Attaching the stored
  // bytes would send ciphertext.
  if (r.photoCount > 0 || (Array.isArray(r.photos) && r.photos.length > 0)) {
    blocks.push({
      kind: 'gap',
    })
    blocks.push({
      kind: 'body',
      text: 'Evidence photos are stored with the drill and are not included in this copy.',
    })
  }

  blocks.push({ kind: 'gap' }, { kind: 'body', text: 'Incident Commander signature' })
  blocks.push({ kind: 'body', text: 'EHS Manager signature' })
  blocks.push({
    kind: 'body',
    text: 'Generated by Fire Marshal for an OHSMS notification. Open the drill in the app for the live record.',
  })
  return pdf(blocks, reportPdfName('Mock-Drill-Report', r.docId))
}

function scoreLabel(score) {
  if (typeof score === 'number' && Number.isFinite(score)) return `${score}%`
  const found = classifyMailText(score)
  if (found.kind === 'text') return found.text.endsWith('%') ? found.text : `${found.text}%`
  if (found.kind === 'sealed') return SEALED_STAND_IN
  return '0%'
}

function minutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value} min`
  const text = readableText(value)
  return text ? `${text} min` : '—'
}

export function meetingMinutesPdf(meeting, scope = {}) {
  const m = meeting || {}
  const blocks = [
    { kind: 'kicker', text: 'WEHS · ISO 45001 OHSMS' },
    { kind: 'title', text: 'Consultation and meeting minutes' },
    { kind: 'body', text: `Ref ${field(m.docId)}` },
    { kind: 'gap' },
    { kind: 'section', text: '1. Meeting details' },
    { kind: 'body', text: `Type: ${field(m.type)}` },
    { kind: 'body', text: `Time: ${field(m.time)}` },
    {
      kind: 'body',
      text: `Site / location: ${prefer(scope.siteName, m.siteId ? '' : 'Organisation-wide')}`,
    },
    { kind: 'body', text: `Date: ${field(m.date)}` },
    { kind: 'body', text: `Subject / agenda: ${field(m.subject)}` },
    { kind: 'gap' },
    { kind: 'section', text: '2. Inputs / pre-requisites' },
  ]
  const pre = prose(m.preRequisites)
  blocks.push({ kind: 'body', text: pre === '—' ? 'None specified.' : pre })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '3. Attendance roster' })
  const attendees = rowsOf(m.attendees)
  if (!attendees.rows.length) blocks.push({ kind: 'body', text: 'No attendees recorded.' })
  attendees.rows.forEach((person, index) => {
    const name = field(person?.name)
    const role = [readableText(person?.role), readableText(person?.designation)]
      .filter(Boolean)
      .join(', ')
    const company = readableText(person?.company)
    const who = [name, company].filter((part) => part && part !== '—').join(', ')
    const external = person?.userId === 'External' ? ' (Contractor/EXT)' : ''
    blocks.push({
      kind: 'body',
      text: `${index + 1}. ${who || '—'}${external}${role ? ` — ${role}` : ''}`,
    })
  })
  pushMore(blocks, attendees.more)

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '4. Discussion minutes' })
  const minutesText = prose(m.minutes)
  blocks.push({
    kind: 'body',
    text: minutesText === '—' ? 'No formal minutes documented.' : minutesText,
  })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: '5. Agreed action plan (CAPA)' })
  const actions = rowsOf(m.actions)
  if (!actions.rows.length) {
    blocks.push({ kind: 'body', text: 'No follow-up actions assigned during this meeting.' })
  }
  actions.rows.forEach((row, index) => {
    blocks.push({
      kind: 'body',
      text: `${index + 1}. ${field(row?.action)} | ${field(row?.owner)} | ${field(row?.due)}`,
    })
  })
  pushMore(blocks, actions.more)

  blocks.push({ kind: 'gap' }, { kind: 'body', text: 'Prepared by / Chairperson' })
  blocks.push({ kind: 'body', text: 'Site manager / EHS lead approval' })
  blocks.push({
    kind: 'body',
    text: 'Generated by WEHS for an OHSMS notification. Open the meeting in the app for the live minutes.',
  })
  return pdf(blocks, reportPdfName('Meeting-Minutes', m.docId))
}

function personLine(person) {
  if (!person || typeof person !== 'object') return '—'
  const name = field(person.name)
  let head = name === '—' ? 'Unnamed' : name
  const dept = readableText(person.dept)
  if (dept) head += ` (${dept})`
  const bits = [head]
  const company = readableText(person.company)
  const contact = readableText(person.contact)
  const role = readableText(person.role)
  if (company) bits.push(company)
  if (contact) bits.push(contact)
  if (role) bits.push(role)
  if (person.kind === 'internal') bits.push('Internal')
  else if (person.kind === 'external') bits.push('External')
  return bits.join(' · ')
}

export function incidentReportPdf(incident, { docId, site } = {}) {
  const inc = incident || {}
  const siteName = readableText(site?.name)
  const blocks = [
    { kind: 'kicker', text: 'WEHS · Incident IRA' },
    { kind: 'title', text: 'Initial incident report' },
  ]
  if (siteName) blocks.push({ kind: 'body', text: siteName })
  blocks.push({ kind: 'body', text: field(inc.refNo) !== '—' ? field(inc.refNo) : field(docId) })
  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Incident details' })
  blocks.push({ kind: 'body', text: `Date: ${field(inc.incidentDate)}` })
  blocks.push({ kind: 'body', text: `Time: ${field(inc.incidentTime)}` })
  blocks.push({ kind: 'body', text: `Type: ${enumLabel(INCIDENT_TYPE, inc.type)}` })
  blocks.push({ kind: 'body', text: `Severity: ${enumLabel(SEVERITY, inc.severity)}` })
  blocks.push({ kind: 'body', text: `HSE category: ${enumLabel(HSE_CATEGORY, inc.category)}` })
  blocks.push({ kind: 'body', text: `Location: ${field(inc.location)}` })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Incident narrative' })
  blocks.push({ kind: 'body', text: prose(inc.narrative) })
  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Probable cause' })
  blocks.push({ kind: 'body', text: prose(inc.probableCause) })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Affected personnel' })
  const people = rowsOf(inc.affectedPersonnel)
  if (!people.rows.length) blocks.push({ kind: 'body', text: 'None recorded.' })
  people.rows.forEach((person) => blocks.push({ kind: 'body', text: personLine(person) }))
  pushMore(blocks, people.more)

  const injuries = rowsOf(inc.injuryReports)
  if (injuries.rows.length) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Injury reports' })
    injuries.rows.forEach((report) => {
      const name = field(report?.personName)
      blocks.push({ kind: 'body', text: name === '—' ? 'Injured person' : name })
      blocks.push({
        kind: 'body',
        text: 'An injury report is on file. Injury type, body part, medication, first aid and days to return to work are part of the medical record and are not included in this copy.',
      })
    })
    pushMore(blocks, injuries.more)
  }

  blocks.push({ kind: 'gap' })
  blocks.push({
    kind: 'body',
    text: 'This is the initial incident report. It is a record-keeping aid and does not replace any statutory reporting obligation.',
  })
  const ref = readableText(inc.refNo) || readableText(docId)
  return pdf(blocks, reportPdfName('Incident-Report', ref))
}

function bothTeams(permit, key) {
  const block = key ? permit?.[key] : permit
  return block?.engineering?.status === 'approved' && block?.operations?.status === 'approved'
}

/**
 * The banner PermitPrintable paints from derivePermitStatus. openUnsafeCount
 * is joined in the browser and is not on the stored permit, so that banner
 * is not reproduced here.
 */
export function permitStatusLabel(permit, now = Date.now()) {
  if (permit?.closedDueToObservation) return 'Closed — Non-Compliance at work location'
  if (bothTeams(permit, 'closure')) return 'Closed'
  if (!bothTeams(permit)) return 'Draft'
  const ext = bothTeams(permit, 'extension')
  const endRaw = ext ? permit?.extension?.newValidTo || permit?.validTo : permit?.validTo
  const end = typeof endRaw === 'string' ? Date.parse(endRaw) : NaN
  if (Number.isNaN(end)) return ext ? 'Extended & In Progress' : 'Approved & Work in Progress'
  if (now > end) return 'Not Closed / Expired'
  return ext ? 'Extended & In Progress' : 'Approved & Work in Progress'
}

function decisionLine(block) {
  if (!block || typeof block !== 'object') return '—'
  const status =
    block.status === 'approved'
      ? 'Approved'
      : block.status === 'rejected'
        ? 'Rejected'
        : block.status === 'pending'
          ? 'Pending'
          : field(block.status)
  const by = readableText(block.byName)
  const at = formatWhen(block.at)
  return [status === '—' ? 'Pending' : status, by ? `by ${by}` : '', at ? `(${at})` : '']
    .filter(Boolean)
    .join(' ')
}

function tagLine(items) {
  const { rows, more } = rowsOf(items)
  const parts = []
  for (const item of rows) {
    const text = readableText(item)
    if (text) parts.push(text)
    else if (classifyMailText(item).kind === 'sealed') parts.push(SEALED_STAND_IN)
  }
  const line = parts.length ? parts.join(', ') : 'None'
  return more > 0 ? `${line} (${more} further items are in the app)` : line
}

function publicLink(token, origin) {
  const raw = readableText(token)
  if (!raw || !/^[A-Za-z0-9_-]{8,80}$/.test(raw)) return ''
  const path = `/permit/${raw}`
  const base = safeOrigin(origin)
  return base ? `${base}${path}` : path
}

export function permitPdf(permit, documents = [], { appOrigin = '', now = Date.now() } = {}) {
  const p = permit || {}
  const blocks = [
    { kind: 'kicker', text: 'WEHS · Permit to work' },
    { kind: 'title', text: 'Permit to work' },
    { kind: 'body', text: field(p.permitNo) !== '—' ? field(p.permitNo) : field(p.docId) },
    { kind: 'body', text: `Status: ${permitStatusLabel(p, now)}` },
  ]
  const link = publicLink(p.qrToken, appOrigin)
  if (link) {
    blocks.push({ kind: 'body', text: `Public link: ${link}` })
    blocks.push({
      kind: 'body',
      text: 'The copy printed in the app carries a QR code for this address.',
    })
  }
  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Work details' })
  blocks.push({ kind: 'body', text: `Type of work: ${field(p.typeOfWork)}` })
  if (field(p.site) !== '—') blocks.push({ kind: 'body', text: `Site: ${field(p.site)}` })
  blocks.push({ kind: 'body', text: `Date / start time: ${field(p.date)} ${field(p.time)}`.trim() })
  blocks.push({ kind: 'body', text: `Valid from: ${formatWhen(p.validFrom) || '—'}` })
  blocks.push({ kind: 'body', text: `Valid to: ${formatWhen(p.validTo) || '—'}` })
  blocks.push({ kind: 'body', text: `Job location: ${field(p.jobLocation)}` })
  blocks.push({ kind: 'body', text: `Issuing department: ${field(p.issuingDepartment)}` })
  const phone = readableText(p.issuedToPhone)
  blocks.push({
    kind: 'body',
    text: `Issued to: ${field(p.issuedToName)}${phone ? ` · ${phone}` : ''}`,
  })
  blocks.push({ kind: 'body', text: `Job description: ${prose(p.jobDescription)}` })
  blocks.push({ kind: 'body', text: `Raised by: ${field(p.createdByName)}` })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Hazard identification' })
  blocks.push({ kind: 'body', text: tagLine(p.hazards) })

  const jsa = rowsOf(p.jsa)
  if (jsa.rows.length) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Job safety analysis' })
    jsa.rows.forEach((row) => {
      blocks.push({
        kind: 'body',
        text: `${field(row?.step)} | ${field(row?.hazard)} | ${field(row?.precaution)}`,
      })
    })
    pushMore(blocks, jsa.more)
  }

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'PPE required' })
  blocks.push({ kind: 'body', text: tagLine(p.ppe) })
  blocks.push({ kind: 'section', text: 'Precautions' })
  blocks.push({ kind: 'body', text: tagLine(p.precautions) })

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Participants' })
  const participants = rowsOf(p.participants)
  if (!participants.rows.length) blocks.push({ kind: 'body', text: 'None' })
  participants.rows.forEach((person) => {
    const name = field(person?.name)
    const type = readableText(person?.type)
    const company = readableText(person?.company)
    const contact = readableText(person?.contact)
    blocks.push({
      kind: 'body',
      text: [name, type ? `(${type})` : '', company, contact].filter(Boolean).join(' '),
    })
  })
  pushMore(blocks, participants.more)

  const watchers = rowsOf(p.fireWatchers)
  if (watchers.rows.length) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Fire watchers' })
    watchers.rows.forEach((watcher) => {
      const details = readableText(watcher?.details)
      blocks.push({
        kind: 'body',
        text: `${field(watcher?.name)}${details ? ` · ${details}` : ''}`,
      })
    })
    pushMore(blocks, watchers.more)
  }
  if (
    readableText(p.confinedWatcher?.name) ||
    classifyMailText(p.confinedWatcher?.name).kind === 'sealed'
  ) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Standby watcher / attendant' })
    const details = readableText(p.confinedWatcher?.details)
    blocks.push({
      kind: 'body',
      text: `${field(p.confinedWatcher?.name)}${details ? ` · ${details}` : ''}`,
    })
  }

  const docs = Array.isArray(documents) ? documents : []
  const required = rowsOf(p.requiredDocs)
  const extras = docs.filter((doc) => doc && doc.key === 'extra')
  if (required.rows.length || extras.length || docs.length) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Documents' })
    required.rows.forEach((req) => {
      const attached = docs.some((doc) => doc && doc.key && doc.key === req?.key)
      const label = field(req?.label)
      blocks.push({
        kind: 'body',
        text: `${attached ? '[x]' : '[ ]'} ${label}${req?.mandatory ? ' (mandatory)' : ''}${attached ? '' : ' — not attached'}`,
      })
    })
    pushMore(blocks, required.more)
    extras.slice(0, ROW_CAP).forEach((doc) => {
      const name = readableText(doc.fileName) || readableText(doc.label) || 'Attachment'
      blocks.push({ kind: 'body', text: `[x] ${name} (other)` })
    })
  }

  blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Approvals' })
  blocks.push({ kind: 'body', text: `Engineering: ${decisionLine(p.engineering)}` })
  blocks.push({ kind: 'body', text: `Operations: ${decisionLine(p.operations)}` })
  if (p.assignedEngineer)
    blocks.push({ kind: 'body', text: 'Assigned engineer: Specific approver assigned' })
  if (p.assignedOperator)
    blocks.push({ kind: 'body', text: 'Assigned operator: Specific approver assigned' })

  if (p.extension) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Extension' })
    blocks.push({ kind: 'body', text: `Reason: ${field(p.extension.reason)}` })
    blocks.push({
      kind: 'body',
      text: `New valid to: ${formatWhen(p.extension.newValidTo) || '—'}`,
    })
    blocks.push({
      kind: 'body',
      text: `Participant changes: ${field(p.extension.participantChanges)}`,
    })
    blocks.push({ kind: 'body', text: `Risk changes: ${field(p.extension.riskChanges)}` })
    blocks.push({ kind: 'body', text: `Engineering: ${decisionLine(p.extension.engineering)}` })
    blocks.push({ kind: 'body', text: `Operations: ${decisionLine(p.extension.operations)}` })
  }
  if (p.closure) {
    blocks.push({ kind: 'gap' }, { kind: 'section', text: 'Closure' })
    const who = field(p.closure.requestedByName)
    const at = formatWhen(p.closure.requestedAt)
    blocks.push({ kind: 'body', text: `Requested by: ${who}${at ? ` (${at})` : ''}` })
    blocks.push({ kind: 'body', text: `Engineering: ${decisionLine(p.closure.engineering)}` })
    blocks.push({ kind: 'body', text: `Operations: ${decisionLine(p.closure.operations)}` })
  }

  blocks.push({ kind: 'gap' })
  blocks.push({ kind: 'body', text: 'Issuer sign and date' })
  blocks.push({ kind: 'body', text: 'Engineering sign and date' })
  blocks.push({ kind: 'body', text: 'Operations sign and date' })
  const ref = readableText(p.permitNo) || readableText(p.docId)
  return pdf(blocks, reportPdfName('Permit-to-Work', ref))
}

function storedFileName(data, contentType) {
  const named = readableText(data?.fileName) || readableText(data?.label) || 'Permit-attachment'
  return withExtension(publicFileName(named, 'Permit-attachment'), contentType)
}

/**
 * Files already stored on this permit: the documents subcollection, nothing
 * else in the bucket. Inline data URLs from the pre-storage fallback are read
 * here. A Storage object is read only through `readObject`, and only when
 * `permitObjectPath` accepts it. A download URL is not fetched.
 */
export async function permitStoredFiles({ db, orgId, permitId, readObject, logger, context = {} }) {
  const meta = []
  const files = []
  if (
    typeof permitId !== 'string' ||
    !permitId ||
    permitId.includes('/') ||
    permitId.includes('..')
  ) {
    return { meta, files }
  }
  if (typeof orgId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orgId)) return { meta, files }
  let snap
  try {
    snap = await db.collection(`organizations/${orgId}/permits/${permitId}/documents`).get()
  } catch (err) {
    logger?.error?.('permit attachments unreadable', {
      ...context,
      error: err?.message || 'read-failed',
    })
    return { meta, files }
  }
  const docs = Array.isArray(snap?.docs) ? snap.docs : []
  for (const doc of docs.slice(0, 25)) {
    const data = typeof doc?.data === 'function' ? doc.data() || {} : {}
    meta.push(data)
    const file = await onePermitFile(data, { orgId, readObject, logger, context })
    if (file) files.push(file)
  }
  if (docs.length > 25) logger?.info?.('attachment skipped', { ...context, reason: 'count' })
  return { meta, files }
}

async function onePermitFile(data, { orgId, readObject, logger, context }) {
  if (isSealedPointer(data)) {
    logger?.info?.('attachment skipped', { ...context, reason: 'sealed' })
    return null
  }
  let content = null
  const inlineRaw = typeof data.fileData === 'string' ? data.fileData.trim() : ''
  if (inlineRaw) {
    const inline = decodeDataUrl(inlineRaw)
    if (!inline) {
      logger?.info?.('attachment skipped', { ...context, reason: 'unreadable' })
      return null
    }
    content = inline.content
  } else {
    const path = permitObjectPath(orgId, data.filePath)
    if (!path) {
      if (data.filePath || data.fileUrl) {
        logger?.info?.('attachment skipped', {
          ...context,
          reason: data.filePath ? 'foreign-path' : 'no-path',
        })
      }
      return null
    }
    if (typeof readObject !== 'function') {
      logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
      return null
    }
    try {
      const raw = await readObject(path)
      content = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : null
    } catch (err) {
      logger?.info?.('attachment skipped', {
        ...context,
        reason: 'missing',
        error: err?.message || 'missing',
      })
      return null
    }
  }
  if (!content || !content.length) {
    logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
    return null
  }
  const contentType = sniffType(content)
  return {
    filename: storedFileName(data, contentType || 'application/octet-stream'),
    content,
    contentType: contentType || 'application/octet-stream',
  }
}

/**
 * The permit copy, then every extra file on that permit we could actually
 * read. A missing or sealed file is omitted. The copy is still returned when
 * the file list fails.
 */
export async function permitMailAttachments({
  db,
  orgId,
  permitId,
  permit,
  readObject,
  appOrigin,
  logger,
  context = {},
  now,
}) {
  let meta = []
  let files = []
  try {
    const loaded = await permitStoredFiles({ db, orgId, permitId, readObject, logger, context })
    meta = loaded.meta
    files = loaded.files
  } catch (err) {
    logger?.error?.('attachment skipped', {
      ...context,
      reason: 'build-failed',
      error: err?.message || 'attachment-failed',
    })
  }
  const out = []
  try {
    out.push(permitPdf(permit, meta, { appOrigin, now }))
  } catch (err) {
    logger?.error?.('attachment skipped', {
      ...context,
      reason: 'build-failed',
      error: err?.message || 'attachment-failed',
    })
  }
  out.push(...files)
  return out
}
