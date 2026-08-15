import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const verifyIdToken = vi.fn()
vi.mock('./firestore.js', () => ({ getAdminAuth: () => ({ verifyIdToken }) }))

const { requireAuth, bearerToken, reasonFor } = await import('./auth.js')

// ── Stand-ins ────────────────────────────────────────────────────────────────

const makeReq = (headers = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { method: 'POST', path: '/v1/inspections', get: (name) => lower[name.toLowerCase()] }
}

const makeRes = () => {
  const res = { locals: { requestId: 'req-1' }, statusCode: null, body: null }
  res.status = (code) => ((res.statusCode = code), res)
  res.json = (body) => ((res.body = body), res)
  return res
}

const authError = (code) => Object.assign(new Error(`firebase said: ${code}`), { code })

/** Every line this middleware wrote, parsed back out of the console. */
let lines
beforeEach(() => {
  lines = []
  verifyIdToken.mockReset()
  const capture = (line) => lines.push(JSON.parse(line))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})
afterEach(() => vi.restoreAllMocks())

// ─────────────────────────────────────────────────────────────────────────────

describe('reading the Authorization header', () => {
  it('takes the token out of a well-formed Bearer header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toEqual({ token: 'abc.def.ghi' })
  })

  // RFC 7235 makes the scheme case-insensitive. A client sending `bearer` is
  // not an attacker and should not spend an afternoon on a blank 401.
  it('accepts the scheme in any case, and extra spacing', () => {
    expect(bearerToken('bearer abc').token).toBe('abc')
    expect(bearerToken('BEARER   abc').token).toBe('abc')
    expect(bearerToken('  Bearer abc  ').token).toBe('abc')
  })

  it('names a missing header differently from a broken one', () => {
    expect(bearerToken(undefined)).toEqual({ reason: 'no_authorization_header' })
    expect(bearerToken('')).toEqual({ reason: 'no_authorization_header' })
    expect(bearerToken('Basic dXNlcjpwYXNz')).toEqual({ reason: 'malformed_authorization_header' })
    expect(bearerToken('abc.def.ghi')).toEqual({ reason: 'malformed_authorization_header' })
    expect(bearerToken('Bearer')).toEqual({ reason: 'malformed_authorization_header' })
    expect(bearerToken('Bearer ')).toEqual({ reason: 'malformed_authorization_header' })
  })

  // A JWT has no spaces. Catching it here keeps `Bearer undefined extra` from
  // becoming a network round trip to Firebase.
  it('refuses a token with whitespace in it rather than asking Firebase', () => {
    expect(bearerToken('Bearer abc def')).toEqual({ reason: 'malformed_authorization_header' })
  })

  it('survives a header that is not a string', () => {
    expect(bearerToken(['Bearer abc'])).toEqual({ reason: 'malformed_authorization_header' })
  })
})

describe('naming the failure for the log', () => {
  // These four collapse to the same 401 for the caller and must NOT collapse
  // in the log: "expired, refresh it" is a client bug, "revoked" is a session
  // somebody killed on purpose, and telling them apart afterwards is
  // impossible if the server wrote the same line for both.
  it('distinguishes expired, revoked, disabled and malformed', () => {
    expect(reasonFor(authError('auth/id-token-expired'))).toBe('token_expired')
    expect(reasonFor(authError('auth/id-token-revoked'))).toBe('token_revoked')
    expect(reasonFor(authError('auth/session-cookie-revoked'))).toBe('token_revoked')
    expect(reasonFor(authError('auth/user-disabled'))).toBe('user_disabled')
    expect(reasonFor(authError('auth/argument-error'))).toBe('token_malformed')
    expect(reasonFor(authError('auth/invalid-id-token'))).toBe('token_malformed')
  })

  it('has an answer for something it has never seen', () => {
    expect(reasonFor(authError('auth/internal-error'))).toBe('verification_failed')
    expect(reasonFor(new Error('network down'))).toBe('verification_failed')
    expect(reasonFor(undefined)).toBe('verification_failed')
  })
})

describe('refusing a caller', () => {
  const cases = [
    ['no header at all', {}, 'no_authorization_header'],
    ['a header that is not Bearer', { authorization: 'Basic x' }, 'malformed_authorization_header'],
  ]

  it.each(cases)('refuses %s with one generic 401', async (_label, headers, reason) => {
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(makeReq(headers), res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: { code: 'unauthenticated', requestId: 'req-1' } })
    expect(lines.at(-1)).toMatchObject({ severity: 'WARNING', reason })
    // Firebase was never asked about a header that could not hold a token.
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it.each([
    ['auth/id-token-expired', 'token_expired'],
    ['auth/id-token-revoked', 'token_revoked'],
    ['auth/argument-error', 'token_malformed'],
    ['auth/user-disabled', 'user_disabled'],
  ])('refuses a %s token, logging it as %s', async (code, reason) => {
    verifyIdToken.mockRejectedValue(authError(code))
    const res = makeRes()
    const next = vi.fn()

    await requireAuth(makeReq({ authorization: 'Bearer abc.def.ghi' }), res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    // The same body every time. Which check refused, and why, is the server's
    // business — a caller that can tell "expired" from "revoked" from
    // "malformed" can use this endpoint to probe.
    expect(res.body).toEqual({ error: { code: 'unauthenticated', requestId: 'req-1' } })
    expect(lines.at(-1)).toMatchObject({ severity: 'WARNING', reason, code })
  })

  // The rule the whole file exists under: an ID token in a log is a credential
  // in a log. Not truncated, not prefixed — absent.
  it('never writes the token, or the header, into the log', async () => {
    verifyIdToken.mockRejectedValue(authError('auth/id-token-expired'))
    const res = makeRes()

    await requireAuth(makeReq({ authorization: 'Bearer SECRET.TOKEN.VALUE' }), res, vi.fn())

    const written = JSON.stringify(lines)
    expect(written).not.toContain('SECRET')
    expect(written).not.toContain('Bearer')
    expect(JSON.stringify(res.body)).not.toContain('SECRET')
  })

  it('does not leak firebase-admin\'s own message to the caller', async () => {
    verifyIdToken.mockRejectedValue(authError('auth/id-token-expired'))
    const res = makeRes()

    await requireAuth(makeReq({ authorization: 'Bearer abc.def.ghi' }), res, vi.fn())

    expect(JSON.stringify(res.body)).not.toContain('firebase said')
  })
})

describe('admitting a caller', () => {
  it('attaches the uid and calls the next stage', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const req = makeReq({ authorization: 'Bearer abc.def.ghi' })
    const next = vi.fn()

    await requireAuth(req, makeRes(), next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.caller.uid).toBe('u1')
  })

  // uid is the ONLY auth-derived value firestore.rules trusts — it is the only
  // thing read off request.auth anywhere in the file. Everything else comes
  // from a live read of /users, so nothing else is carried forward as if it
  // were current.
  it('carries the claims only under a name that says they are stale', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', orgId: 'orgA', role: 'manager', email: 'a@b.co' })
    const req = makeReq({ authorization: 'Bearer abc.def.ghi' })

    await requireAuth(req, makeRes(), vi.fn())

    expect(Object.keys(req.caller).sort()).toEqual(['staleClaims', 'uid'])
    expect(req.caller.staleClaims).toEqual({ orgId: 'orgA', role: 'manager' })
    // No orgId or role sitting at the top level of req.caller, where the next
    // person to write a route would reasonably read them as current. A token
    // is up to an hour behind /users, and claims.js does not revoke on a
    // member → auditor demotion at all — so for that hour the token still says
    // `member` and a server trusting it would let a demoted auditor write.
    expect(req.caller.orgId).toBeUndefined()
    expect(req.caller.role).toBeUndefined()
    expect(req.caller.email).toBeUndefined()
  })

  it('normalises absent claims to null rather than leaving them undefined', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const req = makeReq({ authorization: 'Bearer abc.def.ghi' })

    await requireAuth(req, makeRes(), vi.fn())

    expect(req.caller.staleClaims).toEqual({ orgId: null, role: null })
  })

  it('asks Firebase whether the session was revoked', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })

    await requireAuth(makeReq({ authorization: 'Bearer abc.def.ghi' }), makeRes(), vi.fn())

    expect(verifyIdToken).toHaveBeenCalledWith('abc.def.ghi', true)
  })

  it('can be told to skip the revocation lookup', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    vi.stubEnv('AUTH_CHECK_REVOKED', 'false')

    await requireAuth(makeReq({ authorization: 'Bearer abc.def.ghi' }), makeRes(), vi.fn())

    expect(verifyIdToken).toHaveBeenCalledWith('abc.def.ghi', false)
    vi.unstubAllEnvs()
  })
})
