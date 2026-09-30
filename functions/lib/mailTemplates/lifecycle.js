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

// How many rows ONE SECTION of the digest will carry (Heat Stress, Rain Risk,
// Other hazards each get this many). The rest are counted, not copied: a
// region with two hundred sites is a spreadsheet, not a mail. The cap is per
// section, not overall, so a wide heat event cannot push the rain section
// out of the mail. A section's rows are taken High first, so the cap only ever
// drops Medium rows before High ones. Rows are sites in Heat Stress and Rain
// Risk, and site-hazard pairs in Other hazards. The cap does NOT apply to the
// all-High precautions table (highAlertRows), which lists every High
// site-hazard pair.
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
    label: 'High',
  },
  Medium: {
    title: '#92400e',
    bar: '#d97706',
    wash: '#fffbeb',
    swatch: '#eab308',
    label: 'Medium',
  },
}

const LEVEL_RANK = { High: 0, Medium: 1 }
const OTHER_TITLE = 'Other hazards'
// Heat and rain, by driver key, are the two hazards with a section of their
// own (weatherBands.js). Everything else lands in Other hazards.
const HAZARD_ORDER = ['heat', 'rain']
// Site-page labels for rows written before drivers carried a key or a level.
const KEY_BY_LABEL = { 'heat stress': 'heat', rain: 'rain' }

/**
 * The hazard readings on one area, each with its own level. A driver that
 * predates per-hazard levels falls back to the site's level. An area that has
 * only the `hazards` string (older rows) is split into label-only readings.
 */
function readingsOf(area) {
  const fallback = area?.level
  let drivers = Array.isArray(area?.drivers) ? area.drivers : []
  if (!drivers.length && typeof area?.hazards === 'string') {
    drivers = area.hazards
      .split(',')
      .map((label) => ({ label: label.trim() }))
      .filter((d) => d.label)
  }
  const out = []
  for (const driver of drivers) {
    if (!driver) continue
    const label = plain(driver.label, 40)
    if (!label) continue
    const level = driver.level || fallback
    if (level !== 'High' && level !== 'Medium') continue
    const key = plain(driver.key, 20) || KEY_BY_LABEL[label.toLowerCase()] || label.toLowerCase()
    out.push({ key, label, value: plain(driver.value, 80), level })
  }
  return out
}

/**
 * Sections in mail order: Heat Stress, Rain Risk, then Other hazards. A site
 * is listed under every hazard it has, at that hazard's own level (High or
 * Medium only), so heat High + rain Medium is High under Heat Stress and
 * Medium under Rain Risk. Empty sections are left out. Inside a section:
 * regions A–Z, and within a region High before Medium, then sites A–Z. At
 * most `cap` rows per section are kept; `total` and `hidden` say what was cut.
 *
 * Shape: [{ key, title, level counts, total, hidden, groups: [{ region, rows }] }]
 * A row is { area, site, level, hazard, value } — `hazard` is the hazard's
 * label, which only the Other hazards section prints.
 */
export function groupDigestSections(areas, cap = DIGEST_AREA_CAP) {
  const list = Array.isArray(areas) ? areas : []
  const buckets = new Map()
  for (const area of list) {
    if (!area) continue
    for (const reading of readingsOf(area)) {
      const section = HAZARD_ORDER.includes(reading.key) ? reading.key : 'other'
      if (!buckets.has(section)) buckets.set(section, [])
      buckets.get(section).push({
        area,
        level: reading.level,
        hazard: reading.label,
        hazardKey: reading.key,
        value: reading.value,
        region: plain(area.region, 80) || 'Unassigned',
        name: String(area.name || ''),
      })
    }
  }
  const order = [
    { key: 'heat', title: 'Heat Stress' },
    { key: 'rain', title: 'Rain Risk' },
    { key: 'other', title: OTHER_TITLE },
  ]
  const sections = []
  for (const { key, title } of order) {
    const rows = buckets.get(key)
    if (!rows || !rows.length) continue
    const ranked = [...rows].sort(
      (a, b) =>
        LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
        a.region.localeCompare(b.region) ||
        a.name.localeCompare(b.name) ||
        a.hazard.localeCompare(b.hazard)
    )
    const kept = ranked.slice(0, Math.max(0, cap))
    const byRegion = new Map()
    for (const row of kept) {
      if (!byRegion.has(row.region)) byRegion.set(row.region, [])
      byRegion.get(row.region).push(row)
    }
    const groups = [...byRegion.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([region, regionRows]) => ({
        region,
        rows: [...regionRows].sort(
          (a, b) =>
            LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
            a.name.localeCompare(b.name) ||
            a.hazard.localeCompare(b.hazard)
        ),
      }))
    const sites = new Set(rows.map((r) => r.area))
    sections.push({
      key,
      title,
      total: rows.length,
      hidden: rows.length - kept.length,
      sites: sites.size,
      high: rows.filter((r) => r.level === 'High').length,
      medium: rows.filter((r) => r.level === 'Medium').length,
      groups,
    })
  }
  return sections
}

// Static, hazard-specific OHS precautions for the all-High table. They are
// general guidance, written once here; they do not read the forecast and are
// not tunable per org. Keyed by the driver key (weatherBands.js).
const ALERT_TYPE = {
  heat: 'Heat Stress',
  rain: 'Rain Risk',
}
const ADVERSE = 'Adverse Weather'
const PRECAUTIONS = {
  heat: 'Provide cool drinking water and enforce shade and rest breaks. Move heavy outdoor work to the cooler hours. Watch for heat-illness signs (dizziness, cramps, confusion) and act at once.',
  rain: 'Watch for slips, trips and wet electrical equipment; keep tools and cables off wet ground. Secure loose materials and check drainage. Stop work at height and hot work if conditions are unsafe.',
  wind: 'Secure scaffolding, sheeting and loose items. Stop crane, lifting and work-at-height operations. Keep people clear of overhead and edge areas.',
  visibility:
    'Slow vehicles and plant, and keep lights and high-visibility clothing on. Use spotters and marked routes. Pause lifting and reversing where the operator cannot see.',
  uv: 'Limit work in direct sun at midday. Use sunscreen, hats, long sleeves and eye protection. Provide shade and water, and rotate people on exposed tasks.',
  cold: 'Provide warm clothing, gloves and warm rest breaks. Limit time on exposed tasks and watch for numbness or shivering. Check for ice on walkways and equipment.',
  lightning:
    'Stop outdoor work and move people indoors or into a vehicle. Keep clear of tall structures, cranes, scaffolding and open ground. Resume only when the storm has passed.',
  ice: 'Grit or close icy walkways, ramps and stairs. Slow vehicles and plant. Stop work at height and lifting where surfaces are slippery.',
  snow: 'Clear and grit access routes. Take extra care with vehicles and plant. Check roofs, scaffolding and temporary structures for snow load before use.',
  other:
    'Review the task risk assessment. Stop work that cannot be done safely, and follow site emergency procedures.',
}
// Labels for rows written before drivers carried a key.
const PRECAUTION_KEY_BY_LABEL = {
  'high wind': 'wind',
  'poor visibility': 'visibility',
  'uv exposure': 'uv',
  'cold stress': 'cold',
  thunderstorm: 'lightning',
  'freezing rain': 'ice',
  snow: 'snow',
}

function precautionKey(reading) {
  if (PRECAUTIONS[reading.key] && reading.key !== 'other') return reading.key
  return PRECAUTION_KEY_BY_LABEL[String(reading.label || '').toLowerCase()] || 'other'
}

const TYPE_RANK = { 'Heat Stress': 0, 'Rain Risk': 1 }

/**
 * One row per site-hazard pair at High level: { region, name, type, precautions }.
 * `type` is Heat Stress, Rain Risk, or 'Adverse Weather – <hazard>' for every
 * other hazard. Sorted by region, then site, then heat, rain, other. Not capped.
 */
export function highAlertRows(areas) {
  const rows = []
  for (const area of Array.isArray(areas) ? areas : []) {
    if (!area) continue
    for (const reading of readingsOf(area)) {
      if (reading.level !== 'High') continue
      const key = HAZARD_ORDER.includes(reading.key) ? reading.key : precautionKey(reading)
      const type = ALERT_TYPE[key] || `${ADVERSE} – ${reading.label}`
      rows.push({
        region: plain(area.region, 80) || 'Unassigned',
        name: plain(area.name, 80) || '—',
        type,
        precautions: PRECAUTIONS[key] || PRECAUTIONS.other,
        area,
      })
    }
  }
  rows.sort(
    (a, b) =>
      a.region.localeCompare(b.region) ||
      a.name.localeCompare(b.name) ||
      (TYPE_RANK[a.type] ?? 2) - (TYPE_RANK[b.type] ?? 2) ||
      a.type.localeCompare(b.type)
  )
  return rows
}

/**
 * The distinct areas that made it into at least one section after the
 * per-section cap, or into the all-High table. The map pins these, so it
 * never marks a site the mail dropped.
 */
export function shownDigestAreas(areas, cap = DIGEST_AREA_CAP) {
  const shown = new Set()
  for (const section of groupDigestSections(areas, cap)) {
    for (const group of section.groups) for (const row of group.rows) shown.add(row.area)
  }
  // The all-High table is not capped, so a High site the sections cut is
  // still listed in the mail and is pinned.
  for (const row of highAlertRows(areas)) shown.add(row.area)
  return (Array.isArray(areas) ? areas : []).filter((area) => shown.has(area))
}

function cell(text, { size = '13px', weight = '400', color = '#123632', transform = '' } = {}) {
  const casing = transform ? `text-transform:${transform};` : ''
  return `<td valign="top" style="padding:6px 8px;font-family:${SANS};font-size:${size};line-height:1.4;font-weight:${weight};color:${color};${casing}">${escapeHtml(text || '—')}</td>`
}

function levelCell(level) {
  const style = LEVEL_STYLE[level]
  return `<td valign="top" style="padding:6px 8px;font-family:${SANS};font-size:13px;line-height:1.4;font-weight:700;color:${style.title};white-space:nowrap;"><span style="display:inline-block;width:10px;height:10px;margin-right:6px;background:${style.swatch};border-radius:2px;"></span>${style.label}</td>`
}

function countsText(section) {
  const parts = []
  if (section.high) parts.push(`${section.high} high`)
  if (section.medium) parts.push(`${section.medium} medium`)
  const noun = section.key === 'other' ? 'reading' : 'site'
  const n = section.key === 'other' ? section.total : section.sites
  return `${n} ${noun}${n === 1 ? '' : 's'}: ${parts.join(', ')}`
}

function sectionHtml(section, when) {
  const showHazard = section.key === 'other'
  const groups = section.groups
    .map((group) => {
      const headCell = { size: '11px', weight: '700', color: '#246058', transform: 'uppercase' }
      const head = `<tr>
${cell('Site', headCell)}
${cell('Entity', headCell)}
${showHazard ? cell('Hazard', headCell) + '\n' : ''}${cell('Level', headCell)}
${cell('Reading', headCell)}
${cell('When', headCell)}
</tr>`
      const body = group.rows
        .map((row) => {
          const style = LEVEL_STYLE[row.level]
          const rowWhen = plain(row.area.observedAt, 40) || when
          return `<tr style="background:${style.wash};">
${cell(plain(row.area.name, 80), { weight: '600' })}
${cell(plain(row.area.entity, 80))}
${showHazard ? cell(row.hazard) + '\n' : ''}${levelCell(row.level)}
${cell(row.value)}
${cell(rowWhen)}
</tr>`
        })
        .join('')
      return `<p style="margin:12px 0 4px;font-family:${SANS};font-size:13px;line-height:1.4;font-weight:700;color:#123632;">${escapeHtml(group.region)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-left:4px solid #246058;">${head}${body}</table>`
    })
    .join('')
  return `<h2 style="margin:18px 0 0;font-family:${SANS};font-size:16px;line-height:1.3;font-weight:700;color:#123632;">${escapeHtml(section.title)}</h2><p style="margin:2px 0 0;font-family:${SANS};font-size:12px;line-height:1.4;color:#246058;">${escapeHtml(countsText(section))}</p>${groups}`
}

function sectionText(section, when) {
  const showHazard = section.key === 'other'
  const lines = [`${section.title.toUpperCase()} (${countsText(section)})`]
  for (const group of section.groups) {
    lines.push('', group.region)
    for (const row of group.rows) {
      const rowWhen = plain(row.area.observedAt, 40) || when
      lines.push(`Site: ${plain(row.area.name, 80) || '—'}`)
      lines.push(`Entity: ${plain(row.area.entity, 80) || '—'}`)
      if (showHazard) lines.push(`Hazard: ${row.hazard}`)
      lines.push(`Level: ${row.level}`)
      lines.push(`Reading: ${row.value || '—'}`)
      lines.push(`When: ${rowWhen || '—'}`, '')
    }
    if (lines[lines.length - 1] === '') lines.pop()
  }
  return lines.join('\n')
}

const ALERT_COLUMNS = ['Region', 'Site Name', 'Type of Alert', 'Precautions']
const ALERT_NOTE =
  'One row per site and hazard at High level. Precautions are general guidance: follow your site risk assessment, permits and emergency procedures.'

function alertCounts(rows) {
  const sites = new Set(rows.map((r) => r.area)).size
  return `${rows.length} alert${rows.length === 1 ? '' : 's'} at ${sites} site${sites === 1 ? '' : 's'}`
}

function alertsHtml(rows) {
  if (!rows.length) return ''
  const headCell = { size: '11px', weight: '700', color: '#7f1d1d', transform: 'uppercase' }
  const head = `<tr style="background:${LEVEL_STYLE.High.wash};">${ALERT_COLUMNS.map((c) => cell(c, headCell)).join('')}</tr>`
  const body = rows
    .map(
      (row) => `<tr style="background:${LEVEL_STYLE.High.wash};border-top:1px solid #fecaca;">
${cell(row.region)}
${cell(row.name, { weight: '600' })}
${cell(row.type, { weight: '700', color: LEVEL_STYLE.High.title })}
${cell(row.precautions)}
</tr>`
    )
    .join('')
  return `<h2 style="margin:18px 0 0;font-family:${SANS};font-size:16px;line-height:1.3;font-weight:700;color:${LEVEL_STYLE.High.title};">High-risk sites and precautions</h2><p style="margin:2px 0 0;font-family:${SANS};font-size:12px;line-height:1.4;color:#246058;">${escapeHtml(alertCounts(rows))}. ${escapeHtml(ALERT_NOTE)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border-left:4px solid ${LEVEL_STYLE.High.bar};">${head}${body}</table>`
}

function alertsText(rows) {
  if (!rows.length) return ''
  const lines = [`HIGH-RISK SITES AND PRECAUTIONS (${alertCounts(rows)})`, ALERT_NOTE]
  for (const row of rows) {
    lines.push(
      '',
      `Region: ${row.region}`,
      `Site Name: ${row.name}`,
      `Type of Alert: ${row.type}`,
      `Precautions: ${row.precautions}`
    )
  }
  return lines.join('\n')
}

function mapBlock(cid) {
  if (!cid) return { html: '', text: '' }
  const src = escapeHtml(`cid:${cid}`)
  return {
    html: `<p style="margin:16px 0 8px;"><img src="${src}" width="560" alt="Sites at high risk, marked with red pins, and medium risk, marked with yellow pins. A site is pinned once, at its worst level." style="display:block;width:100%;max-width:560px;height:auto;border:1px solid #d0e8e4;border-radius:8px;" /></p>
<p style="margin:0 0 4px;font-family:${SANS};font-size:12px;line-height:1.45;color:#246058;">Red pin: high risk. Yellow pin: medium risk. Map data © OpenStreetMap contributors.</p>`,
    text: 'Map: red pins are high risk, yellow pins are medium risk. Map data © OpenStreetMap contributors.',
  }
}

export function renderWeatherDigest(
  digest,
  { appOrigin = '', sender = '', mapCid = '', windowLabel = '' } = {}
) {
  const areas = Array.isArray(digest?.areas) ? digest.areas : []
  // Subject and summary count SITES, each once, at its worst level. A site
  // that is High for heat and Medium for rain is one High site here, even
  // though it is listed under both sections below.
  const high = areas.filter((a) => a.level === 'High').length
  const medium = areas.filter((a) => a.level === 'Medium').length
  const subject = `Weather risk: ${high} high, ${medium} medium`
  const when = plain(windowLabel, 40)
  const sections = groupDigestSections(areas)
  const alerts = highAlertRows(areas)
  const hidden = sections.filter((section) => section.hidden > 0)
  const map = mapBlock(safeCid(mapCid))
  // The bucket is the run's window. A site's When cell is the provider's
  // clock for that reading when one was sent. Printing the window only as a
  // fallback hid it on every row that had a reading.
  const windowLine = plain(windowLabel, 48)
  const windowHtml = windowLine
    ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:#123632;">Window: ${escapeHtml(windowLine)}</p>`
    : ''
  const windowText = windowLine ? `Window: ${windowLine}` : ''
  // The sentence is the coverage, not a label plus a number. Callers that
  // only render tables (the template test) omit located and get no line.
  const coverageLine =
    Number.isFinite(digest?.located) && digest.located > 0
      ? `Weather checked for ${Number(digest.checked) || 0} of ${digest.located} sites`
      : ''
  const coverageHtml = coverageLine
    ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:#123632;">${escapeHtml(coverageLine)}</p>`
    : ''
  const summaryLine = areas.length
    ? `${high + medium} site${high + medium === 1 ? '' : 's'} at risk: ${high} high, ${medium} medium. A site with more than one hazard is listed under each, and counted once here at its worst level.`
    : ''
  const summaryHtml = summaryLine
    ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:#123632;">${escapeHtml(summaryLine)}</p>`
    : ''
  const bannerHtml = `${map.html}${windowHtml}${coverageHtml}${summaryHtml}${alertsHtml(alerts)}${sections.map((s) => sectionHtml(s, when)).join('')}`
  const bannerText = [
    map.text,
    windowText,
    coverageLine,
    summaryLine,
    alertsText(alerts),
    ...sections.map((s) => sectionText(s, when)),
  ]
    .filter(Boolean)
    .join('\n\n')
  const rows = []
  if (hidden.length) {
    const parts = hidden.map((section) => {
      const noun = section.key === 'other' ? 'reading' : 'site'
      return `${section.title}: ${section.hidden} further ${noun}${section.hidden === 1 ? '' : 's'}`
    })
    rows.push({ label: 'More', value: `${parts.join('; ')} — in the app` })
  }
  const unreadNames = Array.isArray(digest?.unreadSites)
    ? digest.unreadSites.map((name) => plain(name, 80)).filter(Boolean)
    : []
  if (unreadNames.length) {
    const shown = unreadNames.slice(0, 80)
    const more = unreadNames.length - shown.length
    const list = `${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`
    rows.push({
      label: 'Unread',
      value: `Could not fetch weather for ${unreadNames.length} site${unreadNames.length === 1 ? '' : 's'}: ${list}. This is not an all-clear for them`,
    })
  } else if (digest?.unread) {
    rows.push({
      label: 'Unread',
      value: `${digest.unread} site${digest.unread === 1 ? '' : 's'} could not be read this run — this is not an all-clear for them`,
    })
  }
  if (digest?.unlocated) {
    const n = digest.unlocated
    rows.push({
      label: 'No coordinates',
      value: `${n} site${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} no usable coordinates and ${n === 1 ? 'was' : 'were'} not checked`,
    })
  }
  return packaged({
    subject,
    label: 'Weather risk',
    headline: 'High and medium weather risk, by hazard and region.',
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
