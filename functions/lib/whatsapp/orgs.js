// ─────────────────────────────────────────────────────────────────────────────
// Which organisation a chat is asking about.
//
// A profile belongs to one organisation (users/{uid}.orgId). WhatsApp may
// offer only that one: the link is proof of possession of a number, not a
// pass to the customer list. Telegram has no number to match, so it stays
// open — and an open bot that recites every organisation name is the signup
// page bug again (orgIndex is not publicly listable because it is the
// customer list). Names are volunteered only when the caller already has a
// right to them, or when the operator opts in with TG_LIST_ORGS and the set
// fits in one pick list.
// ─────────────────────────────────────────────────────────────────────────────
import { isActiveMember } from './access.js'
import { clean } from './format.js'

/** Idle time after which the chat is asked which organisation again. */
export const CONV_TTL_MS = 24 * 60 * 60 * 1000

/** How many organisations a single message may list. WhatsApp list rows stop at 10. */
export const MAX_ORG_CHOICES = 10

/** Part of a name shorter than this matches nothing. Exact names still match. */
const MIN_PARTIAL = 3

const SAFE_CHOICE = /^(org|site):[A-Za-z0-9_-]{1,60}$/

export const ORG_TOO_MANY = 'Several organisations match. Please send more of the name.'

export const ORG_NOT_ALLOWED =
  "That organisation isn't available on this chat. Reply with an organisation name."

export const ORG_NONE =
  'Site lookup is not available for your account yet.\n\nIn an emergency call 112.'

const EMERGENCY = 'In an emergency call 112.'

export function normaliseOrgName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Organisations this linked profile may be offered. One, or none.
 * `org` is the live organisations/{id} document ({ id, name }), not a list.
 */
export function orgsForLinkedUser(user, org) {
  if (!isActiveMember(user, user?.orgId)) return []
  if (org && org.id && org.id !== user.orgId) return []
  const name = String(org?.name || user?.orgName || '').trim() || 'Your organisation'
  return [{ id: user.orgId, name }]
}

/**
 * The user answerQuery may search as, once an organisation is chosen.
 * A linked member is not rewritten into another org. The open Telegram
 * caller is an admin of the chosen org only — grants from anywhere else
 * do not travel with them.
 */
export function callerForOrg(user, orgId) {
  if (!user || !orgId) return null
  if (user.orgId === orgId) return user
  if (user.channelAdmin === true) {
    return { uid: null, orgId, role: 'admin', status: 'approved', channelAdmin: true }
  }
  return null
}

/**
 * @returns { status: 'one', org } | { status: 'many', orgs } | { status: 'tooMany' } | { status: 'none' }
 */
export function resolveOrgQuery(query, orgs = []) {
  const list = (orgs || []).filter((o) => o && o.id && normaliseOrgName(o.name))
  const q = normaliseOrgName(query)
  if (!q || !list.length) return { status: 'none' }

  const decide = (hits) => {
    const sorted = [...hits].sort(
      (a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))
    )
    if (sorted.length === 1) return { status: 'one', org: sorted[0] }
    if (sorted.length <= MAX_ORG_CHOICES) return { status: 'many', orgs: sorted }
    return { status: 'tooMany' }
  }

  const exact = list.filter((o) => normaliseOrgName(o.name) === q)
  if (exact.length) return decide(exact)

  const words = q.split(' ')
  if (q.length < MIN_PARTIAL || words.some((w) => w.length < MIN_PARTIAL)) return { status: 'none' }
  const contains = list.filter((o) => {
    const name = normaliseOrgName(o.name)
    return words.every((w) => name.includes(w))
  })
  if (!contains.length) return { status: 'none' }
  return decide(contains)
}

/** Volunteer every name, or make them type one. A single name is not a directory. */
export function shouldListOrgs(orgs, listOrgs) {
  const n = orgs?.length || 0
  if (n < 1 || n > MAX_ORG_CHOICES) return false
  if (n === 1) return true
  return listOrgs === true
}

const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** id safe to put in a WhatsApp row id or a Telegram callback_data (≤64 bytes). */
export function orgChoiceId(id) {
  const value = `org:${id}`
  return SAFE_CHOICE.test(value) ? value : ''
}

/**
 * The "which organisation?" message.
 * `list` false: no names (open Telegram, closed directory).
 * `query` set: they typed something. Matches are listed; a miss is not a directory.
 */
export function formatOrgPrompt(orgs = [], { list = false, query = '', missed = false } = {}) {
  const shown = list ? orgs.slice(0, MAX_ORG_CHOICES) : []
  const q = query ? clean(query, 40) : ''
  const head = missed
    ? `No organisation matches "${q}".`
    : q
      ? `Several organisations match "${q}":`
      : 'Which organisation?'
  const lines = shown.map((o, i) => `${i + 1}. ${clean(o.name, 80) || 'Organisation'}`)
  const how = shown.length
    ? 'Reply with the number or the name.'
    : 'Reply with its name, or part of the name.'
  const text = cut(
    [
      head,
      ...(lines.length ? ['', ...lines] : []),
      '',
      how,
      'Say MENU to start over.',
      '',
      EMERGENCY,
    ].join('\n'),
    1024
  )
  const rows = []
  shown.forEach((o, i) => {
    const id = orgChoiceId(o.id)
    if (!id) return
    const name = clean(o.name, 80) || 'Organisation'
    rows.push({
      id,
      title: cut(name, 24),
      description: cut(name, 72),
      label: cut(`${i + 1}. ${name}`, 64),
    })
  })
  return {
    text,
    rows,
    list: rows.length ? { button: 'Choose organisation', section: 'Organisations' } : undefined,
  }
}

/** After an organisation is chosen: ask for the site, and say which org. */
export function sitePrompt(org) {
  const name = clean(org?.name, 80) || 'That organisation'
  return (
    `${name}.\n\n` +
    'Send a Site ID or Centre ID, or part of the site name.\n\n' +
    'Say MENU to start over, or CHANGE ORG to switch organisation.\n\n' +
    EMERGENCY
  )
}

/**
 * The organisation a numbered reply picks from the last list, or undefined
 * when there is no live organisation list. null when the list is live but
 * that id is no longer allowed — the caller must not fall through to a search.
 */
export function pickListedOrg(session, uid, n, orgs, now) {
  if (!session || session.uid !== uid || session.choiceKind !== 'org') return undefined
  const nowMs = now.getTime()
  if (!(Number(session.expiresAtMs) > nowMs)) return undefined
  if (!(Number(session.choicesExpireAtMs) > nowMs)) return undefined
  const ids = Array.isArray(session.choices) ? session.choices : []
  if (!Number.isInteger(n) || n < 1 || n > ids.length) return undefined
  return (orgs || []).find((o) => o.id === ids[n - 1]) || null
}

/** The chosen organisation, if this chat is still on the site step. */
export function onSiteStep(session, uid, orgs, now) {
  if (!session || session.uid !== uid || session.step !== 'site') return null
  if (!(Number(session.expiresAtMs) > now.getTime())) return null
  return (orgs || []).find((o) => o.id === session.orgId) || null
}

/** Ids worth a snapshot. Empty names are still built: the bot can be pinned to one. */
export function snapshotOrgIds(rows) {
  const ids = []
  const seen = new Set()
  for (const row of rows || []) {
    const id = typeof row === 'string' ? row : row?.id
    if (typeof id !== 'string' || !id || id.includes('/') || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Names the open bot may search. An organisation with no name is not offered. */
export function namedOrganisations(rows) {
  return (rows || [])
    .map((row) => ({
      id: typeof row?.id === 'string' ? row.id : '',
      name: String(row?.name || '').trim(),
    }))
    .filter((o) => o.id && o.name && !o.id.includes('/'))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
