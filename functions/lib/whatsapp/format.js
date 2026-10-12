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
// action — counts only. Contact names and numbers come from erpContacts, which
// is the emergency directory and is shown only to linked, approved users who
// reach the site.
// ─────────────────────────────────────────────────────────────────────────────
import { readableText } from '../mailTemplates/safe.js'

export const MAX_BODY = 4096
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72

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

/** "12 Oct, 07:30 IST" */
export function istStamp(date) {
  const d = new Date(date.getTime() + 330 * 60 * 1000)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hh}:${mm} IST`
}

export function siteTitle(site) {
  const name = clean(site?.name, 80) || 'Site'
  const code = clean(site?.code, 24)
  return code ? `${name} (${code})` : name
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
    .map((c) => ({ c, phone: phoneText(c.phone) }))
    .filter((x) => x.phone)
    .sort(
      (a, b) =>
        rank(a.c) - rank(b.c) ||
        roleLabel(a.c.role, labels).localeCompare(roleLabel(b.c.role, labels))
    )
    .map(({ c, phone }) => {
      const role = roleLabel(c.role, labels)
      const name = clean(c.name, 48)
      return `• ${role}${name ? `: ${name}` : ''} — ${phone}`
    })
}

/**
 * The single reply for one site.
 *
 * @param site      { id, name, code, region, entity }
 * @param counts    summariseSites()[site.id]
 * @param opts      { contacts, helplinePrimary, helplineSecondary, roleLabels,
 *                    modules, asOf: Date, appOrigin }
 */
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
    const k = counts.defectsByKind || {}
    const parts = [
      n(k.extinguisher) && `${n(k.extinguisher)} extinguisher`,
      n(k.aed) && `${n(k.aed)} AED`,
      n(k.fas) && `${n(k.fas)} fire alarm`,
    ].filter(Boolean)
    head.push(
      `⚠️ Open defects: ${n(counts.openDefects)}${parts.length ? ` (${parts.join(', ')})` : ''}`
    )
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
  tail.push('Reply with another site code or name.')

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
 * A pick-list: an interactive list message (≤10 rows, title ≤24, description
 * ≤72) plus the same choices NUMBERED in the text, so a client that cannot
 * render lists — or a user who would rather type — replies "2" or the code.
 * `extra` per site is a short suffix (e.g. a distance) shown in both.
 */
export function formatPickList(sites = [], intro, extra = () => '') {
  const shown = sites.slice(0, 10)
  const lines = shown.map((s, i) => {
    const e = extra(s)
    return `${i + 1}. ${siteTitle(s)}${e ? ` — ${e}` : ''}`
  })
  const text = cut(
    [intro, '', ...lines, '', 'Tap a site below, or reply with its number or code.'].join('\n'),
    1024
  )
  const rows = shown.map((s) => {
    const code = clean(s.code, 12)
    const name = clean(s.name, 60) || 'Site'
    const e = extra(s)
    const where = [clean(s.region, 40), clean(s.entity, 40)].filter(Boolean).join(' · ')
    return {
      id: `site:${s.id}`,
      title: cut(code ? `${code} · ${name}` : name, ROW_TITLE_MAX),
      description: cut([e, where].filter(Boolean).join(' · ') || name, ROW_DESC_MAX),
    }
  })
  return { text, rows }
}

/** Several names match. */
export function formatChoices(sites = [], query = '') {
  return formatPickList(sites, `Several sites match "${clean(query, 40)}":`)
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

/** Body of the location request (interactive or plain). */
export function locationRequestText(query) {
  const head = query ? `No site you can access matches "${clean(query, 40)}". ` : ''
  return (
    `${head}Share your current location and I'll list your nearest sites.\n\n` +
    'Tap 📎 → Location → Send your current location. Or reply with a site code.'
  )
}

export const MESSAGES = {
  help:
    'Send a site code (e.g. BLR0123) or part of a site name to get its safety summary: ' +
    'extinguishers, open defects, first aid boxes, pending actions, incidents and emergency contacts.\n\n' +
    'Send UNLINK to disconnect this number.',
  unlinked:
    'This number serves registered WeEHS users. To use it, link your WhatsApp from ' +
    'Settings → Security in the app.\n\nIn an emergency call 112.',
  noAccess: "You don't have access to that site. Ask your admin if you need it.",
  noSites: "Your account doesn't have access to any sites yet. Ask your admin for access.",
  slowDown: "You've sent a lot of lookups. Please wait a while and try again.",
  linked:
    'Linked ✅ This number can now look up your sites. Send a site code or name to start. Send UNLINK to disconnect.',
  linkFailed:
    "That code didn't work. Codes are single-use and expire after 10 minutes — generate a new one in the app.",
  linkBlocked: 'Too many wrong codes. Linking from this number is paused for 24 hours.',
  badLink: 'Send LINK followed by the 6-digit code shown in the app, e.g. LINK 123456.',
  unlinkedOk:
    'Unlinked. This number will no longer receive site details. You can link again from the app at any time.',
  error: 'Sorry, something went wrong looking that up. Please try again in a few minutes.',
  noLocatedSites:
    "None of your sites has a location recorded, so I can't find the nearest. Please send the site code or name.",
  badLocation: "I couldn't read that location. Please try again, or send the site code.",
  pickExpired: 'That list has expired. Send the site code or name again.',
}

export function noMatch(query) {
  return `No site you can access matches "${clean(query, 40)}". Try the site code, or send HELP.`
}

export function tooMany(count) {
  return `${count} of your sites match. Please send the site code, or more of the name.`
}

export function helpText(sites = []) {
  if (!sites.length) return MESSAGES.noSites
  if (sites.length <= 5) {
    return `${MESSAGES.help}\n\nYour sites:\n${sites.map((s) => `• ${siteTitle(s)}`).join('\n')}`
  }
  return `${MESSAGES.help}\n\nYou can look up ${plural(sites.length, 'site')}.`
}
