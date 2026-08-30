// ─────────────────────────────────────────────────────────────────────────────
// The Metabase connector's decisions, without the network.
//
// WHY THE SERVER HOLDS THIS AT ALL. A Metabase API key is a bearer credential
// for the whole analytics warehouse — every question, every database that
// instance can reach. The browser must never be handed one, so the key lives in
// a Firestore document only an admin can write and that NOBODY reads back to a
// client; the callable reads it with the Admin SDK, makes the request, and
// returns rows. That is also what makes the dashboard usable by an ordinary
// member: they see the numbers without ever holding the credential that fetched
// them.
//
// The second reason is duller and just as necessary. A browser cannot call a
// self-hosted Metabase at all unless that instance sets CORS headers for this
// origin, which is an operator's problem inside somebody else's infrastructure.
// Through a function it is one server talking to another.
//
// Pure, so every branch runs under vitest without the Admin SDK or a network.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The datasets ODIN knows how to ask for, and what each is for.
 *
 * `findings` is the issue register — one row per Safety & Security finding.
 * `audits` is one row per completed audit and carries the pass percentages.
 * It is optional, and the pass-rate panels say so plainly when it is absent
 * rather than inventing a number out of the findings.
 */
export const DATASETS = ['findings', 'audits']

/** Where the connection settings live. One document, admin-only, per tenant. */
export const configPath = (orgId) => `organizations/${orgId}/integrations/metabase`

// ── The URL, and why it is checked this hard ─────────────────────────────────
//
// An admin types the base URL and the FUNCTION makes the request, so whatever
// they type is a URL our infrastructure will fetch — server-side request
// forgery with a settings form for a front end. On Cloud Run that reaches the
// metadata server at 169.254.169.254, which hands out service-account tokens to
// anything that asks for them.
//
// So: https only, and no host that names somewhere only we can reach. This
// cannot catch a public hostname carrying a private A record — that needs the
// DNS resolution the fetch itself performs — and no claim is made that it does.
// It closes the literal cases, which is what an accident or a careless paste
// actually looks like.
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', '[::1]'])
const BLOCKED_PATTERNS = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /\.internal$/i, /\.local$/i,
]

/**
 * Normalise and vet the instance URL.
 *
 * @returns `{ ok: true, origin }` or `{ ok: false, reason }`. The reason is
 *          shown to the admin who typed it — this is a configuration screen, so
 *          being specific is the entire point of it.
 */
export function checkBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return { ok: false, reason: 'Enter your Metabase URL.' }
  let url
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return { ok: false, reason: 'That is not a URL.' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Metabase must be reached over https — an API key sent over http is readable in transit.' }
  }
  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host) || BLOCKED_PATTERNS.some((p) => p.test(host))) {
    return { ok: false, reason: 'That address is on a private network the server cannot — and must not — reach.' }
  }
  // Origin only. A path, query or fragment on the base URL would be silently
  // dropped when the API path is appended, and a setting that is accepted and
  // then ignored is worse than one that is refused.
  return { ok: true, origin: url.origin }
}

/** A saved-question id: a positive integer, however it was typed. */
export function parseCardId(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── More than one instance, one key ──────────────────────────────────────────
//
// An organization rarely has exactly one Metabase. There is the group instance
// and the one the newly-acquired region still runs; or one per environment; or
// one per business the estate was assembled from. They are usually reached with
// the SAME API key, because the key belongs to the account, not the host.
//
// So the config holds a LIST of sources and one shared key, and a source may
// override that key when it genuinely needs its own. ODIN queries every source
// that has a question for the dataset and merges the rows, tagging each with
// where it came from — a number on this dashboard has to be traceable to the
// instance that produced it.
//
// The single-source shape is still read, and that is not merely politeness:
// documents saved by the first version of this screen hold `baseUrl` and
// `cards` at the top level, and a normaliser that stopped understanding them
// would disconnect every tenant already using ODIN on the next deploy.

const cardsOf = (data) => {
  const cards = data?.cards && typeof data.cards === 'object' ? data.cards : {}
  return Object.fromEntries(DATASETS.map((d) => [d, parseCardId(cards[d])]))
}

/** A stable id for a source that was saved before ids existed. */
const sourceId = (s, i) => String(s?.id || `src${i + 1}`)

/**
 * The stored config, defended against whatever the document actually holds.
 *
 * `sources` is always an array, however the document was written. `baseUrl` and
 * `cards` are still returned as the FIRST source's, so every existing caller
 * and test keeps meaning what it meant.
 */
// ── Keys that expire ─────────────────────────────────────────────────────────
//
// Some Metabase instances issue API keys with a short, fixed life — three days
// is a real setting on a real installation. On one of those, a dashboard that
// simply stops working every third day, with a 401 behind a generic "could not
// run the question", is a support ticket a week.
//
// So the config records WHEN the key was last set and, optionally, how long
// keys last here. Neither is a credential, both are shown to admins, and
// together they turn "it broke again" into "this key expires tomorrow".
// Nothing is enforced: the age is reported, never used to block a request that
// might well still work.

/** Milliseconds in a day, named because the arithmetic below reads better. */
const DAY_MS = 86_400_000

/** A Firestore Timestamp, an ISO string or a number, as epoch ms — or null. */
export function asMillis(value) {
  if (!value) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : null
}

/**
 * How old the saved key is, and whether it is due for rotation.
 *
 * `maxAgeDays` of 0 means "these keys do not expire", which is the default and
 * the common case — then `expiresInDays` and `stale` are null rather than
 * invented, because a dashboard that warns about a key that never expires is a
 * dashboard whose warnings get ignored.
 */
export function keyAge(config, now = Date.now()) {
  const c = normalizeConfig(config)
  if (!c.apiKey && !c.sources.some((s) => s.apiKey)) return { set: false, days: null, expiresInDays: null, stale: false }
  const at = asMillis(c.apiKeyUpdatedAt)
  if (at === null) return { set: true, days: null, expiresInDays: null, stale: false }
  const days = Math.floor((now - at) / DAY_MS)
  if (!c.apiKeyMaxAgeDays) return { set: true, days, expiresInDays: null, stale: false }
  const expiresInDays = c.apiKeyMaxAgeDays - days
  return { set: true, days, expiresInDays, stale: expiresInDays <= 0 }
}

export function normalizeConfig(data) {
  const apiKey = String(data?.apiKey || '')
  const listed = Array.isArray(data?.sources) ? data.sources.filter((s) => s && typeof s === 'object') : []

  const sources = (listed.length
    ? listed
    // The legacy single-source shape, lifted into the list. A document with
    // neither is one empty source, so a settings screen has a row to fill in
    // rather than an empty list it has to know to add to.
    : [{ id: 'src1', label: '', baseUrl: data?.baseUrl, cards: data?.cards }]
  ).map((s, i) => ({
    id: sourceId(s, i),
    label: String(s.label || '').trim(),
    baseUrl: String(s.baseUrl || ''),
    // The shared key unless this one carries its own. Resolved HERE so nothing
    // downstream has to remember the fallback, and so a source can never
    // silently fall back to no key at all.
    apiKey: String(s.apiKey || '') || apiKey,
    ownKey: Boolean(String(s.apiKey || '')),
    cards: cardsOf(s),
  }))

  // How long a key lasts on this instance, in days. Zero — the default — means
  // "they do not expire", and is deliberately not a guess: an instance that
  // issues permanent keys must not grow a warning that never stops.
  const maxAge = Math.floor(Number(data?.apiKeyMaxAgeDays)) || 0

  return {
    apiKey,
    sources,
    apiKeyUpdatedAt: data?.apiKeyUpdatedAt ?? null,
    apiKeyMaxAgeDays: maxAge > 0 ? maxAge : 0,
    // The first source, flattened — the shape this config had before it held a
    // list, kept so single-instance callers read the same as they always did.
    baseUrl: sources[0]?.baseUrl || '',
    cards: sources[0]?.cards || cardsOf(null),
  }
}

/** Every source that could actually answer for `dataset`. */
export function sourcesFor(config, dataset) {
  return normalizeConfig(config).sources.filter((s) => s.baseUrl && s.apiKey && s.cards[dataset])
}

/**
 * What a client may be told about the connection.
 *
 * No key is in it — not masked, not truncated, ABSENT, and that holds for every
 * source's own key as well as the shared one. A masked credential in a JSON
 * response is still a credential in a JSON response as far as a browser cache,
 * a screen recording or a support screenshot is concerned, and there is nothing
 * a settings screen needs it for beyond "is one set", which is a boolean.
 */
export function redactConfig(config) {
  const c = normalizeConfig(config)
  return {
    baseUrl: c.baseUrl,
    hasKey: Boolean(c.apiKey),
    cards: c.cards,
    // When the key was last rotated and how long keys last here — both facts
    // ABOUT the credential, neither any part of it.
    apiKeyUpdatedAt: asMillis(c.apiKeyUpdatedAt),
    apiKeyMaxAgeDays: c.apiKeyMaxAgeDays,
    keyAge: keyAge(c),
    sources: c.sources.map((s) => ({
      id: s.id,
      label: s.label,
      baseUrl: s.baseUrl,
      // Whether this source can be reached at all, and whether that is on its
      // own key or the shared one. Never the key itself, in either case.
      hasKey: Boolean(s.apiKey),
      ownKey: s.ownKey,
      cards: s.cards,
    })),
  }
}

/**
 * Is the connection usable for `dataset`? Returns `{ ok }` or `{ ok, reason }`.
 *
 * ANY source being usable is enough. One instance being down, or not carrying
 * the audits question, must not blank a dashboard the other two can fill —
 * which is also why the callable reports per-source outcomes rather than one
 * verdict for the lot.
 */
export function readiness(config, dataset) {
  const c = normalizeConfig(config)
  if (!c.sources.some((s) => s.baseUrl && s.apiKey)) return { ok: false, reason: 'not-configured' }
  if (!DATASETS.includes(dataset)) return { ok: false, reason: 'unknown-dataset' }
  if (!sourcesFor(config, dataset).length) return { ok: false, reason: 'no-card' }
  return { ok: true }
}

/** The endpoint that runs a saved question and returns its rows as JSON. */
export const cardQueryUrl = (origin, cardId) => `${origin}/api/card/${cardId}/query/json`

/** The endpoint that describes a saved question — its parameters, mainly. */
export const cardUrl = (origin, cardId) => `${origin}/api/card/${cardId}`

// ── Date parameters ──────────────────────────────────────────────────────────
//
// A serious warehouse question is almost never "return everything". Both of the
// questions this was first built against declare REQUIRED date variables, and a
// bare POST to one of them comes back:
//
//   Cannot run the query: missing required parameters: #{"Start" "End"}
//
// So the dashboard was asking for a dataset that could not be produced. Sending
// the range also stops a twelve-month question being run and thrown away every
// time somebody wants a fortnight — the filtering happens in the warehouse,
// where the data is, rather than over the wire.
//
// WHICH parameters get the range is inferred, and the inference is deliberately
// dull: the question's date parameters, in the order the question declares
// them, first is the start and second is the end. That is the shape of every
// date-ranged question anyone writes, and the alternative — asking an admin to
// type two variable names into the settings screen for each of two questions —
// is four more fields to get wrong. What ran is reported back, so a question
// whose parameters were guessed wrong shows it rather than hiding it.

/** 'YYYY-MM-DD', or '' for anything that is not one. */
export function asDay(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  // Rejects 2026-02-31 and friends, which Metabase would take and misread.
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : ''
}

/** The date-typed parameters a saved question declares, in declaration order. */
export const dateParameters = (card) =>
  (Array.isArray(card?.parameters) ? card.parameters : [])
    .filter((p) => p && typeof p.type === 'string' && p.type.startsWith('date/'))

/**
 * The `parameters` body that runs `card` over [from, to].
 *
 * Returns `{ parameters, bound }` — `bound` names what was filled, for the
 * response. An empty array is a legitimate answer: a question with no date
 * parameters is run exactly as it was before any of this existed.
 */
export function buildDateParams(card, { from = '', to = '' } = {}) {
  const start = asDay(from)
  const end = asDay(to)
  const dates = dateParameters(card)
  if (!dates.length || (!start && !end)) return { parameters: [], bound: [] }

  // One date parameter is an "as at" or a "since", not a range. Binding the
  // start to it would silently turn "up to today" into "from a year ago".
  const pairs = dates.length === 1
    ? [[dates[0], end || start]]
    : [[dates[0], start], [dates[1], end]]

  const parameters = []
  const bound = []
  for (const [p, value] of pairs) {
    if (!value) continue
    parameters.push({ id: p.id, type: p.type, target: p.target, value })
    bound.push({ slug: p.slug || p.name || p.id, value })
  }
  return { parameters, bound }
}

/** [from, to] covering the last `days`, ending today. */
export function defaultRange(now = Date.now(), days = 365) {
  const to = new Date(now)
  const from = new Date(now - days * 86_400_000)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

/**
 * The range a caller asked for, clamped to something a warehouse can survive.
 *
 * An unbounded or inverted range is corrected rather than refused: this is a
 * dashboard filter, and a date picker that returns an error is worse than one
 * that returns the last year. MAX_RANGE_DAYS exists because these questions
 * take tens of seconds per month of data and the callable has two minutes.
 */
export const MAX_RANGE_DAYS = 400

export function safeRange({ from = '', to = '' } = {}, now = Date.now(), days = 365) {
  const fallback = defaultRange(now, days)
  let start = asDay(from) || fallback.from
  let end = asDay(to) || fallback.to
  if (start > end) [start, end] = [end, start]
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  if (span > MAX_RANGE_DAYS) {
    start = new Date(Date.parse(`${end}T00:00:00Z`) - MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10)
  }
  return { from: start, to: end, clamped: span > MAX_RANGE_DAYS }
}

/** The endpoint that proves a key works, without running anybody's query. */
export const currentUserUrl = (origin) => `${origin}/api/user/current`

// ── Column mapping ───────────────────────────────────────────────────────────
//
// Metabase hands back whatever the question's columns are called, which is
// whatever the warehouse calls them — "Site Name", "site_nm", "SITE". ODIN
// cannot require an organization to rename their columns in order to use a
// dashboard, so it maps; and the mapping is DATA rather than a chain of ifs
// precisely so the settings screen can print it. An admin who can see what ODIN
// is looking for can alias a column in Metabase in thirty seconds.
//
// Anything unmapped is kept under its original name in `extra`, so nothing the
// question returns is thrown away silently.

/**
 * Strip everything but letters and digits, so 'Site Name' and 'site_name' meet.
 *
 * The percent sign survives as the word `pct`, and that is load-bearing rather
 * than tidy. Stripping it outright collapsed 'Pass %' and 'Pass' onto the same
 * key — and those are two different columns: one is a percentage, the other is
 * a COUNT of checks that passed. Reading a count of 8 as "8%" would draw a bar
 * that is wrong by an order of magnitude and looks entirely plausible.
 */
export const columnKey = (name) =>
  String(name || '').toLowerCase().replace(/%/g, ' pct ').replace(/[^a-z0-9]/g, '')

export const COLUMN_ALIASES = {
  siteId: ['siteid', 'sitecode', 'locationid', 'centerid', 'centreid', 'centerserviceid', 'centreserviceid'],
  site: ['site', 'sitename', 'location', 'locationname', 'branch', 'store', 'facility', 'center', 'centre', 'centername', 'centrename'],
  region: ['region', 'zone', 'area', 'cluster'],
  entity: ['entity', 'businessentity', 'businessunit', 'bu', 'company', 'division'],
  status: ['status', 'issuestatus', 'findingstatus', 'state', 'ticketstatus'],
  category: ['category', 'findingcategory', 'maincategory', 'findingtype', 'l1tag', 'l1'],
  subCategory: ['subcategory', 'subcat', 'findingsubcategory', 'subtype', 'subcategoryoffinding', 'l2tag', 'l2'],
  auditDate: ['auditdate', 'date', 'auditedon', 'checkedon', 'observationdate', 'reporteddate', 'raiseddate', 'startdate', 'ticketdate', 'createdon', 'createdondate'],
  closedDate: ['closeddate', 'closedon', 'resolveddate', 'completedon', 'closedat', 'closureDate', 'ticketclosuredate', 'ticketclosedtime'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  count: ['count', 'issues', 'findings', 'total', 'n'],

  // ── The dimensions an estate is actually cut by ───────────────────────────
  //
  // `region` and `entity` were the whole vocabulary, and they are the wrong two
  // for a business that runs hundreds of near-identical sites: those are sliced
  // by city, by who owns the box, by which brand runs it and by what format it
  // is. Each is its OWN field rather than aliased onto region, because folding
  // a city into a column labelled "region" produces a chart that is confidently
  // mislabelled — and the tab lets a reader pick which of them to group by, so
  // nothing is lost by keeping them apart.
  city: ['city', 'cityname', 'citynm', 'town'],
  ownership: ['ownership', 'ownershiptype', 'ownedby', 'operatingmodel', 'ownermodel'],
  businessLine: ['businessline', 'bizline', 'vertical', 'brand', 'productline'],
  centerType: ['centertype', 'centretype', 'centertype1', 'centretype1', 'sitetype', 'format', 'formattype'],
  tenant: ['tenant', 'tenanttype', 'tenantname', 'type'],
  auditor: ['auditor', 'auditorname', 'inspector', 'inspectorname', 'assessor', 'checkedby', 'auditedby'],

  // ── Remediation ───────────────────────────────────────────────────────────
  //
  // A findings question that carries a priority and an SLA verdict is stating
  // which of its rows are the queue and which are noise. That is the single
  // most useful thing a ticket dump has to say, and it had nowhere to land.
  priority: ['priority', 'priorityflag', 'severity', 'criticality', 'urgency'],
  sla: ['sla', 'slastatus', 'slaflag', 'slastate'],
  tatHours: ['tat', 'tathours', 'tatclosurehour', 'turnaroundhours', 'closurehours'],
  // The audit question behind a finding, verbatim. It is what tells an estate
  // team what to fix everywhere rather than site by site.
  checkpoint: ['checkpoint', 'question', 'checkpointname', 'checkitem', 'controlquestion'],
  // What KIND of audit this is. `labels` sits here rather than on `category`
  // because a ticket dump carries both, and two columns claiming one field
  // means the later one is lost.
  auditType: ['audittype', 'typeofaudit', 'labels', 'templatename'],

  // ── Pass rates, two ways of stating the same thing ────────────────────────
  //
  // A warehouse expresses an audit result as EITHER a percentage or a pair of
  // counts, and both are supported because both are what people actually have.
  // Counts are the better input: they carry the size of the audit, which is
  // what lets a group be weighted rather than averaged — see passRates in
  // src/pages/analytics/odinAnalytics.js.
  //
  // 'Pass %' and 'Pass' are DIFFERENT columns and must never collapse together;
  // columnKey keeps the sign as `pct` so they cannot. A bare 'Pass' is read as
  // a count, because that is what a bare Pass beside a bare Fail means.
  // 'oringinalcalcultatedcasscore' is not a typo here — it is the typo in the
  // warehouse, and an alias table that refuses to match a misspelled column is
  // an alias table that does not work on real questions.
  passPct: ['passpct', 'pctpass', 'passpercentage', 'passrate', 'score', 'scorepct', 'compliance', 'compliancepct', 'passpercentageday0', 'day0passpct',
    'casscore', 'originalcalculatedcasscore', 'oringinalcalcultatedcasscore'],
  passPctN7: ['passpctn7', 'n7passpct', 'passpercentagen7', 'n7passpercentage', 'passraten7', 'retestpasspct', 'day7passpct',
    'cassevendayscore', 'sevendaycasscore', 'updatedcasscore7day', 'casscoren7'],
  // A third reading of the same audit: every remediation credited, right up to
  // now. It is the most flattering of the three and the only one that MOVES on
  // its own between refreshes, which is exactly why it is kept apart from the
  // N+7 figure rather than quietly replacing it.
  passPctToDate: ['passpcttodate', 'todatepasspct', 'cascurrentdayscore', 'currentdaycasscore', 'updatedcasscorecurrentday'],
  checksPassed: ['pass', 'passed', 'passes', 'passcount', 'checkspassed', 'passedchecks', 'compliantpoints', 'conformances'],
  checksFailed: ['fail', 'failed', 'fails', 'failcount', 'checksfailed', 'failedchecks', 'noncompliantpoints', 'nonconformances', 'nonconformities'],
  // The seven-day re-check, stated the same two ways. Symmetry matters here:
  // an organization that records the audit as pass/fail counts records the
  // re-check that way too, and supporting only the percentage for N+7 would
  // leave half of every such dashboard empty.
  checksPassedN7: ['passn7', 'n7pass', 'passedn7', 'n7passed', 'checkspassedn7', 'retestpassed'],
  checksFailedN7: ['failn7', 'n7fail', 'failedn7', 'n7failed', 'checksfailedn7', 'retestfailed'],
  checksTotal: ['checkstotal', 'totalchecks', 'checkpoints', 'totalpoints', 'questions'],
}

// Built once: alias → canonical. Two canonical fields must never claim the same
// alias, so this is asserted here rather than left to whoever edits the table
// next — the failure mode otherwise is a column feeding the wrong chart.
const ALIAS_TO_FIELD = (() => {
  const out = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (out[alias]) throw new Error(`metabase: alias '${alias}' claimed by both ${out[alias]} and ${field}`)
      out[alias] = field
    }
  }
  return out
})()

/** The canonical field a returned column feeds, or null when it feeds none. */
export const fieldForColumn = (name) => ALIAS_TO_FIELD[columnKey(name)] || null

// ── Status ───────────────────────────────────────────────────────────────────
//
// Four buckets, because four is what the dashboard shows. A fifth — 'unknown' —
// exists and is never drawn as a bar: it is COUNTED and reported as a caveat,
// because folding an unrecognised status into "Open" produces a chart that is
// confidently wrong, and a chart nobody can tell is wrong is the worst artefact
// this code could produce.
export const STATUSES = ['open', 'in_progress', 'on_hold', 'closed']

const STATUS_ALIASES = {
  open: ['open', 'new', 'raised', 'reported', 'pending', 'todo', 'notstarted'],
  in_progress: ['inprogress', 'progress', 'wip', 'workinprogress', 'ongoing', 'started', 'active', 'underreview'],
  on_hold: ['onhold', 'hold', 'paused', 'deferred', 'blocked', 'suspended', 'waiting', 'parked'],
  closed: ['closed', 'resolved', 'completed', 'complete', 'done', 'verified', 'fixed', 'rectified'],
}

const STATUS_LOOKUP = (() => {
  const out = {}
  for (const [status, aliases] of Object.entries(STATUS_ALIASES)) for (const a of aliases) out[a] = status
  return out
})()

/** One of STATUSES, or 'unknown' — never a guess. */
export const normalizeStatus = (value) => STATUS_LOOKUP[columnKey(value)] || 'unknown'

// ── Rows ─────────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  // Percent signs and thousands separators arrive from warehouses that store
  // these as display strings. A NaN here becomes a missing bar, silently.
  const n = Number(String(v).replace(/[%,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' from whatever the warehouse calls a date, or ''. */
export function isoDate(value) {
  if (!value) return ''
  const s = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * One returned row, mapped onto the canonical shape.
 *
 * Everything unmapped survives in `extra` under its original column name. A
 * question carrying a column ODIN has no use for is not an error, and dropping
 * it silently would make "why can't I see my severity column" unanswerable.
 */
export function normalizeRow(row = {}) {
  const out = { extra: {} }
  for (const [name, value] of Object.entries(row)) {
    const field = fieldForColumn(name)
    if (!field) { out.extra[name] = value; continue }
    // First column wins. A question carrying both 'site' and 'site_name' would
    // otherwise depend on JSON key order, which is not a thing to depend on.
    //
    // The RUNNER-UP is kept in `extra` rather than dropped. It used to vanish
    // entirely, which meant a question carrying two columns that both mapped to
    // one field silently lost the second — invisible on the dashboard and
    // invisible in the settings screen's unmapped list, so there was nothing to
    // see and nothing to fix.
    if (out[field] !== undefined) { out.extra[name] = value; continue }
    out[field] = value
  }
  return {
    siteId: String(out.siteId ?? '').trim(),
    site: String(out.site ?? '').trim(),
    region: String(out.region ?? '').trim(),
    entity: String(out.entity ?? '').trim(),
    status: normalizeStatus(out.status),
    rawStatus: String(out.status ?? '').trim(),
    category: String(out.category ?? '').trim(),
    subCategory: String(out.subCategory ?? '').trim(),
    city: String(out.city ?? '').trim(),
    ownership: String(out.ownership ?? '').trim(),
    businessLine: String(out.businessLine ?? '').trim(),
    centerType: String(out.centerType ?? '').trim(),
    tenant: String(out.tenant ?? '').trim(),
    // Warehouse account names arrive with the company glued on the end
    // ("Amit kumar Srivastava Curefit"), which makes every legend twice as wide
    // as it needs to be for no added meaning.
    auditor: String(out.auditor ?? '').trim().replace(/\s+(curefit|cultfit)$/i, ''),
    priority: String(out.priority ?? '').trim(),
    sla: String(out.sla ?? '').trim(),
    checkpoint: String(out.checkpoint ?? '').trim(),
    auditType: String(out.auditType ?? '').trim().replace(/^\[|\]$/g, ''),
    tatHours: num(out.tatHours),
    auditDate: isoDate(out.auditDate),
    closedDate: isoDate(out.closedDate),
    lat: num(out.lat),
    lng: num(out.lng),
    // A question that is already grouped returns a count per row; one that is
    // not returns a row per finding. Defaulting to 1 makes both shapes work
    // through the same sum, which is why nothing downstream counts rows.
    count: num(out.count) ?? 1,
    passPct: num(out.passPct),
    passPctN7: num(out.passPctN7),
    passPctToDate: num(out.passPctToDate),
    checksPassed: num(out.checksPassed),
    // A pass count on its own says nothing — 8 passed out of what? — so the
    // fail count beside it is what makes the pair usable, and the total is
    // derived rather than demanded. An organization that records "8 pass, 2
    // fail" per audit needs no third column to get a pass rate out of ODIN.
    checksFailed: num(out.checksFailed),
    checksTotal: num(out.checksTotal) ?? addChecks(out.checksPassed, out.checksFailed),
    checksPassedN7: num(out.checksPassedN7),
    checksFailedN7: num(out.checksFailedN7),
    checksTotalN7: addChecks(out.checksPassedN7, out.checksFailedN7),
    extra: out.extra,
  }
}

/**
 * passed + failed, or null when the pair is incomplete.
 *
 * Null rather than a partial sum, deliberately. Treating a missing fail count
 * as zero would turn "8 passed, we did not record the failures" into a 100%
 * pass rate — an invented number that reads as a perfect audit.
 */
function addChecks(passed, failed) {
  const p = num(passed)
  const f = num(failed)
  return p === null || f === null ? null : p + f
}

/** Every row mapped, plus the columns nothing claimed — the settings screen prints these. */
export function normalizeRows(rows = []) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : []
  const unmapped = new Set()
  for (const r of list) for (const name of Object.keys(r)) if (!fieldForColumn(name)) unmapped.add(name)
  return { rows: list.map(normalizeRow), unmapped: [...unmapped] }
}

// ── The response cap ─────────────────────────────────────────────────────────
//
// A callable's response is capped at 10MB and a Metabase question can return a
// million rows. Truncating quietly would produce a dashboard that is simply
// wrong about totals, so the cap is applied here and REPORTED — the tab prints
// "showing the first N of M" above the charts, the same way analytics/index.jsx
// does for a capped Firestore read.
export const MAX_ROWS = 20000

export function capRows(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return { rows: list.slice(0, MAX_ROWS), total: list.length, capped: list.length > MAX_ROWS }
}
