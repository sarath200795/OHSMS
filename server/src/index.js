// ─────────────────────────────────────────────────────────────────────────────
// The API server.
//
// WHAT THIS IS. The process that will own WRITES for WEHS/OHSMS, so that
// authorization stops being Firestore-specific. Today the browser writes
// straight to Firestore and firestore.rules — 1064 lines, ~20 match blocks,
// ~58 allow rules — is the only thing standing between a tenant and everybody
// else's data.
//
// WHAT THIS IS NOT. It does not own reads. The 61 onSnapshot listeners in the
// app stay exactly where they are, still governed by firestore.rules, because
// that is what makes the screens live. And it does not own writes yet either:
// one module moves at a time, and everything not yet moved keeps writing
// directly and must keep working (strangler fig — README.md).
//
// The middleware order below is the security model in miniature, so it is
// worth reading top to bottom rather than skimming:
//
//   requestId   → every log line and every error body carries the same id
//   json        → a bounded body, before anything allocates on a caller's word
//   requireAuth → a verified ID token; attaches a uid and nothing else
//   requireProfile → the LIVE /users profile, read every request; fails closed
//   apiRouter   → module routes, mounted one migrated module at a time
//   notFound    → after auth, so 404-vs-401 cannot be used to map the surface
//   errorHandler→ a code and a request id to the caller, the detail to the log
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import express from 'express'
import { requireAuth } from './auth.js'
import { requireProfile } from './authz/index.js'
import { errorHandler, notFoundHandler } from './errors.js'
import { log } from './log.js'
import { apiRouter } from './routes/index.js'

/** Cloud Run's own default, and what it sets PORT to unless told otherwise. */
const DEFAULT_PORT = 8080

/** How long a shutting-down instance waits for in-flight requests. */
const SHUTDOWN_GRACE_MS = 10_000

export const HEALTH_PATH = '/healthz'
export const API_PREFIX = '/v1'

/**
 * The largest JSON body accepted.
 *
 * 1 MiB because a Firestore document cannot exceed 1 MiB — a body bigger than
 * this cannot become one, so accepting it only buys the server the chance to
 * run out of memory holding it. Overridable because a future batch endpoint
 * may need a different answer, and that decision should be an env var and a
 * conversation rather than a code change under time pressure.
 */
const jsonLimit = () => process.env.JSON_BODY_LIMIT || '1mb'

/**
 * Give every request an id, echo it, and put it where the handlers can find it.
 *
 * DELIBERATELY IGNORES an inbound X-Request-Id. Honouring one lets any caller
 * choose what their entries are filed under — colliding them with someone
 * else's, or repeating a single id until the logs are useless. The id is ours;
 * the caller gets told what it is.
 */
function requestId(req, res, next) {
  res.locals.requestId = randomUUID()
  res.set('x-request-id', res.locals.requestId)
  next()
}

/**
 * Liveness. No auth, by design — a probe has no credential to present, and a
 * health check that needed one would report a broken Firebase as a dead
 * container.
 *
 * It also does NOT touch Firestore, for the mirror-image reason: a health
 * check that queries the database turns a slow database into a failed
 * revision. Cloud Run would kill and restart every instance, removing the
 * capacity that might have worked through the backlog. This answers one
 * question — is this process up and serving — and nothing else.
 */
function health(req, res) {
  res.json({ status: 'ok', service: 'ohsms-server', uptime: Math.round(process.uptime()) })
}

export function createApp() {
  const app = express()

  // Says "Express" to anyone scanning. It tells an attacker which CVE list to
  // work through and tells a legitimate caller nothing.
  app.disable('x-powered-by')

  app.use(requestId)

  app.get(HEALTH_PATH, health)

  // Parsed before auth so that the anonymous QR surface — when it is built —
  // slots in above requireAuth with the same bounded body. The limit is what
  // makes parsing before authentication safe: without it this line would let
  // an anonymous caller decide how much memory to allocate.
  app.use(express.json({ limit: jsonLimit() }))

  // Everything from here down needs a caller. Applied with app.use rather than
  // per-router so that a route added later cannot be unauthenticated by
  // omission — the failure mode of a mistake is a 401, not an open endpoint.
  // A genuinely anonymous router must be mounted ABOVE this line, on purpose,
  // with its own exhaustive validation (see src/routes/index.js).
  app.use(requireAuth)
  app.use(requireProfile)

  app.use(API_PREFIX, apiRouter)

  app.use(notFoundHandler)

  app.use(errorHandler)

  return app
}

/** Start listening, and stop cleanly when Cloud Run says to. */
export function start(port = Number(process.env.PORT) || DEFAULT_PORT) {
  const server = createApp().listen(port, () => {
    log.info('server listening', { port, emulated: Boolean(process.env.FIRESTORE_EMULATOR_HOST) })
  })

  // Cloud Run sends SIGTERM and then kills the container. Without a handler,
  // Node's default is to exit immediately, cutting every in-flight request —
  // and on this server an in-flight request may be a half-finished write.
  const stop = (signal) => {
    log.info('shutting down', { signal })
    const forced = setTimeout(() => {
      log.warn('shutdown timed out, exiting anyway', { graceMs: SHUTDOWN_GRACE_MS })
      process.exit(1)
    }, SHUTDOWN_GRACE_MS)
    forced.unref()
    server.close(() => process.exit(0))
  }

  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))

  return server
}

// Only when run as the entry point. Importing this file — which every test
// does — must not open a socket.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  start()
}
