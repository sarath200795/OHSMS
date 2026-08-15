import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiError, errorHandler, notFoundHandler } from './errors.js'

const makeReq = (over = {}) => ({ method: 'POST', path: '/v1/inspections', ...over })

const makeRes = () => {
  const res = { locals: { requestId: 'req-1' }, headersSent: false, statusCode: null, body: null }
  res.status = (code) => ((res.statusCode = code), res)
  res.json = (body) => ((res.body = body), res)
  return res
}

const parseError = (body) =>
  Object.assign(new SyntaxError(`Unexpected token } while parsing '${body}'`), {
    type: 'entity.parse.failed',
    status: 400,
    // body-parser hangs the WHOLE request body off the error, which is the
    // half of this that a naive logger would ship somewhere.
    body,
  })

let lines
beforeEach(() => {
  lines = []
  const capture = (line) => lines.push(JSON.parse(line))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})
afterEach(() => vi.restoreAllMocks())

// ─────────────────────────────────────────────────────────────────────────────

describe('what a caller is told', () => {
  it('answers with a code and the request id, and nothing else', () => {
    const res = makeRes()
    errorHandler(new ApiError(404, 'not_found'), makeReq(), res, vi.fn())

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: { code: 'not_found', requestId: 'req-1' } })
  })

  // A stack trace maps the file layout of the process whose entire job is to
  // be the authorization boundary. It is a head start on the next attempt.
  it('never sends a stack, a message or an internal name', () => {
    const err = new Error('getDb failed on organizations/orgA/injuries')
    const res = makeRes()

    errorHandler(err, makeReq(), res, vi.fn())

    const sent = JSON.stringify(res.body)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: { code: 'internal', requestId: 'req-1' } })
    expect(sent).not.toContain('getDb')
    expect(sent).not.toContain('injuries')
    expect(sent).not.toContain('at ')
    expect(sent).not.toContain('errors.js')
  })

  it('does not let an unrecognised error choose its own status', () => {
    // A thrown object with a status of 200 — or 302, or 401 — must not become
    // the response. Only ApiError and body-parser get to decide.
    const res = makeRes()
    errorHandler(Object.assign(new Error('nope'), { status: 200 }), makeReq(), res, vi.fn())
    expect(res.statusCode).toBe(500)
  })
})

describe('the errors body-parser raises before any route runs', () => {
  it.each([
    ['entity.parse.failed', 400, 'invalid_json'],
    ['entity.too.large', 413, 'payload_too_large'],
    ['encoding.unsupported', 415, 'unsupported_encoding'],
    ['charset.unsupported', 415, 'unsupported_encoding'],
    ['request.aborted', 400, 'request_aborted'],
  ])('turns %s into %i %s', (type, status, code) => {
    const res = makeRes()
    errorHandler(Object.assign(new Error('x'), { type }), makeReq(), res, vi.fn())
    expect(res.statusCode).toBe(status)
    expect(res.body.error.code).toBe(code)
  })

  // Without this they fall to the 500 branch, and a client sending slightly
  // wrong JSON is told the server crashed — which sends it into a retry loop
  // against a request that can never succeed.
  it('does not report a client mistake as a server failure', () => {
    const res = makeRes()
    errorHandler(parseError('{"a":'), makeReq(), res, vi.fn())
    expect(res.statusCode).toBe(400)
    expect(lines.at(-1).severity).toBe('WARNING')
  })

  // THE LEAK THIS EXISTS TO CLOSE. body-parser quotes the request body back in
  // its own message. On this system a body carries injuries, illnesses and
  // named people, so logging that message verbatim moves clinical data into a
  // log nobody thinks of as clinical — and sending it back puts it in a
  // browser console and every screenshot of one.
  it('logs neither the body nor the message that quotes it', () => {
    const res = makeRes()
    const body = '{"note":"crush injury, left hand, R. Menon"'

    errorHandler(parseError(body), makeReq(), res, vi.fn())

    const written = JSON.stringify(lines)
    expect(written).not.toContain('R. Menon')
    expect(written).not.toContain('crush injury')
    expect(JSON.stringify(res.body)).not.toContain('R. Menon')
    // What it logs instead is the kind of failure, which is all an operator
    // needs to know the caller sent malformed JSON.
    expect(lines.at(-1).detail).toBe('entity.parse.failed')
  })
})

describe('what the operator is told', () => {
  it('logs the stack, the request id and the caller for a 500', () => {
    const err = new Error('boom')
    errorHandler(err, makeReq({ caller: { uid: 'u1' } }), makeRes(), vi.fn())

    expect(lines.at(-1)).toMatchObject({
      severity: 'ERROR',
      requestId: 'req-1',
      status: 500,
      code: 'internal',
      method: 'POST',
      path: '/v1/inspections',
      uid: 'u1',
      detail: 'boom',
    })
    expect(lines.at(-1).stack).toContain('boom')
  })

  it('logs a refusal at WARNING, not ERROR — a 404 is not a page', () => {
    errorHandler(new ApiError(404, 'not_found'), makeReq(), makeRes(), vi.fn())
    expect(lines.at(-1).severity).toBe('WARNING')
    expect(lines.at(-1).stack).toBeUndefined()
  })

  // A query string on this system carries document ids and people's names, and
  // a log line is a copy of it that outlives the request.
  it('logs the path and not the query string', () => {
    const req = makeReq({ path: '/v1/injuries', originalUrl: '/v1/injuries?person=R.%20Menon' })
    errorHandler(new Error('boom'), req, makeRes(), vi.fn())

    expect(lines.at(-1).path).toBe('/v1/injuries')
    expect(JSON.stringify(lines)).not.toContain('Menon')
  })
})

describe('when the response has already started', () => {
  // A route that streamed and then failed. Writing a second body corrupts the
  // first; Express's default handler destroys the socket, which is honest.
  it('hands the error on rather than writing over a live response', () => {
    const res = makeRes()
    res.headersSent = true
    const next = vi.fn()
    const err = new Error('boom')

    errorHandler(err, makeReq(), res, next)

    expect(next).toHaveBeenCalledWith(err)
    expect(res.body).toBeNull()
    // Still logged, because that is the request an operator most wants to see.
    expect(lines.at(-1).severity).toBe('ERROR')
  })
})

describe('nothing matched', () => {
  it('raises a 404 rather than answering one, so it lands in the same handler', () => {
    const next = vi.fn()
    notFoundHandler(makeReq(), makeRes(), next)

    const raised = next.mock.calls[0][0]
    expect(raised).toBeInstanceOf(ApiError)
    expect(raised.status).toBe(404)
    expect(raised.code).toBe('not_found')
  })
})

describe('ApiError', () => {
  it('keeps the detail for the log and the code for the caller', () => {
    const err = new ApiError(403, 'forbidden', 'role is auditor, isWriterOf denies')
    expect(err.status).toBe(403)
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe('role is auditor, isWriterOf denies')

    const res = makeRes()
    errorHandler(err, makeReq(), res, vi.fn())
    expect(JSON.stringify(res.body)).not.toContain('auditor')
    expect(lines.at(-1).detail).toBe('role is auditor, isWriterOf denies')
  })
})
