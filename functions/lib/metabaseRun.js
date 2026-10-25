// ─────────────────────────────────────────────────────────────────────────────
// Run one of the datasets the ODIN dashboard already asks for.
//
// metabaseQuery and the site-lookup bot both call queryDataset. The URL
// check, the pinned DNS lookup, the date-parameter binding, the row
// normalisation and the response cap live here once. A second HTTP client
// would be a second place to forget redirect: 'error' or the private-address
// refusal, which is the SSRF guard this connector exists to keep.
//
// `deps` is how a test supplies resolvers and a socket without dialling.
// The callables pass none, and connectMetabase then uses real DNS.
// ─────────────────────────────────────────────────────────────────────────────
import {
  buildDateParams,
  capRows,
  cardQueryUrl,
  cardUrl,
  checkBaseUrl,
  connectMetabase,
  metabaseRequestInit,
  normalizeRows,
  publicMetabaseError,
  readiness,
  sourcesFor,
} from './metabase.js'

/**
 * How long we will wait on someone else's Metabase before giving up on it.
 *
 * A hundred seconds, not the twenty-five this used to be. Twenty-five is a
 * sensible wait for a web request and a hopeless one for a warehouse query: the
 * two questions this was first pointed at take thirty to sixty seconds for a
 * single month of data, so every real load timed out and reported "Metabase did
 * not answer in time" about an instance that was working perfectly.
 *
 * The ceiling is the callable's own 300s budget — this has to expire first, or
 * the caller gets a transport error instead of the diagnosis below.
 *
 * 280s, not 100s, because 100s was not a timeout so much as a cap on how much
 * history anyone could ask for. Timed against the live questions: the tickets
 * question answers a 90-day window in 4 seconds and a 365-day window in 227.
 * At 100s the second one could not complete, so widening the date pickers
 * returned "Metabase did not answer in time" rather than the year of data the
 * reader had just asked for — a filter that appears to work and cannot.
 */
export const METABASE_TIMEOUT_MS = 280_000

const noopLogger = { info() {}, warn() {}, error() {} }

const loggerOf = (opts) => opts?.logger || noopLogger

function timeoutMessage(timeoutMs, range) {
  const seconds = Math.round((timeoutMs || METABASE_TIMEOUT_MS) / 1000)
  const window = range ? ` for ${range.from} to ${range.to}` : ''
  return `Metabase did not answer within ${seconds} seconds${window}. Try a shorter date range.`
}

/**
 * Ask Metabase, with a timeout, and without ever putting the key in a URL.
 *
 * The key travels in the `x-api-key` header. A query parameter would land in
 * the instance's access log, in any proxy in front of it, and in the referrer
 * of whatever it redirects to. Redirects are refused outright.
 *
 * connectMetabase resolves the host and pins the socket to the addresses that
 * passed. global fetch would look the name up again as it connected, which is
 * the gap between a check and a dial.
 *
 * `signal` is an outer deadline (the site lookup has one, so a slow warehouse
 * cannot swallow the rest of the reply). It aborts the same request the
 * timeout does. `deps` is the test seam connectMetabase already documents.
 */
export async function metabaseFetch(url, apiKey, {
  method = 'GET',
  body,
  timeoutMs = METABASE_TIMEOUT_MS,
  deps,
  signal,
} = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await connectMetabase(
      url,
      metabaseRequestInit(apiKey, { method, body, signal: controller.signal }),
      deps,
    )
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    clearTimeout(timer)
  }
}

/**
 * Turn a Metabase failure into something an admin can act on.
 *
 * The instance's own error body is deliberately NOT forwarded: it can quote the
 * SQL of the question, which names tables and columns in a warehouse the member
 * reading this dashboard has no business seeing. The status code is the
 * actionable part, and it is enough to tell "your key is wrong" apart from
 * "that question no longer exists".
 */
export function metabaseFailure(status) {
  if (status === 401 || status === 403) {
    return 'Metabase rejected the API key. Check it has not been revoked, and that its permission group can read the question.'
  }
  if (status === 404) return 'Metabase has no saved question with that ID.'
  if (status === 429) return 'Metabase is rate-limiting these requests. Try again shortly.'
  if (status >= 500) return 'Metabase returned a server error while running the question.'
  return `Metabase refused the request (HTTP ${status}).`
}

/** What the client is told about each instance. Never a URL it did not configure. */
const outcomes = (results) =>
  results.map((r) => ({
    id: r.id,
    label: r.label,
    ok: r.ok,
    rows: r.rows?.length ?? 0,
    reason: r.reason,
    message: r.message,
    // Present only for an admin — querySource decides, this just carries it.
    ...(r.detail ? { detail: r.detail } : {}),
  }))

/**
 * One instance, one question.
 *
 * Never throws: a source that is down is a RESULT, because the whole point of
 * running several is that one of them failing does not take the dashboard with
 * it. Rows come back tagged with where they came from, so a figure on the
 * dashboard can be traced to the instance that produced it.
 */
async function querySource(source, dataset, orgId, detailed = false, range = null, opts = {}) {
  const logger = loggerOf(opts)
  const timeoutMs = opts.timeoutMs || METABASE_TIMEOUT_MS
  const tag = { id: source.id, label: source.label || source.baseUrl }
  // Metabase's own account of a failure, for an admin only. `detail` is what
  // turns "server error" into something fixable — a missing required
  // parameter, a column that no longer exists, a permission on the underlying
  // database rather than on the question.
  const withDetail = async (base, response) => {
    if (!detailed || !response) return base
    try {
      const body = await response.text()
      if (!body) return base
      let text = body
      try {
        const j = JSON.parse(body)
        text = j?.message || j?.error || j?.error_message || body
      } catch {
        /* not JSON — the raw body is what there is */
      }
      const detail = String(text).replace(/\s+/g, ' ').trim().slice(0, 500)
      return detail ? { ...base, detail } : base
    } catch {
      return base
    }
  }

  const url = checkBaseUrl(source.baseUrl)
  if (!url.ok) return { ...tag, ok: false, reason: 'bad-url', message: url.reason }

  // ── The date range ─────────────────────────────────────────────────────────
  //
  // Discovering the question's parameters costs one extra request, and skipping
  // it is not an option: a question that declares required date variables — as
  // both of the ones this was built against do — answers a bare POST with
  // "missing required parameters" and nothing else. So the shape is fetched,
  // cached for the life of this instance, and the range bound to it.
  //
  // A failure here is NOT fatal. If the question cannot be described, the query
  // runs the way it always did; a question with no date parameters is
  // unaffected either way, and one that needs them will report its own error
  // in a moment, which is a better message than anything invented here.
  const cardId = source.cards[dataset]
  let bound = []
  let parameters = []
  let undescribed = false
  if (range) {
    try {
      const card = await describeCard(url.origin, cardId, source.apiKey, opts)
      if (card) ({ parameters, bound } = buildDateParams(card, range))
      else undescribed = true
    } catch (e) {
      const explained = publicMetabaseError(e)
      if (explained) return { ...tag, ok: false, reason: 'bad-url', message: explained }
      // The outer deadline and the per-request timeout both abort. That is not
      // an expired key: saying so sent people to rotate a credential that was
      // fine, while the warehouse was simply slow. The query path below uses
      // the same sentence for the same abort.
      if (e?.name === 'AbortError') {
        logger.warn('metabaseQuery: unreachable', {
          orgId,
          dataset,
          source: source.id,
          error: e?.message || String(e),
        })
        return {
          ...tag,
          ok: false,
          reason: 'unreachable',
          message: timeoutMessage(timeoutMs, range),
        }
      }
      undescribed = true
      logger.warn('metabaseQuery: could not describe card', {
        orgId,
        dataset,
        source: source.id,
        error: e?.message || String(e),
      })
    }
  }

  // ── Do not send a request we already know cannot succeed ───────────────────
  //
  // If the shape could not be read, any question with required date variables
  // answers with "missing required parameters: #{"ed" "sd"}" — Metabase naming
  // template tags nobody outside the SQL has heard of. The cause is almost
  // always that the GET which reads those tags was refused, and the commonest
  // reason for that is an expired API key. So say THAT instead, and say it
  // before spending a warehouse query on a certain failure.
  if (undescribed) {
    logger.warn('metabaseQuery: shape unknown, refusing to run unbound', {
      orgId,
      dataset,
      source: source.id,
      cardId,
    })
    return {
      ...tag,
      ok: false,
      reason: 'refused',
      message:
        'Could not read the question\u2019s parameters from Metabase, so its date variables ' +
        'cannot be filled in \u2014 the usual cause is an expired API key. Update the key in the ' +
        'Connection settings and run this again.',
    }
  }

  // ── One retry, and only on a 5xx ───────────────────────────────────────────
  //
  // A big warehouse question does not fail cleanly. Both of these come back
  // with "Encountered too many errors talking to a worker node" — a Trino
  // worker falling over under load — perhaps one run in five, and the identical
  // request succeeds moments later. Surfacing that as "Metabase returned a
  // server error" is technically true and leaves a dashboard randomly blank.
  //
  // Only 5xx is retried. A 401 is an expired key and a 404 is a deleted
  // question: both fail the same way twice, and retrying them doubles the wait
  // before the reader is told something they need to act on.
  const post = () =>
    metabaseFetch(cardQueryUrl(url.origin, cardId), source.apiKey, {
      method: 'POST',
      timeoutMs,
      deps: opts.deps,
      signal: opts.signal,
      // Only when there is something to send. An empty body is what this always
      // sent, and a question with no parameters must keep behaving identically.
      ...(parameters.length ? { body: { parameters } } : {}),
    })

  let res
  try {
    res = await post()
    if (res.status >= 500) {
      logger.info('metabaseQuery: retrying after a server error', {
        orgId,
        dataset,
        source: source.id,
        status: res.status,
      })
      res = await post()
    }
  } catch (e) {
    const explained = publicMetabaseError(e)
    if (explained) return { ...tag, ok: false, reason: 'bad-url', message: explained }
    logger.warn('metabaseQuery: unreachable', {
      orgId,
      dataset,
      source: source.id,
      error: e?.message || String(e),
    })
    return {
      ...tag,
      ok: false,
      reason: 'unreachable',
      // Naming the window matters: the usual cause is a range too wide for the
      // question, and "did not answer in time" alone sends people to look at
      // the network instead of at the date pickers.
      message: e?.name === 'AbortError' ? timeoutMessage(timeoutMs, range) : 'Could not reach Metabase.',
    }
  }
  if (!res.ok) {
    logger.warn('metabaseQuery: refused', { orgId, dataset, source: source.id, status: res.status })
    return withDetail(
      { ...tag, ok: false, reason: 'refused', message: metabaseFailure(res.status) },
      res
    )
  }

  let payload
  try {
    payload = await res.json()
  } catch {
    return { ...tag, ok: false, reason: 'query-failed', message: 'Metabase did not return JSON.' }
  }
  // /query/json answers with an array of row objects on success. Anything else
  // is Metabase reporting a failed query inside a 200, which it does.
  if (!Array.isArray(payload)) {
    logger.warn('metabaseQuery: query error', { orgId, dataset, source: source.id })
    // The generic line for everyone; Metabase's own words only for an admin.
    // This used to hand that text to every caller, which is the schema leak the
    // rest of this function is careful about.
    const base = {
      ...tag,
      ok: false,
      reason: 'query-failed',
      message: 'Metabase could not run that question.',
    }
    const detail = String(payload?.error || payload?.message || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
    return detailed && detail ? { ...base, detail } : base
  }

  const mapped = normalizeRows(payload)
  return {
    ...tag,
    ok: true,
    rows: mapped.rows.map((r) => ({ ...r, sourceId: tag.id, sourceLabel: tag.label })),
    unmapped: mapped.unmapped,
    shadowed: mapped.shadowed,
    bound: bound.map((x) => ({ ...x, source: tag.id })),
  }
}

/**
 * A saved question's shape — its parameters, mostly — cached per instance.
 *
 * The parameters of a saved question change when somebody edits the question,
 * which is rare, and a Cloud Function instance lives minutes to hours. Caching
 * for that lifetime turns one extra round trip per dashboard load into one per
 * cold start; an edit is picked up the next time an instance starts, and the
 * worst case in between is a query refused for a parameter that moved, which
 * reports itself.
 *
 * Null on any failure — never throws, because a question that cannot be
 * described can still very often be run.
 */
const cardShapeCache = new Map()

/** Tests isolate the cache. Production never calls this. */
export function clearMetabaseCaches() {
  cardShapeCache.clear()
}

async function describeCard(origin, cardId, apiKey, opts = {}) {
  // Keyed by the KEY as well as the card, so a rotation cannot be served a
  // shape fetched under the old one. These keys expire every three days on the
  // instance this was built against, and a cache that outlives the credential
  // it was filled with is a cache that goes on being wrong after the fix.
  const key = `${origin}#${cardId}#${fingerprint(apiKey)}`
  if (cardShapeCache.has(key)) return cardShapeCache.get(key)

  // ── Only SUCCESS is cached ─────────────────────────────────────────────────
  //
  // This used to cache the failure too, and that turned one bad moment into a
  // permanent one: an expired key made this 401, null went into the map, and
  // every query from that instance then ran with NO parameters bound — long
  // after the key was replaced. The question answers a bare POST with "missing
  // required parameters: #{"ed" "sd"}", which names neither the key nor the
  // cache, so nothing about the message points at what actually broke.
  //
  // A failure now simply returns null and is retried next time.
  const timeoutMs = opts.timeoutMs || METABASE_TIMEOUT_MS
  let card = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await metabaseFetch(cardUrl(origin, cardId), apiKey, {
        timeoutMs,
        deps: opts.deps,
        signal: opts.signal,
      })
      if (res.ok) {
        const body = await res.json()
        // Only the parameters are kept. The rest of a card document is the query
        // itself — the warehouse's schema — and there is no reason to hold it.
        card = { parameters: Array.isArray(body?.parameters) ? body.parameters : [] }
        break
      }
      // A 5xx here is the same flaky warehouse the query itself retries past.
      // A 401 or 404 will fail identically twice, so it is not retried.
      if (res.status < 500) break
    } catch (e) {
      // A private address or a redirect is not a flaky warehouse. Retrying it
      // would dial again, and swallowing it makes the next step blame the key.
      // An abort is the same shape: the deadline already fired, and a second
      // attempt would spend it again.
      if (publicMetabaseError(e) || e?.name === 'AbortError') throw e
    }
  }
  if (card) cardShapeCache.set(key, card)
  return card
}

/** A short, non-reversible tag for a credential, so it can be a cache key. */
function fingerprint(secret) {
  let h = 5381
  const s = String(secret || '')
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/**
 * Run one configured dataset across every source that has it, and merge.
 *
 * This is the body of the metabaseQuery callable, minus the caller's identity.
 * The site lookup uses it for the same two dataset names (`audits`, `findings`)
 * over the same default window. A caller cannot pass a card id or a URL: the
 * only questions reachable are the ones an admin saved on the connection.
 *
 * Never throws. A refusal from the SSRF guard is a result with reason
 * `bad-url`, and the socket is not opened.
 */
export async function queryDataset(config, dataset, opts = {}) {
  const logger = loggerOf(opts)
  const orgId = opts.orgId || ''
  const range = opts.range || null
  const detailed = opts.detailed === true
  const ready = readiness(config, dataset)
  if (!ready.ok) return { ok: false, reason: ready.reason, dataset }

  // Every instance that has this question, asked at once. In parallel because
  // they are independent hosts and the slowest one should set the wait, not the
  // sum of them.
  const targets = sourcesFor(config, dataset)
  const results = await Promise.all(
    targets.map((source) => querySource(source, dataset, orgId, detailed, range, opts))
  )

  const answered = results.filter((r) => r.ok)
  if (answered.length === 0) {
    // Everything failed. The first failure's reason is returned so the tab can
    // still show a specific screen, with every source's own outcome beside it.
    const first = results[0] || { reason: 'unreachable' }
    logger.warn('metabaseQuery: every source failed', {
      orgId,
      dataset,
      sources: results.length,
    })
    return {
      ok: false,
      reason: first.reason,
      message: first.message,
      dataset,
      ...(first.detail ? { detail: first.detail } : {}),
      sources: outcomes(results),
    }
  }

  // Merged, then capped — the cap is on what the browser is sent, and applying
  // it per source would let a two-instance tenant receive twice as much as a
  // one-instance tenant before anything said the figures were partial.
  const merged = answered.flatMap((r) => r.rows)
  const { rows, total, capped } = capRows(merged)
  const unmapped = [...new Set(answered.flatMap((r) => r.unmapped))]
  // Columns that mapped onto a field another column had already filled. Carried
  // separately from `unmapped` because the fix differs: an unmapped column needs
  // a name ODIN knows, a shadowed one already has it and is losing a fight.
  const shadowed = [...new Set(answered.flatMap((r) => r.shadowed || []))]
  return {
    ok: true,
    dataset,
    range,
    bound: answered.flatMap((r) => r.bound || []),
    rows,
    unmapped,
    shadowed,
    total,
    capped,
    // Per source, always — including when they all succeeded. "These numbers
    // are from two of your three instances" is a caveat the dashboard has to be
    // able to print, and it cannot if only failures are reported.
    sources: outcomes(results),
  }
}
