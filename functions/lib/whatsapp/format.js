// ─────────────────────────────────────────────────────────────────────────────
// Reply text. One message per answer: every delivered message counts against
// the monthly free tier and then costs money, so there are no "typing…" fillers
// and no split replies.
//
// WhatsApp caps a text body at 4096 characters. The counts block is small and
// fixed; the contact list is the only part that grows, so contacts are added
// until the budget runs out and the rest are summarised as "+N more in the app"
// rather than letting the send fail or cutting a phone number in half.
//
// Nothing here prints a free-text field from an incident, a permit or an
// action — counts only. Contact names and numbers come from erpContacts,
// which is the emergency directory and is shown only to linked, approved users
// who reach the site. The site summary does not include the last audit:
// asking Metabase held the only message until the warehouse gave up. The
// audit is a second message, and only after the caller says yes, formatted
// from the cache the schedule already stored.
// ─────────────────────────────────────────────────────────────────────────────
import { readableText } from '../mailTemplates/safe.js'
import { MAX_CHOICES } from './resolve.js'

export const MAX_BODY = 4096
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72
const OPEN_POINT_LINES = 10
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Mirrors ERP_ROLES labels in src/shared/org/erpRoles.js; an org's own labels
// (organizations/{orgId}.erpRoleLabels) win.
const DEFAULT_ROLE_LABELS = {
  CM: 'Site Head',
  CLM: 'Operations Lead',
  'Safety L1': 'Safety Officer',
  'Safety L2': 'Safety Manager',
  Security: 'Security Lead',
  'First Aider': 'First Aider',
  HR: 'HR Lead',
  Legal: 'Legal Lead',
  Other: 'Other',
}

/**
 * One line of user-supplied text, safe to put in a WhatsApp body: sealed values
 * dropped, control characters and newlines flattened, WhatsApp's formatting
 * markers removed so a site called "*_Test_*" cannot restyle the message.
 */
export function clean(value, max = 80) {
  const text = readableText(value)
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  )
}

const phoneText = (value) =>
  clean(value, 24)
    .replace(/[^0-9+()\- ]/g, '')
    .trim()

export function roleLabel(key, labels = {}) {
  const k = clean(key, 40)
  const own = typeof labels?.[k] === 'string' ? clean(labels[k], 40) : ''
  return own || DEFAULT_ROLE_LABELS[k] || k || 'Contact'
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * "25 Oct 2026, 9:24 AM" in Asia/Kolkata.
 *
 * The audit reply prints this and then " IST". Hour is 12-hour without a
 * leading zero; the day is two digits. The offset is fixed: India does not
 * observe daylight saving, and the plant clock is this zone.
 */
export function extractedStamp(date) {
  if (date == null || date === '') return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + 330 * 60 * 1000)
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  const mon = MONTHS[shifted.getUTCMonth()]
  const year = shifted.getUTCFullYear()
  let hour = shifted.getUTCHours()
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour %= 12
  if (hour === 0) hour = 12
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${day} ${mon} ${year}, ${hour}:${mm} ${ampm}`
}

/** "12 Oct, 07:30 IST" */
export function istStamp(date) {
  const d = new Date(date.getTime() + 330 * 60 * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} IST`
}

/** "2 Mar 2026" from a warehouse 'YYYY-MM-DD', or '' when it is not one. */
export function formatAuditDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return ''
  return `${Number(m[3])} ${month} ${m[1]}`
}

function formatScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}%`
}

/** Asked after a single-centre summary. The buttons carry the same words. */
export const DETAIL_QUESTION = 'Do you need any additional details? (Yes/No)'

export const DETAIL_BUTTONS = [
  { id: 'audit:yes', title: 'Yes' },
  { id: 'audit:no', title: 'No' },
]

export const CONTACT_ADMIN = 'Contact the admin'

export const DETAIL_DECLINED = 'Okay.'

export const DETAIL_EXPIRED = 'That question has expired. Send the Centre ID or Centre Name again.'

/**
 * The Yes reply, from a cache document, or '' when there is nothing to show.
 * The caller sends CONTACT_ADMIN for ''.
 *
 * The last line is always the extract time. A cache row with no syncedAt,
 * or a `none` row, is not an audit and must not grow a score.
 */
export function formatCachedAudit(record) {
  if (!record || record.none || typeof record.date !== 'string' || !record.date) return ''
  const when = extractedStamp(record.syncedAt)
  if (!when) return ''
  const lines = auditLines({
    ok: true,
    date: record.date,
    scoreOnDay: record.scoreOnDay,
    scoreAfter7: record.scoreAfter7,
    findingsKnown: record.findingsKnown === true,
    openPoints: record.openPoints,
    openTotal: record.openTotal,
    openMore: record.openMore,
  })
  if (!lines.length) return ''
  lines.push(`Data last extracted: ${when} IST`)
  return lines.join('\n')
}

/**
 * The last-audit block, or a one-line note when there is nothing to show.
 *
 * The site summary does not send this. `formatCachedAudit` does, for a
 * document the schedule already wrote, and it does not use the "none" or
 * "unavailable" lines — a Yes with nothing stored says CONTACT_ADMIN.
 */
export function auditLines(audit) {
  if (!audit) return []
  if (!audit.ok) {
    if (audit.reason === 'none') {
      const days = Number(audit.windowDays)
      return [
        Number.isFinite(days) && days > 0
          ? `📋 No audit score in the last ${days} days.`
          : '📋 No recent audit for this centre.',
      ]
    }
    return ['📋 Audit score unavailable.']
  }
  const when = formatAuditDay(audit.date)
  const onDay = formatScore(audit.scoreOnDay)
  const after = formatScore(audit.scoreAfter7)
  // Both readings, every time. N+7 is pending until the seven-day re-score
  // exists, including when it will equal the day-0 score — dropping it
  // because the two match is how a reader cannot tell "not yet" from "same".
  const n7 = after ? `N+7 score ${after}` : 'N+7 score: pending'
  const score = onDay ? `Score ${onDay} · ${n7}` : n7
  // Date and score are peers on one line. Joining the whole head on " · "
  // would leave a dangling separator when the warehouse date does not parse.
  const detail = [when, score].filter(Boolean).join(' · ')
  const head = detail ? `📋 Last audit: ${detail}` : '📋 Last audit'
  const lines = [head]
  if (!audit.findingsKnown) {
    lines.push('Open points unavailable.')
    return lines
  }
  const total = Number(audit.openTotal) || 0
  if (!total) {
    lines.push('Open points: none')
    return lines
  }
  lines.push(`Open points (${total}):`)
  const points = (Array.isArray(audit.openPoints) ? audit.openPoints : []).slice(
    0,
    OPEN_POINT_LINES
  )
  points.forEach((point, i) => {
    lines.push(`${i + 1}. ${clean(point, 80) || 'Observation'}`)
  })
  const hidden = Math.max(0, (audit.openPoints || []).length - points.length)
  const more = (Number(audit.openMore) || 0) + hidden
  if (more > 0) lines.push(`+${more} more`)
  return lines
}

export function siteTitle(site) {
  const name = clean(site?.name, 80) || 'Site'
  const code = clean(site?.code, 24)
  return code ? `${name} (${code})` : name
}

/**
 * One contact line. External services are listed even when the map published
 * no phone: the nearest hospital is still the one to go to, and dropping the
 * row is how a blank number used to make the lookup look like there was no
 * hospital. The phone stays at the end of the line so a truncated body never
 * cuts a number in half. Distance is the straight-line kilometres stored on
 * the contact. Internal escalation contacts still need a number to be worth
 * sending.
 *
 * These rows are read live from erpContacts when a WhatsApp or Telegram lookup
 * is answered. buildWhatsAppSnapshots stores equipment and incident counts
 * only, so a corrected contact is what the next reply says — the snapshot
 * schedule does not have to catch up.
 */
function contactLine(c, labels) {
  const phone = phoneText(c.phone)
  const external = c.kind !== 'internal'
  if (!phone && !external) return ''
  const role = roleLabel(c.role, labels)
  const name = clean(c.name, 48)
  const extra = []
  const km = Number(c.distanceKm)
  if (c.distanceKm != null && c.distanceKm !== '' && Number.isFinite(km)) extra.push(`~${km} km`)
  const addr = clean(c.address, 60)
  if (addr) extra.push(addr)
  const head = `• ${role}${name ? `: ${name}` : ''}`
  const mid = extra.length ? ` · ${extra.join(' · ')}` : ''
  const tail = phone ? ` — ${phone}` : ' — no number published'
  return `${head}${mid}${tail}`
}

/**
 * Contacts for a site as the emergency module shows them: the site's own plus
 * org-wide ones (no siteId). External services first — they are what someone
 * reaches for in an emergency — then internal roles.
 */
export function contactLines(contacts = [], site, labels = {}) {
  const mine = (contacts || []).filter((c) => c && (!c.siteId || c.siteId === site?.id))
  const rank = (c) => (c.kind === 'internal' ? 1 : 0)
  return mine
    .map((c) => ({ c, line: contactLine(c, labels) }))
    .filter((x) => x.line)
    .sort(
      (a, b) =>
        rank(a.c) - rank(b.c) ||
        roleLabel(a.c.role, labels).localeCompare(roleLabel(b.c.role, labels))
    )
    .map((x) => x.line)
}

/**
 * The single reply for one site.
 *
 * @param site      { id, name, code, region, entity }
 * @param counts    summariseSites()[site.id]
 * @param opts      { contacts, helplinePrimary, helplineSecondary, roleLabels,
 *                    modules, asOf: Date, appOrigin }
 */
/** 'AED: Available (N)' or 'AED: Not available', from the site's AED register. */
export function aedLine(counts = {}) {
  const total = Number(counts.aeds) || 0
  const oos = Math.min(total, Number(counts.aedsOutOfService) || 0)
  const ready = total - oos
  if (!ready) return oos ? `❤️ AED: Not available (${oos} out of service)` : '❤️ AED: Not available'
  return `❤️ AED: Available (${ready})${oos ? ` · ${oos} out of service` : ''}`
}

const DEFECT_SECTIONS = [
  ['extinguisher', 'Fire Extinguishers'],
  ['fas', 'Fire Alarm System (FAS)'],
  ['aed', 'AED'],
]

/** Open defects, per equipment type, each item "unit · location — defect". */
export function defectLines(counts = {}) {
  const k = counts.defectsByKind || {}
  const items = counts.defectItems || {}
  const out = [`⚠️ Open defects: ${Number(counts.openDefects) || 0}`]
  for (const [kind, title] of DEFECT_SECTIONS) {
    const total = Number(k[kind]) || 0
    if (!total) {
      out.push(`${title}: No open defects`)
      continue
    }
    out.push(`${title} (${total}):`)
    const shown = (items[kind] || []).slice(0, 5)
    for (const i of shown) {
      const unit = [clean(i.label, 30), clean(i.where, 40)].filter(Boolean).join(' · ') || 'Unit'
      out.push(`  • ${unit} — ${clean(i.defect, 50) || 'Defect'}`)
    }
    if (total > shown.length) out.push(`  +${total - shown.length} more in the app`)
  }
  return out
}

export function formatSiteReply(site, counts = {}, opts = {}) {
  const on = (key) => (opts.modules || {})[key] !== false
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const head = [`🏢 *${siteTitle(site)}*`]
  const where = [clean(site?.region, 40), clean(site?.entity, 40)].filter(Boolean).join(' · ')
  if (where) head.push(where)
  head.push('')

  if (on('equipment')) {
    head.push(
      `🧯 Fire extinguishers: ${n(counts.extinguishers)} (${n(counts.hptOverdue)} HPT overdue)`
    )
    head.push(aedLine(counts))
    head.push(...defectLines(counts))
  }
  head.push(`🩹 First aid boxes: ${n(counts.firstAidBoxes)}`)
  if (on('actions')) {
    const pending = n(counts.pendingActions)
    head.push(
      pending
        ? `📋 Pending actions: ${pending} (${n(counts.overdueActions)} overdue)`
        : '📋 Pending actions: none'
    )
  }
  if (on('incidents')) {
    head.push(
      `🚑 Incidents: ${n(counts.incidentsTotal)} total · ${n(counts.incidentsOpen)} open · ${n(counts.incidents90d)} in last 90 days`
    )
  }

  const tail = ['']
  const helplines = [phoneText(opts.helplinePrimary), phoneText(opts.helplineSecondary)].filter(
    Boolean
  )
  if (helplines.length) tail.push(`☎️ Safety helpline: ${helplines.join(' / ')}`)
  tail.push('🚨 National emergency: 112')
  tail.push('')
  if (opts.asOf instanceof Date) tail.push(`Updated ${istStamp(opts.asOf)}`)
  tail.push('Reply with another Centre ID or Centre Name.')

  const lines = on('emergency') ? contactLines(opts.contacts, site, opts.roleLabels) : []
  const fixed =
    [...head, '', '📞 *Emergency contacts*'].join('\n').length + tail.join('\n').length + 2
  const body = []
  let used = fixed
  let dropped = 0
  for (let i = 0; i < lines.length; i += 1) {
    // Reserve room for the "+N more" line whenever something might follow.
    const reserve = i < lines.length - 1 ? 40 : 0
    if (used + lines[i].length + 1 + reserve > MAX_BODY) {
      dropped = lines.length - i
      break
    }
    body.push(lines[i])
    used += lines[i].length + 1
  }
  if (dropped) body.push(`+${dropped} more in the app`)

  const contactBlock = on('emergency')
    ? ['', '📞 *Emergency contacts*', ...(body.length ? body : ['No site contacts recorded.'])]
    : []
  const text = [...head, ...contactBlock, ...tail].join('\n')
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text
}

const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/**
 * A pick-list: an interactive list message (≤8 rows, title ≤24, description
 * ≤72) plus the same choices NUMBERED in the text, so a client that cannot
 * render lists — or a user who would rather type — replies "2" or the code.
 * `extra` per site is a short suffix (e.g. a distance) shown in both.
 */
export function formatPickList(sites = [], intro, extra = () => '', labels = {}) {
  const shown = sites.slice(0, MAX_CHOICES)
  const lines = shown.map((s, i) => {
    const e = extra(s)
    return `${i + 1}. ${siteTitle(s)}${e ? ` — ${e}` : ''}`
  })
  const text = cut(
    [intro, '', ...lines, '', 'Tap a centre below, or reply with its number.'].join('\n'),
    1024
  )
  const rows = shown.map((s, i) => {
    const code = clean(s.code, 12)
    const name = clean(s.name, 60) || 'Site'
    const e = extra(s)
    const where = [clean(s.region, 40), clean(s.entity, 40)].filter(Boolean).join(' · ')
    const line = lines[i]
    return {
      id: `site:${s.id}`,
      title: cut(code ? `${code} · ${name}` : name, ROW_TITLE_MAX),
      description: cut([e, where].filter(Boolean).join(' · ') || name, ROW_DESC_MAX),
      // Telegram inline buttons use label. WhatsApp's list uses title and
      // description; the same extra field is already sent on organisation rows.
      label: cut(line, 64),
    }
  })
  return {
    text,
    rows,
    list: rows.length
      ? {
          button: labels.button || 'Choose centre',
          section: labels.section || 'Centres',
        }
      : undefined,
  }
}

/** Several names match. */
export function formatChoices(sites = [], query = '') {
  return formatPickList(sites, `Several centres match "${clean(query, 40)}":`)
}

/** Sites near a shared location; `near` is geo.js nearestSites().sites. */
export function formatNearby(near = [], within = true, kmLabel = (km) => `${km} km`) {
  const km = new Map(near.map((x) => [x.site.id, x.km]))
  const intro = within
    ? 'Your nearest sites:'
    : 'None of your sites is within 25 km. The nearest are:'
  return formatPickList(
    near.map((x) => x.site),
    intro,
    (s) => kmLabel(km.get(s.id))
  )
}

/** The site-step prompt. Both channels use this sentence verbatim. */
export const CENTRE_PROMPT = 'Please enter the Centre ID or Centre Name.'

/** Body of the location request (interactive or plain). */
export function locationRequestText(query) {
  const q = clean(query, 40)
  const head = q ? `Centre not found for "${q}". ` : ''
  return (
    `${head}Share your current location and I'll list your nearest sites.\n\n` +
    `Tap 📎 → Location → Send your current location. Or ${CENTRE_PROMPT}`
  )
}

export const MESSAGES = {
  help:
    `${CENTRE_PROMPT} The reply is that centre's safety summary: ` +
    'extinguishers, open defects, first aid boxes, pending actions, incidents and emergency contacts.\n\n' +
    'Send MENU to start over, or CHANGE ORG to switch organisation. Send UNLINK to disconnect this number.',
  unlinked:
    'This number is not linked to a WeEHS account, so I cannot look up a site. ' +
    'Link WhatsApp from Settings → Security in the app, or ask an administrator to add ' +
    'this number under Org Settings → Connect with WhatsApp.\n\nIn an emergency call 112.',
  noAccess: "You don't have access to that site. Ask your admin if you need it.",
  noSites: "Your account doesn't have access to any sites yet. Ask your admin for access.",
  slowDown: "You've sent a lot of lookups. Please wait a while and try again.",
  linkFailed:
    "That code didn't work. Codes are single-use and expire after 10 minutes — generate a new one in the app.",
  linkBlocked: 'Too many wrong codes. Linking from this number is paused for 24 hours.',
  badLink: 'Send LINK followed by the 6-digit code shown in the app, e.g. LINK 123456.',
  unlinkedOk:
    'Unlinked. This number will no longer receive site details. You can link again from the app at any time.',
  orgOff:
    'WhatsApp site lookup is switched off for your organisation. An administrator can turn it on in Org Settings.\n\n' +
    'Send UNLINK to disconnect this number.\n\nIn an emergency call 112.',
  error: 'Sorry, something went wrong looking that up. Please try again in a few minutes.',
  noLocatedSites:
    "None of your sites has a location recorded, so I can't find the nearest. " + CENTRE_PROMPT,
  badLocation: `I couldn't read that location. Please try again. ${CENTRE_PROMPT}`,
  pickExpired: `That list has expired. ${CENTRE_PROMPT}`,
}

export function noMatch(query) {
  const q = clean(query, 40)
  return q ? `Centre not found for "${q}".` : 'Centre not found.'
}

/** A miss, plus the closest reachable names when any are actually close. */
export function formatNotFound(query, suggestions = []) {
  const head = noMatch(query)
  if (!suggestions.length) return { text: `${head}\n\n${CENTRE_PROMPT}`, rows: [] }
  return formatPickList(suggestions, `${head}\n\nClosest names:`)
}

export function tooMany(count) {
  return `${count} centres match. Please enter the Centre ID, or more of the Centre Name.`
}

export function helpText(sites = []) {
  if (!sites.length) return MESSAGES.noSites
  if (sites.length <= 5) {
    return `${MESSAGES.help}\n\nYour sites:\n${sites.map((s) => `• ${siteTitle(s)}`).join('\n')}`
  }
  return `${MESSAGES.help}\n\nYou can look up ${plural(sites.length, 'site')}.`
}
