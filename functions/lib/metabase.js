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
// The decisions stay testable without the Admin SDK. The DNS step takes its
// resolvers as arguments, so the suite never dials; production passes none
// and the defaults below are the real ones.
// ─────────────────────────────────────────────────────────────────────────────

import {
  lookup as dnsLookup,
  resolve4 as dnsResolve4,
  resolve6 as dnsResolve6,
} from 'node:dns/promises'
import https from 'node:https'
import net from 'node:net'

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
// So: https only, and no host that names somewhere only we can reach. The
// literal check is what a paste looks like. It is not the whole of it: a
// public name can resolve to a private address, and the name can change
// between the check and the dial. connectMetabase resolves first — the OS
// lookup plus the A and AAAA records — and refuses the host if any address
// is private, loopback, link-local, metadata, or an IPv6 form that carries
// one of those. The socket's lookup then returns only the addresses that
// passed, so a later answer is not what gets dialled.
//
// Two literal forms the dotted-decimal patterns do not see, both of which the
// URL parser accepts and a fetch will dial:
//   a trailing dot (`metadata.google.internal.`) is the same DNS name
//   an IPv6 literal, including the IPv4-mapped form Node canonicalises the
//   metadata address to (`[::ffff:a9fe:a9fe]`)
// Metabase is configured by hostname. Refusing every IPv6 literal is the
// check; there is no instance URL that is one.
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal'])
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
  // A trailing dot is the same DNS name. `metadata.google.internal.` used to
  // miss the set. A colon means an IPv6 literal: url.hostname keeps the
  // brackets, and no Metabase URL is one of those.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (host.includes(':') || BLOCKED_HOSTS.has(host) || BLOCKED_PATTERNS.some((p) => p.test(host))) {
    return { ok: false, reason: 'That address is on a private network the server cannot — and must not — reach.' }
  }
  // Origin only. A path, query or fragment on the base URL would be silently
  // dropped when the API path is appended, and a setting that is accepted and
  // then ignored is worse than one that is refused.
  return { ok: true, origin: url.origin }
}

/**
 * Options for a request to an instance that has already passed checkBaseUrl.
 *
 * `redirect: 'error'` is the other half of that check. fetch follows a 302
 * by default, and the host we vetted is not the host a redirect dials — the
 * API key would go with it, in the header below. A Metabase that needs a
 * redirect is reached by saving the URL it redirects to.
 */
export function metabaseRequestInit(apiKey, { method = 'GET', body, signal } = {}) {
  return {
    method,
    redirect: 'error',
    headers: {
      'x-api-key': apiKey,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  }
}

// ── Resolve, then pin ────────────────────────────────────────────────────────
//
// checkBaseUrl sees the string the admin typed. The address the socket dials
// is whatever that name resolves to at connect time, which is a second lookup
// and can be a different answer — a public name with a private record, or a
// name that changes between the two (rebinding). Both are refused here.
//
// The union is the OS lookup (what getaddrinfo would dial, including the
// hosts file) AND the A and AAAA records. Either source alone can hide the
// private one: a hosts entry can disagree with DNS, and a single A answer
// can omit the AAAA. An empty union is a refusal, not permission. A hard
// resolver error is too — a failure is not proof the record was public.
//
// An IPv4 written inside an IPv6 address is still that IPv4. Mapped
// (::ffff:0:0/96), compatible (::/96), 6to4 (2002::/16) and the well-known
// NAT64 prefixes (64:ff9b::/96 and 64:ff9b:1::/48) all carry one, and the
// metadata address is still the metadata address spelled that way. Shared
// address space (100.64/10), multicast and the reserved block are refused
// with the private ranges: none of them is a public instance this function
// is allowed to dial.

const PRIVATE_REASON =
  'That address is on a private network the server cannot — and must not — reach.'
const RESOLVE_REASON =
  'That address did not resolve. Check the URL, and that the instance resolves publicly.'

const defaultResolvers = {
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
  resolve4: (host) => dnsResolve4(host),
  resolve6: (host) => dnsResolve6(host),
}

function ipv4Bytes(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    bytes.push(n)
  }
  return bytes
}

function ipv4Blocked(bytes) {
  const a = bytes[0]
  const b = bytes[1]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 — shared address space, not a global unicast.
  if (a === 100 && b >= 64 && b <= 127) return true
  // Multicast and the reserved range, including the broadcast address.
  if (a >= 224) return true
  return false
}

function ipv6Bytes(ip) {
  let text = ip
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v4 = ipv4Bytes(dotted[2])
    if (!v4) return null
    const hi = ((v4[0] << 8) | v4[1]).toString(16)
    const lo = ((v4[2] << 8) | v4[3]).toString(16)
    text = `${dotted[1]}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const groupsOf = (s) => (s ? s.split(':') : [])
  const left = groupsOf(halves[0])
  const right = halves.length === 2 ? groupsOf(halves[1]) : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left
  if (groups.length !== 8) return null
  const bytes = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    const n = Number.parseInt(group, 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return bytes
}

/** The IPv4 carried inside a mapped, compatible, 6to4 or NAT64 address. */
function embeddedIpv4(bytes) {
  const zero = (from, to) => bytes.slice(from, to).every((b) => b === 0)
  if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12)
  if (zero(0, 12)) return bytes.slice(12)
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6)
  const nat64 =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
  if (nat64 && zero(4, 12)) return bytes.slice(12)
  if (nat64 && bytes[4] === 0x00 && bytes[5] === 0x01) return bytes.slice(12)
  return null
}

function parseAddress(raw) {
  if (typeof raw !== 'string') return null
  let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  if (!ip) return null
  if (!ip.includes(':')) {
    const v4 = ipv4Bytes(ip)
    return v4 ? { bytes: v4, v4: true } : null
  }
  const bytes = ipv6Bytes(ip)
  return bytes ? { bytes, v4: false } : null
}

/**
 * True when this address must not be dialled.
 *
 * Unparseable input is refused. A resolver that handed back something that
 * is not an address is not evidence the host is public.
 */
export function isBlockedAddress(raw) {
  const parsed = parseAddress(raw)
  if (!parsed) return true
  if (parsed.v4) return ipv4Blocked(parsed.bytes)
  const bytes = parsed.bytes
  if (bytes.every((b) => b === 0)) return true
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true
  if ((bytes[0] & 0xfe) === 0xfc) return true
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true
  if (bytes[0] === 0xff) return true
  const embedded = embeddedIpv4(bytes)
  return Boolean(embedded && ipv4Blocked(embedded))
}

function dialable(raw) {
  let ip = String(raw).trim().toLowerCase().replace(/^\[|\]$/g, '')
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  return ip
}

async function readDns(fn) {
  try {
    const rows = await fn()
    return { rows: Array.isArray(rows) ? rows : [] }
  } catch (err) {
    const code = err && err.code
    // No record of this type is a normal half of a dual-stack answer.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENOENT') return { rows: [] }
    return { hard: true }
  }
}

/**
 * The addresses a later socket is allowed to dial for this host.
 *
 * @returns `{ ok: true, addresses }` or `{ ok: false, reason }`. Any blocked
 *          address refuses the whole host — a public sibling is not a reason
 *          to connect when one answer is private.
 */
export async function resolvePublicHost(hostname, resolvers = defaultResolvers) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '')
  if (!host) return { ok: false, reason: RESOLVE_REASON }
  // A literal never goes back to DNS. checkBaseUrl already refuses the
  // forms a person can paste; this is the same verdict for one a record
  // returned, and for the shared/multicast ranges the literal patterns
  // do not list.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: PRIVATE_REASON }
    return { ok: true, addresses: [host] }
  }

  const looked = await readDns(() => resolvers.lookup(host))
  if (looked.hard) return { ok: false, reason: RESOLVE_REASON }
  const v4 = await readDns(() => resolvers.resolve4(host))
  if (v4.hard) return { ok: false, reason: RESOLVE_REASON }
  const v6 = await readDns(() => resolvers.resolve6(host))
  if (v6.hard) return { ok: false, reason: RESOLVE_REASON }

  const gathered = []
  for (const row of looked.rows) gathered.push(typeof row === 'string' ? row : row?.address)
  gathered.push(...v4.rows, ...v6.rows)

  const addresses = []
  const seen = new Set()
  for (const raw of gathered) {
    if (!raw) continue
    if (isBlockedAddress(raw)) return { ok: false, reason: PRIVATE_REASON }
    const parsed = parseAddress(raw)
    if (!parsed) return { ok: false, reason: PRIVATE_REASON }
    const key = Buffer.from(parsed.bytes).toString('hex')
    if (seen.has(key)) continue
    seen.add(key)
    addresses.push(dialable(raw))
  }
  if (!addresses.length) return { ok: false, reason: RESOLVE_REASON }
  return { ok: true, addresses }
}

/**
 * A `lookup` for https.request that never calls DNS.
 *
 * Node dials with `{ all: true }`. Returning the vetted list in that shape
 * is the pin: every address it tries was already classified, and the
 * hostname argument is ignored so a rebound name changes nothing.
 */
export function pinnedLookup(addresses) {
  const records = addresses.map((address) => ({
    address,
    family: net.isIP(address) === 6 ? 6 : 4,
  }))
  return function lookup(_hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    const family = options?.family
    const usable = family ? records.filter((r) => r.family === family) : records
    if (!usable.length) {
      const err = new Error('No vetted address for that family')
      err.code = 'ENOTFOUND'
      callback(err)
      return
    }
    if (options?.all) callback(null, usable.map((r) => ({ address: r.address, family: r.family })))
    else callback(null, usable[0].address, usable[0].family)
  }
}

/** The request options, with the name kept for SNI and Host and the lookup pinned. */
export function pinnedRequestOptions(urlString, init, lookup) {
  const url = new URL(urlString)
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
  const port = url.port || '443'
  const headers = { ...(init?.headers || {}) }
  headers.host = port === '443' ? hostname : `${hostname}:${port}`
  // https.request does not decompress. Identity keeps res.json() on the bytes
  // Metabase sent rather than a gzip body this client would not unwrap.
  headers['accept-encoding'] = 'identity'
  if (init?.body != null) headers['content-length'] = String(Buffer.byteLength(init.body))
  return {
    protocol: 'https:',
    hostname,
    servername: hostname,
    port,
    method: init?.method || 'GET',
    path: `${url.pathname}${url.search}`,
    headers,
    lookup,
    signal: init?.signal,
  }
}

function namedError(name, message) {
  const err = new Error(message)
  err.name = name
  return err
}

function abortError() {
  return namedError('AbortError', 'The operation was aborted')
}

/**
 * One request to a vetted host. Redirects are not followed: a 3xx is a
 * different dial, and the API key would go with it. The status is consumed
 * and the Location is not repeated — it is the next URL, and it is not ours
 * to fetch or to log.
 */
export function pinnedRequest(urlString, init, lookup, requestFn = https.request) {
  const options = pinnedRequestOptions(urlString, init, lookup)
  const body = init?.body
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const req = requestFn(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        if (settled) return
        const status = res.statusCode || 0
        if (status >= 300 && status < 400) {
          fail(namedError(
            'MetabaseRedirectError',
            'Metabase redirected the request, which this connector refuses.',
          ))
          return
        }
        settled = true
        const contentType = typeof res.headers?.['content-type'] === 'string'
          ? res.headers['content-type']
          : 'application/json'
        resolve(new Response(Buffer.concat(chunks), {
          status,
          headers: { 'content-type': contentType },
        }))
      })
      res.on('error', fail)
    })
    req.on('error', fail)
    if (init?.signal) {
      const onAbort = () => {
        const err = abortError()
        req.destroy(err)
        fail(err)
      }
      if (init.signal.aborted) {
        onAbort()
        return
      }
      init.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (body != null) req.write(body)
    req.end()
  })
}

/**
 * Resolve, refuse, pin, then request.
 *
 * `deps.resolvers` and `deps.request` exist so a test can supply both. The
 * callables pass neither.
 */
export async function connectMetabase(urlString, init, deps = {}) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    throw namedError('MetabaseAddressError', 'That is not a URL.')
  }
  const literal = checkBaseUrl(url.origin)
  if (!literal.ok) throw namedError('MetabaseAddressError', literal.reason)
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  const resolved = await resolvePublicHost(host, deps.resolvers)
  if (!resolved.ok) throw namedError('MetabaseAddressError', resolved.reason)
  return pinnedRequest(urlString, init, pinnedLookup(resolved.addresses), deps.request)
}

/** The admin-facing sentence for a refusal, or null when the caller should use its own. */
export function publicMetabaseError(e) {
  if (e?.name === 'MetabaseAddressError' || e?.name === 'MetabaseRedirectError') return e.message || ''
  return null
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
// ── Five, not four ───────────────────────────────────────────────────────────
//
// `rejected` was the fifth all along and had nowhere to go. On the ticket dump
// this was first pointed at, REJECTED is 853 of 31,282 rows — every one of them
// counted as 'unknown', drawn on no bar, and reported only as a caveat.
//
// It is deliberately NOT folded into `closed`. A rejected finding was not
// fixed: somebody looked at it and said it was not a real defect, or was a
// duplicate. Counting it as closed inflates every remediation figure on the
// page with work nobody did. It is terminal, though — see isTerminal — so it
// must not be counted as open either, which is the other easy mistake.
export const STATUSES = ['open', 'in_progress', 'on_hold', 'closed', 'rejected']

const STATUS_ALIASES = {
  open: ['open', 'new', 'raised', 'reported', 'pending', 'todo', 'notstarted'],
  in_progress: ['inprogress', 'progress', 'wip', 'workinprogress', 'ongoing', 'started', 'active', 'underreview'],
  on_hold: ['onhold', 'hold', 'paused', 'deferred', 'blocked', 'suspended', 'waiting', 'parked'],
  closed: ['closed', 'resolved', 'completed', 'complete', 'done', 'verified', 'fixed', 'rectified'],
  rejected: ['rejected', 'declined', 'refused', 'invalid', 'duplicate', 'notanissue', 'notavalidissue', 'wontfix', 'cancelled', 'canceled', 'withdrawn'],
}

/**
 * Statuses where nothing further is going to happen.
 *
 * The distinction that matters for every "still open" figure: closed and
 * rejected are both finished, and everything else is a queue somebody is
 * carrying. Exported because both the callable and the dashboard need the same
 * answer, and `status !== 'closed'` — which is what the code said before
 * rejected existed — now silently counts a rejected ticket as outstanding.
 */
export const TERMINAL_STATUSES = ['closed', 'rejected']
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status)

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
    auditor: cleanAuditor(out.auditor),
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
 * An auditor's name with the company glued on the end taken back off.
 *
 * Warehouse account names arrive as "Amit kumar Srivastava Curefit", which makes
 * every legend twice as wide as it needs to be for no added meaning. The
 * separator is not reliably a space — "Karthik brCurefit" is a real name in this
 * data — so the whitespace between the two is optional here. It used to be
 * required, which left exactly those names wearing the suffix while everyone
 * else lost it, and an auditor appearing twice under two spellings is worse than
 * one wearing a suffix.
 *
 * Never returns empty: a name that is nothing BUT the company is left alone,
 * because "" is not an auditor and would silently merge with every other blank.
 */
function cleanAuditor(value) {
  const name = String(value ?? '').trim()
  const trimmed = name.replace(/\s*(curefit|cultfit)$/i, '').trim()
  return trimmed || name
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

  // `extra` is dropped BEFORE the wire, and this is not a micro-optimisation:
  // measured against the live QFLS question it was 3.31MB of a 9.37MB response
  // — a THIRD of the payload — against a hard 10MB callable limit the tickets
  // question was already within 7% of. Nothing in the browser has ever read it.
  //
  // What it was for survives at a cost of nothing: `unmapped` above already
  // names the columns nothing claimed, computed from the column names rather
  // than from `extra`, and `shadowed` below names the runner-ups — the second
  // column to map onto an already-filled field, the case that used to vanish
  // silently. Both are per-RESPONSE lists of names, not per-row copies of the
  // data, which is the whole difference between 3.31MB and a few dozen bytes.
  const shadowed = new Set()
  const mapped = list.map((r) => {
    const { extra, ...row } = normalizeRow(r)
    for (const name of Object.keys(extra)) if (fieldForColumn(name)) shadowed.add(name)
    return row
  })
  return { rows: mapped, unmapped: [...unmapped], shadowed: [...shadowed] }
}

// ── The response cap ─────────────────────────────────────────────────────────
//
// A callable's response is capped at 10MB and a Metabase question can return a
// million rows. Truncating quietly would produce a dashboard that is simply
// wrong about totals, so the cap is applied here and REPORTED — the tab prints
// "showing the first N of M" above the charts, the same way analytics/index.jsx
// does for a capped Firestore read.
export const MAX_ROWS = 20000

// A row count alone was the wrong unit for a 10MB limit, and the arithmetic
// says so: measured against the live tickets question a normalized row is about
// 764 bytes, so MAX_ROWS of them is 15MB — over the limit the cap exists to stay
// under. The cap could therefore be applied in full and the response STILL fail,
// which is the one outcome it was written to prevent.
//
// So the budget is bytes, with the row count kept as a second ceiling. 8MB
// rather than 10: the rows are the bulk of the response but not all of it, and
// the remainder — per-source outcomes, the unmapped list, the bound parameters
// — has to fit in the same envelope.
export const MAX_BYTES = 8 * 1024 * 1024

export function capRows(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const kept = []
  let bytes = 0
  for (const row of list) {
    if (kept.length >= MAX_ROWS) break
    // +1 for the comma this row costs in the enclosing array.
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1
    if (bytes > MAX_BYTES) break
    kept.push(row)
  }
  return { rows: kept, total: list.length, capped: kept.length < list.length }
}
