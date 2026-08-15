// ─────────────────────────────────────────────────────────────────────────────
// What a client is told when something goes wrong, and what it is never told.
//
// The client gets a stable machine-readable CODE and a request id. It does not
// get the message, the stack, the collection name, or which of several checks
// refused it. Two of those leak more than they look like they do:
//
//   - A stack trace names the file layout of a server whose whole job is to be
//     the authorization boundary. It is a map for the next attempt.
//   - body-parser's own SyntaxError quotes A FRAGMENT OF THE REQUEST BODY back
//     in `err.message`. On this system a request body carries injuries,
//     illnesses and named people, so echoing a parse error verbatim is how
//     health data ends up in a browser console, a Sentry breadcrumb, or a
//     screenshot in a support ticket.
//
// The detail is not lost — it goes to the log with the same request id, so an
// operator can join the two. That is the whole trade: the person who can read
// the logs gets everything, the caller gets a code.
//
// One inherited lesson from firestore.rules, which is stricter than it looks:
// a validation failure must not be dressed up as a business outcome. A QR
// defect report that was REFUSED once came back as "already reported", so for
// a day the reporters were told the system had their report and the system had
// nothing (firestore.rules:96-104). Codes here say what happened.
// ─────────────────────────────────────────────────────────────────────────────
import { log } from './log.js'

/**
 * An error a route raises on purpose, with the code the caller should see.
 *
 * `detail` is for the log only and never reaches the response — that split is
 * the point of the class, and why routes should not throw bare Errors when
 * they already know what to say.
 */
export class ApiError extends Error {
  constructor(status, code, detail) {
    super(detail || code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.expose = true
  }
}

/**
 * Map the errors body-parser raises before any route runs.
 *
 * These arrive with a `type` and a status already set. Without this they would
 * fall through to the 500 branch, and a client sending slightly malformed JSON
 * would be told the server had crashed — sending it into a retry loop against
 * a request that can never succeed.
 */
function fromBodyParser(err) {
  switch (err?.type) {
    case 'entity.parse.failed':
      return { status: 400, code: 'invalid_json' }
    case 'entity.too.large':
      return { status: 413, code: 'payload_too_large' }
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, code: 'unsupported_encoding' }
    case 'request.aborted':
      return { status: 400, code: 'request_aborted' }
    default:
      return null
  }
}

/**
 * Nothing matched. Deliberately a 404 and not a 405 or a hint.
 *
 * Reached only after the auth middleware for anything under the API prefix, so
 * an unauthenticated caller cannot use the difference between 404 and 401 to
 * map which routes exist.
 */
export function notFoundHandler(req, res, next) {
  next(new ApiError(404, 'not_found'))
}

/**
 * The last handler in the chain. Four arguments, or Express does not treat it
 * as an error handler and every failure becomes the default HTML page — which
 * prints the stack in a non-production NODE_ENV.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies this by arity; `next` must stay.
export function errorHandler(err, req, res, next) {
  const mapped = fromBodyParser(err)
  const known = mapped || (err instanceof ApiError ? { status: err.status, code: err.code } : null)
  const status = known?.status || 500
  const code = known?.code || 'internal'
  const requestId = res.locals?.requestId

  const fields = {
    requestId,
    status,
    code,
    method: req.method,
    // The PATH only. A query string on this system can carry a document id or
    // a person's name, and a log line is a copy of it that outlives the request.
    path: req.path,
    uid: req.caller?.uid,
    // NOT err.message when body-parser raised it. Its parse errors quote the
    // request body back — "Unexpected token } ... while parsing '{"note":"…'"
    // — and it also hangs the WHOLE body off err.body. Logging that message
    // moves a payload that may name a person and their injury into a log
    // nobody thinks of as clinical. The type says what went wrong; the body
    // is not evidence of anything.
    detail: mapped ? err?.type : err?.message,
  }

  if (status >= 500) {
    // The stack goes to the log and only to the log. It is the one place it is
    // both safe and useful.
    log.error('request failed', { ...fields, stack: err?.stack })
  } else {
    log.warn('request refused', fields)
  }

  // Headers already flushed means a route started streaming and then failed.
  // Writing a second body corrupts the first response; Express's default
  // handler destroys the socket instead, which is the honest outcome.
  if (res.headersSent) return next(err)

  res.status(status).json({ error: { code, requestId } })
}
