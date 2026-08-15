import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'

// ── Stand-ins for the two boundaries this file is not testing ────────────────
// firebase-admin, because a unit test must never hold a credential; and
// src/authz/, because it belongs to another agent and this file is testing the
// APP's chain — that the stages are in the right order and that nothing gets
// past the ones before it.

const { verifyIdToken, getDb } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('./firestore.js', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getDb,
  isEmulated: () => true,
}))

// Only requireProfile is stood in for — the rest of src/authz/ is the real
// thing, because the mounted routes are wired with its guards and a stub would
// prove the chain runs a stub. The stand-in attaches the same shape the real
// stage attaches (`req.caller` with a live profile), so a guard downstream is
// deciding on a real caller object.
let profileRole = 'manager'
vi.mock('./authz/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  requireProfile: (req, res, next) => {
    // One path that fails, so a 500 can be driven through the real error
    // handler without a business route existing to throw from.
    if (req.path === '/v1/explode') {
      return next(new Error('profile read failed on organizations/orgA/injuries'))
    }
    req.caller = {
      uid: req.caller?.uid || 'u1',
      profile: { orgId: 'orgA', status: 'approved', role: profileRole, name: 'Tester' },
      staleClaims: {},
    }
    next()
  },
}))

const { createApp, HEALTH_PATH } = await import('./index.js')

const AUTH = { authorization: 'Bearer good.id.token' }
const authError = (code) => Object.assign(new Error(`firebase said: ${code}`), { code })

let app
let lines
beforeEach(() => {
  lines = []
  verifyIdToken.mockReset()
  getDb.mockReset()
  const capture = (line) => lines.push(JSON.parse(line))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
  app = createApp()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('the health endpoint', () => {
  // A probe has no credential to present. A health check that needed one would
  // report a broken Firebase as a dead container, and Cloud Run would restart
  // every instance — removing the capacity that might have worked through it.
  it('answers with no token at all', async () => {
    const res = await request(app).get(HEALTH_PATH)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('is not fooled into asking for one by a broken Authorization header', async () => {
    expect((await request(app).get(HEALTH_PATH).set('authorization', 'Basic x')).status).toBe(200)
  })

  // The mirror-image reason: a health check that queried Firestore would turn a
  // slow database into a failed revision. It answers one question — is this
  // process up and serving — and nothing else.
  it('does not touch Firestore', async () => {
    await request(app).get(HEALTH_PATH)
    expect(getDb).not.toHaveBeenCalled()
  })
})

describe('the request id', () => {
  it('comes back on every response, health included', async () => {
    const res = await request(app).get(HEALTH_PATH)
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('is different for every request', async () => {
    const a = await request(app).get(HEALTH_PATH)
    const b = await request(app).get(HEALTH_PATH)
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id'])
  })

  // Honouring an inbound one lets any caller choose what their entries are
  // filed under — colliding them with someone else's, or repeating a single id
  // until the logs are useless.
  it('is ours, not the caller\'s', async () => {
    const res = await request(app).get(HEALTH_PATH).set('x-request-id', 'attacker-chosen')
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen')
  })

  it('is the same id the caller is given and the log records', async () => {
    verifyIdToken.mockRejectedValue(authError('auth/id-token-expired'))
    const res = await request(app).post('/v1/inspections').set(AUTH).send({})

    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
    expect(lines.at(-1).requestId).toBe(res.headers['x-request-id'])
  })
})

describe('every route that is not health', () => {
  const paths = ['/v1/inspections', '/v1', '/', '/anything-at-all']

  it.each(paths)('refuses %s with no token', async (path) => {
    const res = await request(app).post(path).send({})

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: { code: 'unauthenticated', requestId: expect.any(String) } })
  })

  it.each(paths)('refuses %s with a malformed token', async (path) => {
    verifyIdToken.mockRejectedValue(authError('auth/argument-error'))
    const res = await request(app).post(path).set('authorization', 'Bearer not-a-jwt').send({})
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthenticated')
  })

  it.each(paths)('refuses %s with an expired token', async (path) => {
    verifyIdToken.mockRejectedValue(authError('auth/id-token-expired'))
    const res = await request(app).post(path).set(AUTH).send({})
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthenticated')
  })

  it('refuses a header that is not Bearer without asking Firebase', async () => {
    const res = await request(app).post('/v1/inspections').set('authorization', 'Basic dXNlcg==')

    expect(res.status).toBe(401)
    expect(verifyIdToken).not.toHaveBeenCalled()
    expect(lines.at(-1).reason).toBe('malformed_authorization_header')
  })

  // Applied with app.use rather than per-router so a route added later cannot
  // be unauthenticated by omission: the cost of forgetting is a 401, not an
  // open endpoint. /anything-at-all above is the proof — it is not a route,
  // and it still needs a token.
  it('refuses an unknown path before deciding it is unknown', async () => {
    const res = await request(app).post('/not-a-route').send({})
    expect(res.status).toBe(401)
  })

  it('tells a signed-in caller the route does not exist', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const res = await request(app).post('/v1/nothing-here').set(AUTH).send({})

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: { code: 'not_found', requestId: expect.any(String) } })
  })

  // Routes are mounted one migrated module at a time. A collection nobody has
  // registered is not a route, and the 404 sits BEHIND the auth chain so it
  // cannot be used to enumerate which modules have moved.
  it('serves only the collections that have been migrated', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const notMigrated = await request(app)
      .post('/v1/organizations/orgA/incidents')
      .set(AUTH)
      .send({ data: { refNo: 'INC-1' } })

    expect(notMigrated.status).toBe(404)
    expect(notMigrated.body.error.code).toBe('not_found')
  })

  // The chain test that matters: a mounted route is behind its own predicate,
  // and the predicate refuses before the handler opens a transaction. An
  // auditor is the case most likely to be got wrong — elevated for reads,
  // refused for every write (firestore.rules:81-89).
  it('puts a migrated collection behind the predicate its rule names', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    profileRole = 'auditor'
    try {
      const res = await request(app)
        .post('/v1/organizations/orgA/inspectionTemplates')
        .set(AUTH)
        .send({ data: { title: 'Monthly' } })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: { code: 'forbidden', requestId: expect.any(String) } })
      // Refused without ever reaching for the Admin SDK handle, which is what
      // "before the handler" means in practice.
      expect(getDb).not.toHaveBeenCalled()
    } finally {
      profileRole = 'manager'
    }
  })
})

describe('the error handler', () => {
  it('answers a 500 with a code and a request id, and nothing else', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const res = await request(app).post('/v1/explode').set(AUTH).send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { code: 'internal', requestId: expect.any(String) } })
  })

  it('leaks no stack, no message and no collection name', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const res = await request(app).post('/v1/explode').set(AUTH).send({})

    expect(res.text).not.toContain('injuries')
    expect(res.text).not.toContain('profile read failed')
    expect(res.text).not.toContain('index.js')
    expect(res.text).not.toContain('at ')
  })

  it('puts the detail an operator needs in the log instead', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    await request(app).post('/v1/explode').set(AUTH).send({})

    expect(lines.at(-1)).toMatchObject({
      severity: 'ERROR',
      status: 500,
      uid: 'u1',
      detail: 'profile read failed on organizations/orgA/injuries',
    })
    expect(lines.at(-1).stack).toContain('profile read failed')
  })

  // NODE_ENV is `test` under vitest, which is exactly the setting in which
  // Express's default handler prints the stack into the response body. This is
  // the case that catches an error handler wired up in the wrong order.
  it('is reached instead of Express\'s own, which would print the stack', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const res = await request(app).post('/v1/explode').set(AUTH).send({})
    expect(res.headers['content-type']).toMatch(/json/)
  })
})

describe('the request body', () => {
  it('is refused above the limit, before anyone is authenticated', async () => {
    vi.stubEnv('JSON_BODY_LIMIT', '1kb')
    const small = createApp()

    const res = await request(small)
      .post('/v1/inspections')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ note: 'x'.repeat(4096) }))

    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('payload_too_large')
  })

  it('is accepted below the limit', async () => {
    vi.stubEnv('JSON_BODY_LIMIT', '1kb')
    verifyIdToken.mockResolvedValue({ uid: 'u1' })
    const small = createApp()

    const res = await request(small).post('/v1/inspections').set(AUTH).send({ note: 'x' })

    // 404 because there is no such route yet — the point is that it got past
    // the parser and the auth chain rather than being refused for its size.
    expect(res.status).toBe(404)
  })

  it('reports malformed JSON as the client error it is', async () => {
    const res = await request(app)
      .post('/v1/inspections')
      .set('content-type', 'application/json')
      .send('{"note":')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_json')
  })

  // body-parser quotes the request body back inside its own message, and hangs
  // the whole body off err.body. On this system a body carries injuries,
  // illnesses and named people — so neither the response nor the log may
  // contain any of it.
  it('echoes nothing of a body it could not parse, to the caller or the log', async () => {
    const res = await request(app)
      .post('/v1/incidents')
      .set('content-type', 'application/json')
      .send('{"note":"crush injury, left hand, R. Menon"')

    expect(res.status).toBe(400)
    expect(res.text).not.toContain('Menon')
    expect(res.text).not.toContain('crush injury')
    expect(JSON.stringify(lines)).not.toContain('Menon')
    expect(JSON.stringify(lines)).not.toContain('crush injury')
  })
})

describe('what the server says about itself', () => {
  it('does not announce which framework it is', async () => {
    const res = await request(app).get(HEALTH_PATH)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
