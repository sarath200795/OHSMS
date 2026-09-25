// Branded bodies for permit, defect, drill, meeting and weather-digest mail.
//
// The chrome is renderLayout. This file only decides which lines are safe to
// hand it. A sealed envelope (enc:1: / enk:1:) is never a line: readableText
// drops it, and a field that was clearly sealed is replaced with a fixed
// sentence so the mail still says the record exists.
import { safeOrigin } from '../mailer.js'
import { safeCid } from '../mailAttachments.js'
import { renderLayout, footerLine } from './layout.js'
import {
  classifyMailText,
  readableText,
  safeLine,
  safeMailPath,
  escapeHtml,
  SEALED_STAND_IN,
} from './safe.js'

export const SEALED_LINE = SEALED_STAND_IN

function reveal(value, max = 180) {
  const found = classifyMailText(value)
  if (found.kind === 'text') return safeLine(found.text, max)
  if (found.kind === 'sealed') return SEALED_LINE
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
  const { text, html, senderName } = renderLayout({
    subject,
    label: message.label,
    headline: message.headline,
    rows,
    actionLabel: message.actionLabel,
    url,
    path,
    sender: message.sender,
    bannerHtml: message.bannerHtml,
    bannerText: message.bannerText,
  })
  return { subject, text, html, senderName }
}

function row(label, value) {
  return value ? { label, value } : null
}

export function renderPermitMail(permit, event, { appOrigin = '', sender = '' } = {}) {
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
    sender,
  })
}

const ASSET_LABEL = {
  extinguisher: 'Fire extinguisher',
  aed: 'AED',
  fas: 'Fire alarm',
}

export function renderDefectMail(detail, { appOrigin = '', sender = '' } = {}) {
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
    sender,
  })
}

export function renderDrillReportMail(drill, { appOrigin = '', sender = '' } = {}) {
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
    sender,
  })
}

export function renderMeetingMail(meeting, { appOrigin = '', sender = '' } = {}) {
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
    sender,
  })
}

// How many area lines one digest will carry. The rest are counted, not
// copied: a region with two hundred sites is a spreadsheet, not a mail.
export const DIGEST_AREA_CAP = 40

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

// High is red-800 on white (~7:1). Medium is amber-800 on white, with a
// yellow swatch beside it: the swatch is the pin colour, and pale yellow as
// the heading would fail as text.
const LEVEL_STYLE = {
  High: {
    title: '#991b1b',
    bar: '#dc2626',
    wash: '#fef2f2',
    swatch: '#dc2626',
    label: 'High risk',
  },
  Medium: {
    title: '#92400e',
    bar: '#d97706',
    wash: '#fffbeb',
    swatch: '#eab308',
    label: 'Medium risk',
  },
}

/**
 * High, then medium. Inside a level, regions A–Z, then sites A–Z.
 * Anything that is not High or Medium is left out — a Low row is not a
 * digest row, and an empty level is not a heading.
 */
export function groupDigestAreas(areas) {
  const list = Array.isArray(areas) ? areas : []
  const sections = []
  for (const level of ['High', 'Medium']) {
    const rows = list.filter((area) => area && area.level === level)
    const byRegion = new Map()
    for (const row of rows) {
      const region = plain(row.region, 80) || 'Unassigned'
      if (!byRegion.has(region)) byRegion.set(region, [])
      byRegion.get(region).push(row)
    }
    const groups = [...byRegion.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([region, sites]) => ({
        region,
        sites: [...sites].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      }))
    if (groups.length) sections.push({ level, groups })
  }
  return sections
}

function driverText(area) {
  const drivers = Array.isArray(area?.drivers) ? area.drivers : []
  if (drivers.length) {
    return drivers
      .map((driver) => {
        const label = plain(driver?.label, 40)
        const value = plain(driver?.value, 80)
        if (!label) return ''
        return value ? `${label} · ${value}` : label
      })
      .filter(Boolean)
      .join('; ')
  }
  return plain(area?.hazards, 180)
}

function cell(text, { size = '13px', weight = '400', color = '#123632', transform = '' } = {}) {
  const casing = transform ? `text-transform:${transform};` : ''
  return `<td valign="top" style="padding:6px 8px;font-family:${SANS};font-size:${size};line-height:1.4;font-weight:${weight};color:${color};${casing}">${escapeHtml(text || '—')}</td>`
}

function sectionHtml(section) {
  const style = LEVEL_STYLE[section.level]
  const groups = section.groups
    .map((group) => {
      const headCell = { size: '11px', weight: '700', color: '#246058', transform: 'uppercase' }
      const head = `<tr>
${cell('Site', headCell)}
${cell('Entity', headCell)}
${cell('Drivers', headCell)}
${cell('When', headCell)}
</tr>`
      const body = group.sites
        .map((site) => {
          const when = plain(site.observedAt, 40) || plain(site.windowLabel, 40)
          return `<tr>
${cell(plain(site.name, 80), { weight: '600' })}
${cell(plain(site.entity, 80))}
${cell(driverText(site))}
${cell(when)}
</tr>`
        })
        .join('')
      return `<p style="margin:12px 0 4px;font-family:${SANS};font-size:13px;line-height:1.4;font-weight:700;color:#123632;">${escapeHtml(group.region)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-left:4px solid ${style.bar};background:${style.wash};">${head}${body}</table>`
    })
    .join('')
  return `<h2 style="margin:18px 0 0;font-family:${SANS};font-size:16px;line-height:1.3;font-weight:700;color:${style.title};"><span style="display:inline-block;width:10px;height:10px;margin-right:6px;background:${style.swatch};border-radius:2px;vertical-align:baseline;"></span>${escapeHtml(style.label)}</h2>${groups}`
}

function sectionText(section) {
  const style = LEVEL_STYLE[section.level]
  const lines = [style.label]
  for (const group of section.groups) {
    lines.push(group.region)
    for (const site of group.sites) {
      lines.push(`Site: ${plain(site.name, 80) || '—'}`)
      lines.push(`Entity: ${plain(site.entity, 80) || '—'}`)
      lines.push(`Drivers: ${driverText(site) || '—'}`)
      const when = plain(site.observedAt, 40) || plain(site.windowLabel, 40)
      lines.push(`When: ${when || '—'}`)
    }
  }
  return lines.join('\n')
}

function mapBlock(cid) {
  if (!cid) return { html: '', text: '' }
  const src = escapeHtml(`cid:${cid}`)
  return {
    html: `<p style="margin:16px 0 8px;"><img src="${src}" width="560" alt="Sites at high risk, marked with red pins, and medium risk, marked with yellow pins" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid #d0e8e4;border-radius:8px;" /></p>
<p style="margin:0 0 4px;font-family:${SANS};font-size:12px;line-height:1.45;color:#246058;">Red pin: high risk. Yellow pin: medium risk. Map data © OpenStreetMap contributors.</p>`,
    text: 'Map: red pins are high risk, yellow pins are medium risk. Map data © OpenStreetMap contributors.',
  }
}

export function renderWeatherDigest(
  digest,
  { appOrigin = '', sender = '', mapCid = '', windowLabel = '' } = {}
) {
  const areas = Array.isArray(digest?.areas) ? digest.areas : []
  const shown = areas.slice(0, DIGEST_AREA_CAP).map((area) => ({
    ...area,
    windowLabel: plain(windowLabel, 40),
  }))
  const hidden = areas.length - shown.length
  const high = areas.filter((a) => a.level === 'High').length
  const medium = areas.filter((a) => a.level === 'Medium').length
  const subject = `Weather risk: ${high} high, ${medium} medium`
  const sections = groupDigestAreas(shown)
  const map = mapBlock(safeCid(mapCid))
  // The bucket is the run's window. A site's When cell is the provider's
  // clock for that reading when one was sent. Printing the window only as a
  // fallback hid it on every row that had a reading.
  const windowLine = plain(windowLabel, 48)
  const windowHtml = windowLine
    ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:#123632;">Window: ${escapeHtml(windowLine)}</p>`
    : ''
  const windowText = windowLine ? `Window: ${windowLine}` : ''
  const bannerHtml = `${map.html}${windowHtml}${sections.map(sectionHtml).join('')}`
  const bannerText = [map.text, windowText, ...sections.map(sectionText)]
    .filter(Boolean)
    .join('\n\n')
  const rows = []
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
    bannerHtml,
    bannerText,
    actionLabel: 'Open weather risk',
    path: '/weather',
    appOrigin,
    sender,
  })
}

export { footerLine }
