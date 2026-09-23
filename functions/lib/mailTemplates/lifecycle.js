// Branded bodies for permit, defect, drill, meeting and weather-digest mail.
//
// The chrome is renderLayout. This file only decides which lines are safe to
// hand it. A sealed envelope (enc:1: / enk:1:) is never a line: readableText
// drops it, and a field that was clearly sealed is replaced with a fixed
// sentence so the mail still says the record exists.
import { safeOrigin } from '../mailer.js'
import { renderLayout, footerLine } from './layout.js'
import { readableText, safeLine, safeMailPath } from './safe.js'

export const SEALED_LINE = 'Sealed — open the record in the app'

const SEALED_PREFIX = /^(?:enc|enk):1:/

function reveal(value, max = 180) {
  const text = safeLine(readableText(value), max)
  if (text) return text
  if (typeof value === 'string' && SEALED_PREFIX.test(value.trim())) return SEALED_LINE
  return ''
}

function plain(value, max = 180) {
  return safeLine(readableText(value), max)
}

function packaged(message) {
  const path = safeMailPath(message.path)
  const origin = safeOrigin(message.appOrigin)
  const url = path && origin ? `${origin}${path}` : ''
  const subject = safeLine(message.subject, 120)
  const rows = (message.rows || []).filter((row) => row && row.value)
  const { text, html } = renderLayout({
    subject,
    label: message.label,
    headline: message.headline,
    rows,
    actionLabel: message.actionLabel,
    url,
    path,
  })
  return { subject, text, html }
}

function row(label, value) {
  return value ? { label, value } : null
}

export function renderPermitMail(permit, event, { appOrigin = '' } = {}) {
  const ref = reveal(permit?.permitNo, 40) || reveal(permit?.docId, 40)
  const type = reveal(permit?.typeOfWork, 80)
  const site = reveal(permit?.site, 80)
  const location = reveal(permit?.jobLocation, 80)
  const region = plain(event?.region, 80)
  const entity = plain(event?.entity, 80)
  const status = plain(event?.status, 80)
  const team = plain(event?.teamLabel, 40)
  const lead = event?.subjectLead || 'Permit to work'
  const namedRef = ref && ref !== SEALED_LINE ? ref : ''
  const subject = namedRef ? `${lead}: ${namedRef}` : lead
  const rows = [
    row('Permit', ref),
    row('Type', type),
    row('Site', site),
    row('Location', location),
    row('Region', region),
    row('Entity', entity),
    row('Team', team),
    row('Status', status),
  ].filter(Boolean)
  return packaged({
    subject,
    label: 'Permit to work',
    headline: event?.headline || 'A permit to work changed.',
    rows,
    actionLabel: 'Open the permit',
    path: event?.path || '/permits',
    appOrigin,
  })
}

const ASSET_LABEL = {
  extinguisher: 'Fire extinguisher',
  aed: 'AED',
  fas: 'Fire alarm',
}

export function renderDefectMail(detail, { appOrigin = '' } = {}) {
  const asset = ASSET_LABEL[detail?.assetKind] || 'Equipment'
  const summary = reveal(detail?.summary, 180)
  const ref = plain(detail?.ref, 80)
  const site = plain(detail?.siteName, 80)
  const region = plain(detail?.region, 80)
  const entity = plain(detail?.entity, 80)
  const note = reveal(detail?.note, 180)
  const where = [site, region, entity].filter(Boolean).join(' · ')
  const subjectCore = summary && summary !== SEALED_LINE ? summary : asset
  const subject = ref
    ? `${asset} defect: ${subjectCore} (${ref})`
    : `${asset} defect: ${subjectCore}`
  const rows = [
    row('Asset', asset),
    row('Reference', ref),
    row('Defect', summary),
    row('Detail', note && note !== summary ? note : ''),
    row('Site', site),
    row('Region', region),
    row('Entity', entity),
    row('Where', !site && where ? where : ''),
  ].filter(Boolean)
  return packaged({
    subject,
    label: asset,
    headline: detail?.headline || `A ${asset.toLowerCase()} defect was reported.`,
    rows,
    actionLabel: 'Open equipment',
    path: detail?.path || '/equipment/approvals',
    appOrigin,
  })
}

export function renderDrillReportMail(drill, { appOrigin = '' } = {}) {
  const scenario = reveal(drill?.scenario, 120)
  const eventType = plain(drill?.eventType, 40)
  const when = [plain(drill?.date, 20), plain(drill?.time, 20)].filter(Boolean).join(' ')
  const site = plain(drill?.siteName, 80)
  const region = plain(drill?.region, 80)
  const entity = plain(drill?.entity, 80)
  const outcome = plain(drill?.outcome, 40)
  const score = plain(drill?.scoreLabel, 20)
  const ref = plain(drill?.docId, 40)
  const name = scenario && scenario !== SEALED_LINE ? scenario : eventType || 'Mock drill'
  const subject = `Mock drill report: ${name}`
  const rows = [
    row('Scenario', scenario),
    row('Type', eventType),
    row('When', when),
    row('Site', site),
    row('Region', region),
    row('Entity', entity),
    row('Outcome', outcome),
    row('Score', score),
    row('Reference', ref),
  ].filter(Boolean)
  return packaged({
    subject,
    label: 'Mock drill',
    headline: 'A mock drill report was saved.',
    rows,
    actionLabel: 'Open mock drills',
    path: '/mock-drills',
    appOrigin,
  })
}

export function renderMeetingMail(meeting, { appOrigin = '' } = {}) {
  const subjectLine = reveal(meeting?.subject, 120)
  const type = plain(meeting?.type, 80)
  const when = [plain(meeting?.date, 20), plain(meeting?.time, 20)].filter(Boolean).join(' ')
  const site = plain(meeting?.siteName, 80)
  const region = plain(meeting?.region, 80)
  const entity = plain(meeting?.entity, 80)
  const ref = plain(meeting?.docId, 40)
  const named = subjectLine && subjectLine !== SEALED_LINE ? subjectLine : ''
  const subject = named
    ? `Committee meeting: ${named}`
    : type
      ? `Committee meeting: ${type}`
      : 'Committee meeting recorded'
  const rows = [
    row('Subject', subjectLine),
    row('Type', type),
    row('When', when),
    row('Site', site || (meeting?.orgWide ? 'Organisation-wide' : '')),
    row('Region', region),
    row('Entity', entity),
    row('Reference', ref),
  ].filter(Boolean)
  return packaged({
    subject,
    label: 'Committee',
    headline: 'A committee meeting was recorded.',
    rows,
    actionLabel: 'Open committee meetings',
    path: '/committee',
    appOrigin,
  })
}

// How many area lines one digest will carry. The rest are counted, not
// copied: a region with two hundred sites is a spreadsheet, not a mail.
export const DIGEST_AREA_CAP = 40

export function renderWeatherDigest(digest, { appOrigin = '' } = {}) {
  const areas = Array.isArray(digest?.areas) ? digest.areas : []
  const shown = areas.slice(0, DIGEST_AREA_CAP)
  const hidden = areas.length - shown.length
  const high = areas.filter((a) => a.level === 'High').length
  const medium = areas.filter((a) => a.level === 'Medium').length
  const subject = `Weather risk: ${high} high, ${medium} medium`
  const rows = shown.map((area) => ({
    label: plain(area.region, 40) || 'Region',
    value: safeLine(`${area.name} — ${area.level}${area.hazards ? ` · ${area.hazards}` : ''}`, 180),
  }))
  if (hidden > 0) {
    rows.push({ label: 'More', value: `${hidden} further areas are in the app` })
  }
  if (digest?.unread) {
    rows.push({
      label: 'Unread',
      value: `${digest.unread} site${digest.unread === 1 ? '' : 's'} could not be read this run — this is not an all-clear for them`,
    })
  }
  return packaged({
    subject,
    label: 'Weather risk',
    headline: 'High and medium weather risk, by region.',
    rows,
    actionLabel: 'Open weather risk',
    path: '/weather',
    appOrigin,
  })
}

export { footerLine }
