// ─────────────────────────────────────────────────────────────────────────────
// The suite that tries to BREAK the server.
//
// WHY IT EXISTS. firebase-admin does not evaluate firestore.rules. Not a
// relaxed version of them — none of them. Every one of the ~58 allow rules that
// stood between a caller and a document is simply absent behind this server, so
// each rule that protected a write has to exist again in JavaScript. The unit
// suites next to the code prove each piece does what its author meant. This one
// asks the only question that matters afterwards: with a real token, a real
// Firestore and the real express app, can the thing actually be made to write
// where it must not?
//
// EVERY CASE HERE IS AN ATTEMPT THAT MUST FAIL, and each names the
// firestore.rules line it stands in for, so the coverage is auditable against
// the model it replaces rather than against somebody's memory of it.
//
// A REFUSAL IS TWO CLAIMS, AND THIS SUITE ASSERTS BOTH. That the response was a
// refusal, AND that the database is byte-for-byte what it was before the
// request. The second is the one that catches the failure that actually hurts:
// a handler that writes and then throws, a transaction that is not one, an
// audit entry filed for an action that was refused. `refused()` below
// fingerprints the whole tenant either side of every attempt. A test that only
// read the status code would pass against a server that wrote the document and
// then said 403.
//
// THERE ARE POSITIVE CONTROLS AT THE BOTTOM, ON PURPOSE. A suite made entirely
// of "this must be refused" passes perfectly against a server that refuses
// everything, including a server whose routes are broken, misrouted or
// unmounted. The controls are what make the refusals mean something: the same
// request, from the person entitled to make it, has to succeed.
//
// WHAT IT RUNS AGAINST. The Firestore and Auth emulators, from
// firebase.servertest.json at the repo root — real ID tokens through
// verifyIdToken, real profile reads, real transactions.
//
//   npm test         runs both halves: test:unit, then test:attack
//   npm run test:unit    src/ only, no emulator, the fast inner loop
//   npm run test:attack  this file, wrapped in `firebase emulators:exec`
//
// THE TWO HALVES RUN SEPARATELY BECAUSE THEY NEED OPPOSITE ENVIRONMENTS, which
// is not a packaging preference. src/firestore.test.js asserts that
// getAdminApp() REFUSES to initialise when NODE_ENV=test and no emulator host
// is set — the guard that keeps a test run off the production database, where
// firebase-admin would write to a real tenant with nothing refusing it. Running
// that assertion inside emulators:exec sets the very variable it is asserting
// the absence of, and the guard test fails for the one reason that means
// nothing is wrong. So the unit half runs un-emulated, on purpose.
//
// AND WHAT THE EMULATOR CANNOT PROVE. The Auth emulator issues UNSIGNED tokens
// (alg: none, empty signature) and firebase-admin skips signature verification
// against it. So no test here proves the signature check — production's first
// line of defence — works. What is provable is everything decided from the
// token's CONTENTS (audience, issuer, expiry, subject) plus the revocation
// lookup, and each such test says which of those refused it. The one case that
// leans on this is marked; read its comment before trusting it.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

// ── The emulator is required, and its absence is a FAILURE, never a skip ─────
//
// A security suite that skips itself is worse than no suite: `vitest run` goes
// green, the summary says every file passed, and the one file that proves the
// tenant boundary holds ran nothing at all. The repo has already been bitten by
// the quieter version of this — server/vitest.config.js exists because a config
// that matched no test files "passed CI by testing nothing".
//
// So this throws during collection, with the command that fixes it.
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!FIRESTORE_HOST || !AUTH_HOST) {
  throw new Error(
    'attack.test.js needs the Firestore AND Auth emulators.\n' +
      `  FIRESTORE_EMULATOR_HOST=${FIRESTORE_HOST || '(unset)'}\n` +
      `  FIREBASE_AUTH_EMULATOR_HOST=${AUTH_HOST || '(unset)'}\n` +
      'Run:  npm test             (from server/ — the unit half, then this one under emulators:exec)\n' +
      'Or:   npm run test:attack  (this file only, with its emulators)\n' +
      'Or:   npm run test:unit    (the fast loop, which does not include this file)\n' +
      '\nNote FIREBASE_AUTH_EMULATOR_HOST is a SEPARATE variable from the Firestore one. ' +
      "Without it verifyIdToken checks the emulator's unsigned tokens against Google's " +
      'real public keys and every request 401s, which looks exactly like a bad token.'
  )
}

// Matches src/firestore.js's own resolution order, so the admin app, the
// emulator and the `aud` claim on every minted token all name one project. A
// mismatch here refuses every request for the right reason and the wrong cause,
// and the resulting suite is red in a way that teaches nobody anything.
const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  'ohsms-demo'

const { initializeApp, getApps } = await import('firebase-admin/app')
const { getAuth } = await import('firebase-admin/auth')
const { getFirestore } = await import('firebase-admin/firestore')
const { createApp } = await import('../src/index.js')

// Imported for ONE test — the mid-request revocation below, which has to
// reassemble the chain from src/index.js in order to wedge a stage into it.
const express = (await import('express')).default
const { requireAuth } = await import('../src/auth.js')
const { requireProfile } = await import('../src/authz/index.js')
const { apiRouter } = await import('../src/routes/index.js')
const { errorHandler, notFoundHandler } = await import('../src/errors.js')
const { createOrgCollectionRouter } = await import('../src/routes/orgCollection.js')

const adminApp = getApps()[0] || initializeApp({ projectId: PROJECT_ID })
const auth = getAuth(adminApp)
const db = getFirestore(adminApp)
const app = createApp()

// ── Fixture identity ─────────────────────────────────────────────────────────
//
// Every org and every email carries a per-run suffix. Two reasons, both learned
// from the emulator rather than invented: a suite that used fixed ids would
// collide with a developer's own emulator data, and — worse — the document
// counts this suite asserts on would be counting somebody else's rows. Unique
// ids also mean nothing has to be deleted at startup, so a mistake in this file
// can never wipe a local database.
const RUN = randomUUID().slice(0, 8)
const ORG_A = `attack-alpha-${RUN}`
const ORG_B = `attack-beta-${RUN}`
const ORG_C = `attack-gamma-${RUN}`
const PASSWORD = 'attack-suite-password-123'

/** A token from a Firebase project that is not ours. */
const FOREIGN_PROJECT = `not-our-project-${RUN}`

const nowSec = () => Math.floor(Date.now() / 1000)
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/**
 * Sign in through the Auth emulator's REST endpoint to get a real ID token.
 *
 * The Admin SDK can mint a CUSTOM token but not an ID token — the exchange is a
 * client operation — and it is the ID token the server verifies, so that is the
 * one this suite has to carry. The API key is unchecked by the emulator.
 */
async function mintToken(email) {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }
  )
  const body = await res.json()
  if (!body.idToken) throw new Error(`could not mint a token for ${email}: ${JSON.stringify(body)}`)
  return body.idToken
}

/**
 * Re-issue a token with a patched payload, keeping the header and signature.
 *
 * Only meaningful because the emulator's tokens are unsigned — see the header.
 * It is how this suite reaches the checks that read the token's CONTENTS
 * (audience, issuer, expiry, subject), which are the same checks that run in
 * production; it proves nothing about the signature check, which does not.
 */
function reissue(token, patch) {
  const [header, payload, signature] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  return `${header}.${b64url({ ...claims, ...patch })}.${signature}`
}

/**
 * An Auth user, its /users profile, and a token minted AFTER its claims.
 *
 * The order is the whole point of several tests below: custom claims are baked
 * into the token at mint time, so a profile changed afterwards leaves a token
 * that still says the old thing. That is the gap firestore.rules never had —
 * it re-reads /users on every evaluation (rules:30-32) — and the gap this
 * server closes by doing the same.
 */
async function makeUser(key, { profile = null, claims = null } = {}) {
  const email = `${key}-${RUN}@attack.test`
  const record = await auth.createUser({ email, password: PASSWORD })
  if (claims) await auth.setCustomUserClaims(record.uid, claims)
  if (profile) await db.collection('users').doc(record.uid).set(profile)
  const token = await mintToken(email)
  return { key, uid: record.uid, email, token }
}

/** An approved profile in an org. `role` omitted deliberately in one fixture. */
const profileOf = (orgId, role, extra = {}) => ({
  orgId,
  status: 'approved',
  ...(role === undefined ? {} : { role }),
  name: `${role || 'roleless'} of ${orgId}`,
  ...extra,
})

// The four collections a write to this module can touch. auditLogs and docSeq
// are in the list precisely because no route may write them on a refused
// request: an entry filed for an action that did not happen is a trail that
// lies, and a counter bumped by a refused submit burns a reference number that
// gets quoted to a regulator (rules:906-908).
const WATCHED = ['inspectionTemplates', 'inspectionRecords', 'auditLogs', 'docSeq']

/**
 * Everything in one tenant, as comparable values.
 *
 * Compared either side of every attempt. A status code alone would pass against
 * a handler that wrote the document and then threw — which is exactly the shape
 * of bug a transaction is supposed to make impossible and therefore exactly the
 * one worth checking rather than assuming.
 */
async function fingerprint(orgId) {
  const org = db.collection('organizations').doc(orgId)
  const out = {}
  for (const collection of WATCHED) {
    const snap = await org.collection(collection).get()
    for (const doc of snap.docs) out[`${collection}/${doc.id}`] = JSON.stringify(doc.data())
  }
  return out
}

/**
 * Make the attempt, and prove it changed nothing.
 *
 * Asserts three things, and the third is not decoration: the response body
 * carries a code and a request id and NOTHING ELSE. src/errors.js's contract is
 * that a refusal never names the collection, the check that refused, or the
 * tenant — "you are not a member of that org" and "no such org" are different
 * sentences and the difference is a directory of other people's tenants,
 * readable one 403 at a time by anyone with a login (authz/errors.js:14-21).
 */
async function refused(orgId, send, { status, code }) {
  const before = await fingerprint(orgId)
  const res = await send()

  expect({ status: res.status, code: res.body?.error?.code }).toEqual({ status, code })
  expect(Object.keys(res.body.error).sort()).toEqual(['code', 'requestId'])
  expect(await fingerprint(orgId)).toEqual(before)

  return res
}

// ── The routes under attack ──────────────────────────────────────────────────
//
// Every write entry point src/routes/orgCollection.js registers, with the
// predicate the generic rule puts in front of it. "By every route" in this file
// means this table, crossed with both collections — ten write surfaces per
// attacker.
const ROUTES = [
  { label: 'POST (create, server id)', verb: 'post', withId: false, gate: 'isWriterOf' },
  { label: 'POST (create, chosen id)', verb: 'post', withId: true, gate: 'isWriterOf' },
  { label: 'PUT (set)', verb: 'put', withId: true, gate: 'isWriterOf' },
  { label: 'PATCH (update)', verb: 'patch', withId: true, gate: 'isWriterOf' },
  { label: 'DELETE (remove)', verb: 'delete', withId: true, gate: 'isManagerOf' },
]

// A body each collection would accept if the caller were entitled to send it,
// so that a refusal is never explainable as "the payload was wrong anyway".
const COLLECTIONS = [
  { name: 'inspectionTemplates', body: { title: 'Attack', siteId: 'site-1' } },
  { name: 'inspectionRecords', body: { templateTitle: 'Attack', score: 100 } },
]

const url = (orgId, collection, id) =>
  `/v1/organizations/${orgId}/${collection}${id ? `/${id}` : ''}`

/** Fire one route at one tenant as one caller. */
function attempt(route, { token, orgId, collection, id = 'target-doc', body }) {
  let req = request(app)[route.verb](url(orgId, collection, route.withId ? id : null))
  if (token !== null && token !== undefined) req = req.set('authorization', `Bearer ${token}`)
  // DELETE carries no body — the route reads none, and sending one would let a
  // refusal be blamed on validation rather than on the manager gate.
  if (route.verb !== 'delete') req = req.send({ data: body })
  return req
}

/** Every route × every collection, as `it()`-ready rows. */
const everyWriteSurface = () =>
  ROUTES.flatMap((route) => COLLECTIONS.map((collection) => ({ route, collection })))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const users = {}
/** Real documents in org B, for the direct-object-reference attempts. */
const victims = { template: null, record: null }

beforeAll(async () => {
  // Org documents, so docSeq can derive a code the way a real submit would.
  await db.collection('organizations').doc(ORG_A).set({ name: 'Alpha Works', docCode: 'ALPHA' })
  await db.collection('organizations').doc(ORG_B).set({ name: 'Beta Works', docCode: 'BETA' })

  const make = async (key, spec) => {
    users[key] = await makeUser(key, spec)
  }

  // Honest members of each tenant. `claims` mirror the profile, as
  // functions/lib/claims.js would have minted them.
  await make('adminA', {
    profile: profileOf(ORG_A, 'admin'),
    claims: { orgId: ORG_A, role: 'admin' },
  })
  await make('managerA', {
    profile: profileOf(ORG_A, 'manager'),
    claims: { orgId: ORG_A, role: 'manager' },
  })
  await make('memberA', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })
  await make('auditorA', {
    profile: profileOf(ORG_A, 'auditor'),
    claims: { orgId: ORG_A, role: 'auditor' },
  })
  await make('adminB', {
    profile: profileOf(ORG_B, 'admin'),
    claims: { orgId: ORG_B, role: 'admin' },
  })
  await make('memberB', {
    profile: profileOf(ORG_B, 'member'),
    claims: { orgId: ORG_B, role: 'member' },
  })

  // Members whose standing refuses them from the start.
  await make('pendingA', { profile: { ...profileOf(ORG_A, 'member'), status: 'pending' } })
  await make('provisionedA', { profile: profileOf(ORG_A, 'member', { mustChangePassword: true }) })
  await make('rolelessA', { profile: profileOf(ORG_A, undefined) })
  await make('noOrgA', { profile: { status: 'approved', role: 'admin', name: 'no org' } })
  await make('noStatusA', { profile: { orgId: ORG_A, role: 'admin', name: 'no status' } })
  // Exists in Auth and nowhere else — the state a deleted user is left in.
  await make('ghost', {})

  // A token whose CLAIMS ARE A LIE. The profile says member of A; the claims,
  // baked in at mint time, say admin of B. Every write below is attempted
  // against B, which the claims alone would authorise.
  await make('liar', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_B, role: 'admin' },
  })

  // ── The stale-claim fixtures ───────────────────────────────────────────────
  // Each is minted while entitled, then demoted in Firestore. The token is not
  // touched and does not expire: it still verifies, and it still says the old
  // thing. functions/lib/claims.js revokes refresh tokens on exactly two
  // transitions and none of these are among them (claims.js:85-103), so this is
  // the live gap — not a hypothetical one.
  await make('staleAuditor', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })
  await make('stalePending', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })
  await make('staleMoved', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })
  await make('staleDeleted', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })
  await make('staleManager', {
    profile: profileOf(ORG_A, 'manager'),
    claims: { orgId: ORG_A, role: 'manager' },
  })
  await make('staleProvisioned', {
    profile: profileOf(ORG_A, 'member'),
    claims: { orgId: ORG_A, role: 'member' },
  })

  // The demotions, all AFTER the tokens above were minted.
  await db.collection('users').doc(users.staleAuditor.uid).update({ role: 'auditor' })
  await db.collection('users').doc(users.stalePending.uid).update({ status: 'suspended' })
  await db.collection('users').doc(users.staleMoved.uid).update({ orgId: ORG_C })
  await db.collection('users').doc(users.staleDeleted.uid).delete()
  await db.collection('users').doc(users.staleManager.uid).update({ role: 'member' })
  await db.collection('users').doc(users.staleProvisioned.uid).update({ mustChangePassword: true })

  // Documents that really exist in org B, so the cross-tenant attempts below
  // are aimed at real ids rather than at ids that would 404 anyway. A test that
  // cannot tell "refused" from "not there" proves nothing about tenancy.
  const orgB = db.collection('organizations').doc(ORG_B)
  const template = orgB.collection('inspectionTemplates').doc('beta-template')
  const record = orgB.collection('inspectionRecords').doc('beta-record')
  await template.set({
    title: 'Beta monthly walkthrough',
    status: 'Active',
    createdBy: 'Beta Admin',
  })
  await record.set({
    templateTitle: 'Beta monthly walkthrough',
    score: 91,
    docId: 'INSP-BETA_0001',
  })
  victims.template = template
  victims.record = record
}, 120_000)

// ═════════════════════════════════════════════════════════════════════════════
// 1. NO CREDENTIAL — firestore.rules:26-28, `request.auth != null`
// ═════════════════════════════════════════════════════════════════════════════
describe('a caller with no valid credential [rules:26-28 isSignedIn]', () => {
  for (const { route, collection } of everyWriteSurface()) {
    it(`${route.label} → ${collection.name}: refused with no Authorization header`, async () => {
      await refused(
        ORG_A,
        () =>
          attempt(route, {
            token: null,
            orgId: ORG_A,
            collection: collection.name,
            body: collection.body,
          }),
        { status: 401, code: 'unauthenticated' }
      )
    })
  }

  // Every shape of broken header collapses to one body. The REASONS are
  // distinguished in the log and nowhere else (src/auth.js:44-50): "your token
  // expired" and "this token was revoked" are a client bug and a possible
  // intrusion, and a caller who can tell them apart is being handed a probe.
  const BROKEN_HEADERS = [
    ['an empty header', ''],
    ['the wrong scheme', 'Basic YWRtaW46YWRtaW4='],
    ['a scheme and nothing else', 'Bearer'],
    ['a token containing a space', 'Bearer not a jwt'],
    ['a token that is not a JWT at all', 'Bearer aaaaaaaaaaaa'],
    ['only two JWT segments', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0'],
  ]
  for (const [label, header] of BROKEN_HEADERS) {
    it(`refused, and says nothing extra, given ${label}`, async () => {
      const before = await fingerprint(ORG_A)
      const res = await request(app)
        .post(url(ORG_A, 'inspectionTemplates'))
        .set('authorization', header)
        .send({ data: { title: 'Attack' } })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('unauthenticated')
      expect(await fingerprint(ORG_A)).toEqual(before)
    })
  }

  it('refuses an EXPIRED token [src/auth.js reasonFor → token_expired]', async () => {
    const stale = reissue(users.memberA.token, { exp: nowSec() - 3600, iat: nowSec() - 7200 })
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${stale}`)
          .send({ data: { title: 'Attack' } }),
      { status: 401, code: 'unauthenticated' }
    )
  })

  // The one token-content check that is identical in the emulator and in
  // production: firebase-admin compares `aud` and `iss` against the configured
  // project before it ever looks at a signature. A token from another Firebase
  // project is a real, obtainable credential — anyone can stand up a project —
  // so this is the case where "it is signed by Google" is true and irrelevant.
  it('refuses a token minted for a DIFFERENT Firebase project', async () => {
    const foreign = reissue(users.memberA.token, {
      aud: FOREIGN_PROJECT,
      iss: `https://securetoken.google.com/${FOREIGN_PROJECT}`,
    })
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${foreign}`)
          .send({ data: { title: 'Attack' } }),
      { status: 401, code: 'unauthenticated' }
    )
  })

  it('refuses a token whose issuer is a different project even when the audience is ours', async () => {
    const foreign = reissue(users.memberA.token, {
      iss: `https://securetoken.google.com/${FOREIGN_PROJECT}`,
    })
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${foreign}`)
          .send({ data: { title: 'Attack' } }),
      { status: 401, code: 'unauthenticated' }
    )
  })

  // READ THE CAVEAT. In production a payload swap is caught by the SIGNATURE,
  // which the emulator does not check. What refuses it here is the revocation
  // lookup — verifyIdToken(token, true) fetches the user named by `sub` and
  // finds nobody. That lookup is real and is on by default, but it is switchable
  // (AUTH_CHECK_REVOKED), so this test is proving the SECOND net, not the first.
  // It is here because the second net is the only one an emulator can exercise,
  // and a suite that quietly skipped it would leave nobody aware of that.
  it('refuses a token whose subject was swapped for another uid [revocation lookup, not the signature]', async () => {
    const forged = reissue(users.memberA.token, {
      sub: 'uid-that-does-not-exist',
      user_id: 'uid-that-does-not-exist',
    })
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${forged}`)
          .send({ data: { title: 'Attack' } }),
      { status: 401, code: 'unauthenticated' }
    )
  })

  it('refuses a token that names a REAL other user, so a uid swap buys nothing', async () => {
    const forged = reissue(users.memberA.token, {
      sub: users.adminB.uid,
      user_id: users.adminB.uid,
    })
    // Whether this is refused at the token or at the tenant, it must not write
    // into org A — and it must certainly not write into org B either.
    const beforeB = await fingerprint(ORG_B)
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${forged}`)
          .send({ data: { title: 'Attack' } }),
      { status: 403, code: 'forbidden' }
    )
    expect(await fingerprint(ORG_B)).toEqual(beforeB)
  })

  // 404-vs-401 is a map of the migration. An anonymous caller must not be able
  // to learn which collections have moved to this server by watching which ones
  // answer differently (src/routes/index.js:25-27).
  it('cannot map the surface: an unmigrated collection and a nonexistent one 401 alike', async () => {
    const paths = [
      url(ORG_A, 'inspectionTemplates'),
      url(ORG_A, 'permits'),
      url(ORG_A, 'not-a-collection-at-all'),
      url('org-that-does-not-exist', 'inspectionTemplates'),
      '/v1/nothing/here',
    ]
    for (const path of paths) {
      const res = await request(app)
        .post(path)
        .send({ data: { title: 'Attack' } })
      expect({ path, status: res.status, code: res.body.error.code }).toEqual({
        path,
        status: 401,
        code: 'unauthenticated',
      })
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. CROSS-TENANT — firestore.rules:63-68 (`myProfile().orgId == orgId`),
//    applied by rules:1054-1059 to every collection in the org subtree.
// ═════════════════════════════════════════════════════════════════════════════
describe('a member of org A writing into org B [rules:63-68, 1054-1059]', () => {
  for (const { route, collection } of everyWriteSurface()) {
    it(`${route.label} → ${collection.name}: refused`, async () => {
      await refused(
        ORG_B,
        () =>
          attempt(route, {
            token: users.memberA.token,
            orgId: ORG_B,
            collection: collection.name,
            body: collection.body,
          }),
        { status: 403, code: 'forbidden' }
      )
    })
  }

  // Being an ADMIN of somewhere else is not a privilege anywhere. The orgId in
  // the path is an ASSERTION compared against the stored profile, never
  // authority (authz/policy.js on isApprovedMemberOf) — so the highest role in
  // tenant A buys exactly nothing in tenant B.
  for (const { route, collection } of everyWriteSurface()) {
    it(`${route.label} → ${collection.name}: refused even for an ADMIN of the other org`, async () => {
      await refused(
        ORG_B,
        () =>
          attempt(route, {
            token: users.adminA.token,
            orgId: ORG_B,
            collection: collection.name,
            body: collection.body,
          }),
        { status: 403, code: 'forbidden' }
      )
    })
  }

  // The token's claims say `orgId: ORG_B, role: 'admin'`. The profile says
  // member of A. If anything anywhere in this server branched on a claim, this
  // request would succeed — and it is the request an hour-stale token makes for
  // free (src/auth.js:9-27).
  it('refuses a token whose CLAIMS say admin of org B while the profile says member of org A', async () => {
    for (const { route, collection } of everyWriteSurface()) {
      await refused(
        ORG_B,
        () =>
          attempt(route, {
            token: users.liar.token,
            orgId: ORG_B,
            collection: collection.name,
            body: collection.body,
          }),
        { status: 403, code: 'forbidden' }
      )
    }
  })

  // Direct object reference. These ids EXIST in org B and their contents are
  // asserted unchanged, so a pass cannot be explained by "there was nothing
  // there to hurt".
  const DOC_TARGETS = [
    ['inspectionTemplates', 'beta-template'],
    ['inspectionRecords', 'beta-record'],
  ]
  for (const [collection, id] of DOC_TARGETS) {
    for (const route of ROUTES.filter((r) => r.withId)) {
      it(`${route.label}: cannot touch the REAL org-B document ${collection}/${id}`, async () => {
        const body = COLLECTIONS.find((c) => c.name === collection).body
        await refused(
          ORG_B,
          () => attempt(route, { token: users.memberA.token, orgId: ORG_B, collection, id, body }),
          { status: 403, code: 'forbidden' }
        )
      })
    }
  }

  // The path is the tenant. Naming another tenant's document id under YOUR OWN
  // org must reach nothing of theirs — the document lives at
  // organizations/{orgId}/… and the id is only unique within it.
  it('an org-A writer using an org-B document id under the org-A path reaches nothing of org B', async () => {
    const beforeB = await fingerprint(ORG_B)
    const res = await request(app)
      .patch(url(ORG_A, 'inspectionTemplates', 'beta-template'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { title: 'Repointed' } })

    expect({ status: res.status, code: res.body.error.code }).toEqual({
      status: 404,
      code: 'document_not_found',
    })
    expect(await fingerprint(ORG_B)).toEqual(beforeB)
  })

  // The body cannot redirect the write. `orgId` is not an accepted field on
  // either collection, so a payload naming another tenant is refused outright
  // rather than quietly ignored — and the refusal is a 400 about the FIELD,
  // which reveals nothing about whether that tenant exists.
  it('refuses a body carrying an orgId that disagrees with the path', async () => {
    const beforeB = await fingerprint(ORG_B)
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${users.memberA.token}`)
          .send({ data: { title: 'Attack', orgId: ORG_B } }),
      { status: 400, code: 'unknown_field' }
    )
    expect(await fingerprint(ORG_B)).toEqual(beforeB)
  })

  // A path segment is compared as a string, so an orgId that is "clever" is
  // just an orgId that matches nobody's profile.
  const SLIPPERY_ORG_IDS = [
    ['a traversal', `..%2F${ORG_B}`],
    ['a trailing space', `${ORG_A}%20`],
    ['a leading space', `%20${ORG_A}`],
    ['a different case', ORG_A.toUpperCase()],
    ['a null byte', `${ORG_A}%00`],
  ]
  for (const [label, orgId] of SLIPPERY_ORG_IDS) {
    it(`refuses an orgId with ${label}`, async () => {
      const beforeA = await fingerprint(ORG_A)
      const beforeB = await fingerprint(ORG_B)
      const res = await request(app)
        .post(`/v1/organizations/${orgId}/inspectionTemplates`)
        .set('authorization', `Bearer ${users.memberA.token}`)
        .send({ data: { title: 'Attack' } })

      // 403 or 404 depending on how express routes it; never a 2xx, and never
      // a write. Which of the two is not a security property; writing is.
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await fingerprint(ORG_A)).toEqual(beforeA)
      expect(await fingerprint(ORG_B)).toEqual(beforeB)
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE AUDITOR — firestore.rules:87-89 (isWriterOf excludes 'auditor') and
//    rules:76-79 (isManagerOf excludes it too, so delete is doubly refused).
//
//    The rules file records why this is the case most likely to be got wrong:
//    the role was documented as read-only across every module and until
//    isWriterOf existed that was true only in React — can() hid the buttons
//    while the rules accepted the same write from the SDK (rules:81-86).
//    firebase-admin hides nothing either.
// ═════════════════════════════════════════════════════════════════════════════
describe('an auditor writing in their OWN org [rules:87-89, 76-79]', () => {
  for (const { route, collection } of everyWriteSurface()) {
    it(`${route.label} → ${collection.name}: refused`, async () => {
      await refused(
        ORG_A,
        () =>
          attempt(route, {
            token: users.auditorA.token,
            orgId: ORG_A,
            collection: collection.name,
            body: collection.body,
          }),
        { status: 403, code: 'forbidden' }
      )
    })
  }

  it('cannot overwrite a document that already exists, by set or by merge', async () => {
    const id = `auditor-target-${RUN}`
    // Seeded by an entitled writer first, so the auditor is aiming at something
    // real. This is the evidence-tampering case the role exists to prevent.
    await request(app)
      .post(url(ORG_A, 'inspectionTemplates', id))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { title: 'Genuine finding' } })
      .expect(201)

    await refused(
      ORG_A,
      () =>
        request(app)
          .put(url(ORG_A, 'inspectionTemplates', id))
          .set('authorization', `Bearer ${users.auditorA.token}`)
          .send({ data: { title: 'Rewritten by the auditor' } }),
      { status: 403, code: 'forbidden' }
    )

    await refused(
      ORG_A,
      () =>
        request(app)
          .put(url(ORG_A, 'inspectionTemplates', id))
          .set('authorization', `Bearer ${users.auditorA.token}`)
          .send({ merge: true, data: { title: 'Merged by the auditor' } }),
      { status: 403, code: 'forbidden' }
    )
  })

  it('leaves no audit entry behind — a refused action is not an action', async () => {
    const trail = db.collection('organizations').doc(ORG_A).collection('auditLogs')
    const before = (await trail.get()).size

    await attempt(ROUTES[0], {
      token: users.auditorA.token,
      orgId: ORG_A,
      collection: 'inspectionTemplates',
      body: { title: 'Attack' },
    })

    expect((await trail.get()).size).toBe(before)
  })

  it('cannot burn a document number: docSeq is untouched by a refused submit [rules:906-908]', async () => {
    const seq = db.collection('organizations').doc(ORG_A).collection('docSeq').doc('inspections')
    const before = (await seq.get()).data()?.n ?? null

    await attempt(ROUTES[0], {
      token: users.auditorA.token,
      orgId: ORG_A,
      collection: 'inspectionRecords',
      body: { templateTitle: 'Attack', score: 1 },
    })

    expect((await seq.get()).data()?.n ?? null).toBe(before)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. STANDING — approval, provisioning, and the profile read that makes
//    revocation instant. firestore.rules:30-32 (myProfile is a LIVE get),
//    34-37 (hasProfile), 59-61 (passwordIsOwn), 63-68.
// ═════════════════════════════════════════════════════════════════════════════
describe('a caller whose profile refuses them [rules:30-37, 59-68]', () => {
  const STANDING = [
    ['an unapproved member', 'pendingA', 403, 'not_approved'],
    ['a member still on a provisioned password', 'provisionedA', 403, 'password_change_required'],
    ['a signed-in user with no profile document', 'ghost', 403, 'profile_missing'],
    ['a profile carrying no orgId at all', 'noOrgA', 403, 'forbidden'],
    ['a profile carrying no status at all', 'noStatusA', 403, 'forbidden'],
    // rules:88 reads `myProfile().role` DIRECTLY, and a direct read of an
    // absent field RAISES, which denies. In JavaScript the same access is
    // `undefined` and `undefined !== 'auditor'` is true — which would have made
    // a profile with no role a WRITER. That asymmetry is the whole reason
    // policy.js routes every direct read through directField().
    ['a profile carrying no role at all', 'rolelessA', 403, 'forbidden'],
  ]

  for (const [label, key, status, code] of STANDING) {
    for (const { route, collection } of everyWriteSurface()) {
      it(`${label}: ${route.label} → ${collection.name} refused with ${code}`, async () => {
        await refused(
          ORG_A,
          () =>
            attempt(route, {
              token: users[key].token,
              orgId: ORG_A,
              collection: collection.name,
              body: collection.body,
            }),
          { status, code }
        )
      })
    }
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. THE STALE CLAIM — the case this server exists to get right.
//
//    A rule evaluates myProfile() as a LIVE get(/users/{uid}) on EVERY
//    evaluation (rules:30-32), which is why revocation in this app is instant.
//    An ID token is not like that: claims are minted by functions/lib/claims.js
//    and are up to an HOUR stale, and revokesAccess() fires on exactly two
//    transitions (claims.js:85-103). member → auditor is NOT one of them.
//
//    Every token below still verifies. Every one of them is wrong.
// ═════════════════════════════════════════════════════════════════════════════
describe('a caller demoted AFTER their token was minted [rules:30-32 vs claims.js:85-103]', () => {
  const STALE = [
    ['demoted from member to AUDITOR', 'staleAuditor', 403, 'forbidden'],
    ['had their approval withdrawn', 'stalePending', 403, 'not_approved'],
    ['was moved to a different org', 'staleMoved', 403, 'forbidden'],
    ['had their profile deleted', 'staleDeleted', 403, 'profile_missing'],
    ['was put back on a provisioned password', 'staleProvisioned', 403, 'password_change_required'],
  ]

  for (const [label, key, status, code] of STALE) {
    it(`${label}: the token still verifies, and every write is refused with ${code}`, async () => {
      // The token is genuinely still good — proving the refusal came from the
      // profile read and not from an expiry that would have happened anyway.
      const decoded = await auth.verifyIdToken(users[key].token, true)
      expect(decoded.uid).toBe(users[key].uid)
      expect(decoded.role).toBe(key === 'staleManager' ? 'manager' : 'member')
      expect(decoded.orgId).toBe(ORG_A)

      for (const { route, collection } of everyWriteSurface()) {
        await refused(
          ORG_A,
          () =>
            attempt(route, {
              token: users[key].token,
              orgId: ORG_A,
              collection: collection.name,
              body: collection.body,
            }),
          { status, code }
        )
      }
    })
  }

  // The delete gate specifically. A manager demoted to member keeps writing —
  // correctly — and must lose deletion, which is the gate that separates the
  // two roles (rules:1059).
  it('a manager demoted to member keeps their writes and loses DELETE [rules:1059]', async () => {
    const id = `stale-manager-target-${RUN}`
    await request(app)
      .post(url(ORG_A, 'inspectionTemplates', id))
      .set('authorization', `Bearer ${users.staleManager.token}`)
      .send({ data: { title: 'Still a writer' } })
      .expect(201)

    await refused(
      ORG_A,
      () =>
        request(app)
          .delete(url(ORG_A, 'inspectionTemplates', id))
          .set('authorization', `Bearer ${users.staleManager.token}`),
      { status: 403, code: 'forbidden' }
    )
  })

  // The middleware runs before the handler; the write happens after it. Rules
  // had no such gap. This is the window closed by re-reading the profile INSIDE
  // the transaction (orgCollection.js:37-43) — the check and the write commit
  // or abort together.
  it('a demotion that lands mid-request still refuses the write', async () => {
    const victim = await makeUser(`raced-${RUN}`, {
      profile: profileOf(ORG_A, 'member'),
      claims: { orgId: ORG_A, role: 'member' },
    })
    // Demote between minting and the request — the same ordering a real admin
    // revocation produces, and the one a cached caller would lose.
    await db.collection('users').doc(victim.uid).update({ role: 'auditor' })

    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${victim.token}`)
          .send({ data: { title: 'Raced in' } }),
      { status: 403, code: 'forbidden' }
    )
  })

  // ── The window the middleware cannot see ──────────────────────────────────
  //
  // THIS IS THE SUBTLEST GUARANTEE IN THE SERVER AND THE ONLY TEST THAT PROVES
  // IT. Every other refusal here would still be produced by a server that
  // checked ONLY in middleware, because the middleware also reads the live
  // profile. What it cannot cover is the gap between that read and the write:
  // the guard runs before the handler, the write happens after it, and rules
  // had no such gap — they evaluate against committed state AT WRITE TIME.
  //
  // So this reassembles src/index.js's chain with one stage wedged into exactly
  // that window, doing what an admin revoking access mid-request does. The only
  // thing that can refuse it is assertOrgAccess() against the profile re-read
  // INSIDE the transaction (orgCollection.js:37-43). Delete that call and every
  // other test in this file still passes and this one fails.
  it('refuses a demotion that lands BETWEEN the guard and the write [orgCollection.js:37-43]', async () => {
    const victim = await makeUser(`window-${RUN}`, {
      profile: profileOf(ORG_A, 'member'),
      claims: { orgId: ORG_A, role: 'member' },
    })

    let revoked = false
    const raced = express()
    raced.use(express.json())
    raced.use(requireAuth)
    raced.use(requireProfile)
    raced.use((req, res, next) => {
      // requireProfile has already read the profile and approved this caller.
      // The handler has not opened its transaction yet.
      db.collection('users')
        .doc(victim.uid)
        .update({ role: 'auditor' })
        .then(() => {
          revoked = true
          next()
        }, next)
    })
    raced.use('/v1', apiRouter)
    raced.use(notFoundHandler)
    raced.use(errorHandler)

    const before = await fingerprint(ORG_A)
    const res = await request(raced)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${victim.token}`)
      .send({ data: { title: 'Written after revocation' } })

    expect(revoked).toBe(true)
    expect({ status: res.status, code: res.body.error?.code }).toEqual({
      status: 403,
      code: 'forbidden',
    })
    expect(await fingerprint(ORG_A)).toEqual(before)
  })

  it('does not cache the profile: the SECOND request after a demotion is refused too', async () => {
    const victim = await makeUser(`cached-${RUN}`, {
      profile: profileOf(ORG_A, 'member'),
      claims: { orgId: ORG_A, role: 'member' },
    })
    // A successful write first, so any per-uid cache would be warm and holding
    // the entitled answer. A server that trusted it would allow the next one.
    await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${victim.token}`)
      .send({ data: { title: 'While entitled' } })
      .expect(201)

    await db.collection('users').doc(victim.uid).update({ status: 'suspended' })

    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionTemplates'))
          .set('authorization', `Bearer ${victim.token}`)
          .send({ data: { title: 'After suspension' } }),
      { status: 403, code: 'not_approved' }
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE BODY — src/validate.js, the server's keys().hasOnly().
//
//    The generic rule validates NO field for these two collections, so this is
//    deliberately stricter than the rule it replaces. The reason to be stricter
//    now rather than later is written into firestore.rules itself: /reports and
//    /observations both shipped without a hasOnly() and both had to be patched
//    (rules:762-767).
// ═════════════════════════════════════════════════════════════════════════════
describe('a body carrying a field the rule never allowed [src/validate.js; rules:762-767]', () => {
  // EVERY BODY HERE IS A RAW JSON STRING, and that is not a style preference.
  // `__proto__` written in a JavaScript object literal is the PROTOTYPE SETTER,
  // not a key: `JSON.stringify({ __proto__: {...} })` returns `{}` and the
  // attack is silently deleted before it is ever sent. The first draft of this
  // file did exactly that and "passed". Only `JSON.parse` — which is what
  // body-parser runs on the wire — produces `__proto__` as a real own property,
  // so the payload has to be built as text to exist at all.
  const BAD_FIELDS = [
    ['a field nobody declared', '{"title":"x","sneaky":"value"}', 'unknown_field'],
    ['a field belonging to the OTHER collection', '{"title":"x","responses":{}}', 'unknown_field'],
    // The inherited-key trap that was a live authorization bypass in policy.js.
    // `unknown_field` IS the proof: an allowlist held in an object literal would
    // have found `constructor` on Object.prototype, judged it accepted, and
    // stored it. validate.js holds it in a Set, which has no inherited keys, so
    // the answer is the same as for any other name nobody declared.
    ['an inherited Object.prototype key', '{"title":"x","constructor":"boom"}', 'unknown_field'],
    ['the inherited key hasOwnProperty', '{"title":"x","hasOwnProperty":"boom"}', 'unknown_field'],
    [
      '__proto__ as a real own property',
      '{"title":"x","__proto__":{"polluted":true}}',
      'invalid_field_name',
    ],
    ['a Firestore-reserved name', '{"title":"x","__name__":"boom"}', 'invalid_field_name'],
    // A dot is a FIELD PATH to the Admin SDK — `{'responses.q1.status': 'closed'}`
    // writes one nested leaf. An allowlist matching only the first segment would
    // let a caller write to arbitrary depth of a field it may merely replace.
    [
      'a dotted key (field-path injection)',
      '{"responses.q1.actionStatus":"closed"}',
      'invalid_field_name',
    ],
    ['a slashed key', '{"a/b":1}', 'invalid_field_name'],
    [
      '__proto__ nested under a legal field',
      '{"title":"x","fields":{"q":{"__proto__":{"p":1}}}}',
      'invalid_field_name',
    ],
    // Firestore refuses a document nested deeper than 20 levels, so anything
    // past it cannot be stored and only buys the server a recursive walk it was
    // told to do by the caller.
    [
      'a value nested deeper than Firestore allows',
      `{"title":"x","fields":${'{"a":'.repeat(30)}"leaf"${'}'.repeat(30)}}`,
      'invalid_field_value',
    ],
  ]

  for (const [label, data, code] of BAD_FIELDS) {
    it(`refuses ${label} with ${code}`, async () => {
      await refused(
        ORG_A,
        () =>
          request(app)
            .post(url(ORG_A, 'inspectionTemplates'))
            .set('authorization', `Bearer ${users.memberA.token}`)
            .set('content-type', 'application/json')
            .send(`{"data":${data}}`),
        { status: 400, code }
      )
    })
  }

  // NaN and Infinity cannot be MOUNTED over HTTP — JSON has neither, so
  // body-parser refuses the payload before validate.js is reached. That is why
  // the non-finite check in assertStorableValue is unreachable from here and is
  // covered by validate.test.js instead. What is reachable is this: the refusal
  // is a clean `invalid_json` and not a 500, so a client sending a hand-rolled
  // body is not sent into a retry loop against a request that can never succeed.
  for (const literal of ['NaN', 'Infinity', '-Infinity', 'undefined']) {
    it(`refuses a body containing the bare literal ${literal} as invalid_json, not a crash`, async () => {
      await refused(
        ORG_A,
        () =>
          request(app)
            .post(url(ORG_A, 'inspectionTemplates'))
            .set('authorization', `Bearer ${users.memberA.token}`)
            .set('content-type', 'application/json')
            .send(`{"data":{"title":"x","score":${literal}}}`),
        { status: 400, code: 'invalid_json' }
      )
    })
  }

  it('does not pollute Object.prototype along the way', async () => {
    await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .set('content-type', 'application/json')
      .send('{"data":{"title":"x","__proto__":{"polluted":"yes"}}}')

    expect({}.polluted).toBeUndefined()
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('body-parser refuses malformed JSON without echoing the body back [src/errors.js:100-108]', async () => {
    // The parse error quotes a FRAGMENT OF THE REQUEST BODY in err.message, and
    // a body on this system carries injuries, illnesses and named people. The
    // caller must get a code and nothing else.
    const res = await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .set('content-type', 'application/json')
      .send('{"data":{"title":"Ramesh Kumar - fractured wrist"')

    expect({ status: res.status, code: res.body.error.code }).toEqual({
      status: 400,
      code: 'invalid_json',
    })
    expect(JSON.stringify(res.body)).not.toMatch(/Ramesh|wrist/)
  })

  // A refusal must not be dressed up as a business outcome — the lesson the
  // rules file records at 96-104, where a REFUSED defect report came back as
  // "already reported" and for a day the reporters were told the system had
  // their report and the system had nothing.
  const BAD_ENVELOPES = [
    ['no data key', {}, 'invalid_body'],
    ['a data key that is an array', { data: [{ title: 'x' }] }, 'invalid_body'],
    ['a data key that is a string', { data: 'title=x' }, 'invalid_body'],
    ['an empty data object', { data: {} }, 'invalid_body'],
  ]
  for (const [label, body, code] of BAD_ENVELOPES) {
    it(`refuses an envelope with ${label}`, async () => {
      await refused(
        ORG_A,
        () =>
          request(app)
            .post(url(ORG_A, 'inspectionTemplates'))
            .set('authorization', `Bearer ${users.memberA.token}`)
            .send(body),
        { status: 400, code }
      )
    })
  }

  // ── Document ids that try to be a PATH ────────────────────────────────────
  //
  // A PERCENT-ENCODED SLASH SURVIVES EVERYTHING AND ARRIVES AS A SLASH. `%2F`
  // is not touched by URL normalisation, express matches `/:id` against the
  // still-encoded segment, and only then decodes the parameter — so a handler
  // reading req.params.id receives a literal `../../users/admin`. Interpolated
  // into a Firestore path that is a different document in a different
  // collection, which for a store addressed by string paths is the whole of
  // path traversal. `id.includes('/')` in assertUsableDocId is what stops it,
  // and these are the spellings that actually reach that check.
  //
  // (A literal `.` or `..`, and `%2E`, are all resolved away by the HTTP client
  // and URL layer long before express — verified, and covered below. They are
  // NOT the test they look like: assertUsableDocId never sees them.)
  const BAD_IDS = [
    ['a bare encoded slash', '%2F'],
    ['an id that is a two-segment path', 'a%2Fb'],
    ['a traversal into another collection', '..%2F..%2Fusers%2Fadmin'],
    ['a traversal wearing a legitimate prefix', 'x%2F..%2F..%2Fusers%2Fadmin'],
    ['an encoded traversal', '%2E%2E%2Fusers%2Fx'],
    ['__proto__', '__proto__'],
    ['a Firestore-reserved id', '__name__'],
  ]
  for (const [label, segment] of BAD_IDS) {
    it(`refuses ${label} as a document id`, async () => {
      await refused(
        ORG_A,
        () =>
          request(app)
            .patch(`/v1/organizations/${ORG_A}/inspectionTemplates/${segment}`)
            .set('authorization', `Bearer ${users.memberA.token}`)
            .send({ data: { title: 'x' } }),
        { status: 400, code: 'invalid_document_id' }
      )
    })
  }

  it('reaches nothing through a dot segment, in any spelling', async () => {
    // Never a 2xx and never a write — but NOT a 400 either, because the request
    // never becomes one carrying an id: `/a/b/.` collapses to `/a/b`, `/a/b/..`
    // pops a segment, and `%2E` is decoded and then collapsed the same way, so
    // none of them match the `/:id` route at all. Pinned because the reason is
    // not obvious, and because a future router change that stopped normalising
    // would silently hand these to the storage layer.
    for (const segment of ['.', '..', '%2E', '%2E%2E']) {
      const before = await fingerprint(ORG_A)
      const res = await request(app)
        .patch(`/v1/organizations/${ORG_A}/inspectionTemplates/${segment}`)
        .set('authorization', `Bearer ${users.memberA.token}`)
        .send({ data: { title: 'x' } })

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      expect(await fingerprint(ORG_A)).toEqual(before)
    }
  })

  // ── A GAP THIS SUITE FOUND AND DID NOT CLOSE ──────────────────────────────
  //
  // A NUL byte survives percent-decoding intact and reaches the handler, and it
  // is NOT one of the shapes assertUsableDocId names — that guard covers `/`,
  // `.`, `..`, the reserved `__…__` form and the 1500-byte cap, but says
  // nothing about control characters. Firestore ACCEPTS them (verified directly
  // against the emulator: NUL, BEL and an all-spaces id are all created
  // happily), so the write lands.
  //
  // This is NOT an authorization hole, and the assertions below are the proof:
  // the document is still inside the caller's own tenant and the write still
  // went through isWriterOf. What it is: an id that no screen can address, no
  // export can render honestly, and that collides visually with a legitimate
  // one — `INSP-ALPHA_0001` and `INSP-ALPHA_0001<NUL>` are the same string to
  // a human reading a page and different documents to Firestore.
  //
  // THIS TEST ASSERTS THE CURRENT BEHAVIOUR, INCLUDING THE PART THAT IS WRONG,
  // so that tightening assertUsableDocId FAILS here and is updated on purpose
  // rather than silently. If you are here because this went red: good, add the
  // control-character check and change the expectation to a refusal.
  // Was a recorded gap: a NUL survives percent-decoding and Firestore accepts
  // it, so 'nul\u0000id' and 'nulid' became two documents nobody could tell
  // apart in a log, a console or an export — which is where you go when you are
  // investigating something. Closed by assertSegment in routes/orgCollection.js,
  // which now refuses control characters in both the id and the org.
  it('refuses a document id containing a NUL byte', async () => {
    const beforeB = await fingerprint(ORG_B)
    const res = await request(app)
      .post(`/v1/organizations/${ORG_A}/inspectionTemplates/nul%00id-${RUN}`)
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { title: 'NUL in the id' } })

    expect(res.status).toBe(400)
    // Shape of the error body is asserted by errors.test.js; here the
    // refusal itself is the point.
    expect(JSON.stringify(res.body)).toContain('invalid_document_id')
    expect(await fingerprint(ORG_B)).toEqual(beforeB)

    // And an auditor still cannot use the same trick, so the gap is in the id
    // shape and not in the gate.
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(`/v1/organizations/${ORG_A}/inspectionTemplates/nul%00auditor-${RUN}`)
          .set('authorization', `Bearer ${users.auditorA.token}`)
          .send({ data: { title: 'NUL by an auditor' } }),
      { status: 403, code: 'forbidden' }
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. THE PINS — what the caller may not choose.
//    firestore.rules:690-700 (actorUid == request.auth.uid, at == request.time,
//    actorName is a three-way pin) and rules:911-918 (docSeq is server-issued
//    and strictly monotonic).
// ═════════════════════════════════════════════════════════════════════════════
describe('a client choosing a value the server pins [rules:690-700, 911-918]', () => {
  // `reserved_field`, deliberately NOT `unknown_field`: a caller sending
  // createdAt has not invented a field, it has tried to choose one the server
  // owns, and telling them "unknown field" sends them hunting a typo that is
  // not there (validate.js:172-177).
  const PINNED = [
    ['inspectionTemplates', 'createdAt', 'reserved_field'],
    ['inspectionTemplates', 'updatedAt', 'reserved_field'],
    ['inspectionTemplates', 'createdBy', 'reserved_field'],
    ['inspectionRecords', 'createdAt', 'reserved_field'],
    ['inspectionRecords', 'updatedAt', 'reserved_field'],
    ['inspectionRecords', 'docId', 'reserved_field'],
    // The audit trail's own pins have no field on the document at all, so an
    // attempt to set them is an unknown field. Either code is a refusal; what
    // matters is that neither reaches the trail.
    ['inspectionTemplates', 'actorUid', 'unknown_field'],
    ['inspectionTemplates', 'actorName', 'unknown_field'],
    ['inspectionTemplates', 'at', 'unknown_field'],
    ['inspectionTemplates', 'source', 'unknown_field'],
  ]

  for (const [collection, field, code] of PINNED) {
    it(`refuses ${collection}.${field} from the caller with ${code}`, async () => {
      const body = {
        ...COLLECTIONS.find((c) => c.name === collection).body,
        [field]: 'chosen-by-caller',
      }
      await refused(
        ORG_A,
        () =>
          request(app)
            .post(url(ORG_A, collection))
            .set('authorization', `Bearer ${users.memberA.token}`)
            .send({ data: body }),
        { status: 400, code }
      )
    })
  }

  it('pins the audit actor to the VERIFIED uid and the server clock, not to anything sent', async () => {
    const trail = db.collection('organizations').doc(ORG_A).collection('auditLogs')
    const before = new Set((await trail.get()).docs.map((d) => d.id))

    const sentAt = new Date('2019-01-01T00:00:00.000Z').toISOString()
    const res = await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.liar.token}`)
      // Nothing in here can reach the trail; the assertion is what got written.
      .send({ data: { title: 'Pinned', desc: sentAt } })
      .expect(201)

    const added = (await trail.get()).docs.filter((d) => !before.has(d.id))
    expect(added).toHaveLength(1)
    const entry = added[0].data()

    // The uid comes from the token, and the NAME from the live profile — the
    // liar's claims say admin of org B and neither value reflects that.
    expect(entry.actorUid).toBe(users.liar.uid)
    expect(entry.actorName).toBe(`member of ${ORG_A}`)
    expect(entry.source).toBe('api')
    expect(entry.targetId).toBe(res.body.id)
    // A server clock, not the browser's, and not 2019.
    expect(entry.at.toDate().getFullYear()).toBe(new Date().getFullYear())
  })

  it('never lets the caller reach auditLogs or docSeq as collections [rules:1054, 1059]', async () => {
    // The rules exclude both from the generic rule by name. Here they are
    // excluded by not being in the registry, and the refusal must hold for
    // every verb — including an ADMIN, since the trail is append-only for
    // everyone (rules:701) and the counter is delete-never (rules:919).
    for (const collection of [
      'auditLogs',
      'docSeq',
      'defectLocks',
      'users',
      'sites',
      'documents',
    ]) {
      for (const route of ROUTES) {
        const res = await attempt(route, {
          token: users.adminA.token,
          orgId: ORG_A,
          collection,
          id: 'anything',
          body: { title: 'x' },
        })
        expect({ collection, verb: route.verb, status: res.status }).toEqual({
          collection,
          verb: route.verb,
          status: 404,
        })
        expect(res.body.error.code).toBe('not_found')
      }
    }
  })

  it('cannot rewind the document counter, because the caller never names it [rules:915-918]', async () => {
    const seq = db.collection('organizations').doc(ORG_A).collection('docSeq').doc('inspections')

    const submit = () =>
      request(app)
        .post(url(ORG_A, 'inspectionRecords'))
        .set('authorization', `Bearer ${users.memberA.token}`)
        .send({ data: { templateTitle: 'Counting', score: 50 } })
        .expect(201)

    await submit()
    const first = (await seq.get()).data().n
    await submit()
    const second = (await seq.get()).data().n

    // Strictly greater, which is the rule's own word (rules:918): an equal
    // write is refused outright because a replay that re-issued the same number
    // is the exact failure the counter exists to prevent.
    expect(second).toBeGreaterThan(first)

    // And a caller sending `n`, or a docId, gets nowhere near it.
    await refused(
      ORG_A,
      () =>
        request(app)
          .post(url(ORG_A, 'inspectionRecords'))
          .set('authorization', `Bearer ${users.memberA.token}`)
          .send({ data: { templateTitle: 'Rewind', n: 1, docId: 'INSP-ALPHA_0001' } }),
      { status: 400, code: 'unknown_field' }
    )
    expect((await seq.get()).data().n).toBe(second)
  })

  // ── Two fields the server deliberately does NOT pin ────────────────────────
  //
  // Written down as tests so that nobody later reads their absence from the
  // list above as an oversight. Both are decisions with reasons attached in
  // src/routes/inspections.js, and both are places where a future tightening
  // would be a behaviour change rather than a bug fix.
  it('accepts a caller-supplied `inspector`, which is deliberate, not missed', async () => {
    // routes/inspections.js:223-232: the rule pinned identity in exactly one
    // place — the audit entry's actorUid — and pinning `inspector` too would
    // have to be undone the first time a supervisor submits a checklist for
    // somebody without a login, which is ordinary on a factory floor.
    const res = await request(app)
      .post(url(ORG_A, 'inspectionRecords'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({
        data: { templateTitle: 'On behalf of', inspector: 'Someone Else Entirely', score: 10 },
      })

    expect(res.status).toBe(201)
    // The TRAIL still names the real actor, which is what makes the above safe.
    const trail = await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('auditLogs')
      .where('targetId', '==', res.body.id)
      .get()
    expect(trail.docs[0].data().actorUid).toBe(users.memberA.uid)
  })

  it('accepts a caller-supplied `completedAt`, which the server only DEFAULTS', async () => {
    // routes/inspections.js:240-245 defaults it from the server clock when the
    // client is silent — a device with a wrong date is common on site — but a
    // supplied value is taken as sent. See the report accompanying this suite:
    // this is the one pin-shaped gap it found and did not close.
    const res = await request(app)
      .post(url(ORG_A, 'inspectionRecords'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({
        data: { templateTitle: 'Backdated', completedAt: '2019-01-01T00:00:00.000Z', score: 10 },
      })

    expect(res.status).toBe(201)
    const doc = await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('inspectionRecords')
      .doc(res.body.id)
      .get()
    expect(doc.data().completedAt).toBe('2019-01-01T00:00:00.000Z')
    // createdAt, which IS pinned, still tells the truth beside it.
    expect(doc.data().createdAt.toDate().getFullYear()).toBe(new Date().getFullYear())
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. THE NEXT MODULE — attacks that are mounted, not sent.
//
//    Everything above attacks the two collections served today. This attacks
//    the migration itself: the checks that stop the NEXT module being wired up
//    with a rule nobody implemented.
//
//    It matters because the direction of failure inverts when a rule moves off
//    Firestore. In firestore.rules a too-narrow rule is merely decorative —
//    rules are a permissive UNION, so a narrow match grants nothing and the
//    broad one still decides (rules:1043-1048). Here it is the opposite: the
//    router IS the decision, and a route missing half its rule is the weakest
//    member and it wins. So a spec this router cannot fully honour must stop
//    the server from starting rather than serve two-thirds of a rule.
//
//    Found by mutation-testing this suite: breaking these guards left every
//    other test green, because no spec exercises them yet. That is exactly the
//    condition under which the next migration would inherit a hole.
// ═════════════════════════════════════════════════════════════════════════════
describe('a collection spec that this router cannot fully honour is refused at WIRING TIME', () => {
  const base = {
    collection: 'somethingNew',
    module: 'inspections',
    writePredicate: 'isWriterOf',
    deletePredicate: 'isManagerOf',
    decisionStates: [],
    classificationFrozen: false,
    fields: { accepts: ['title'], stamps: ['createdAt'] },
    stampCreate: async ({ data }) => data,
    stampUpdate: () => ({}),
  }
  const mount = (spec) => () => createOrgCollectionRouter([{ ...base, ...spec }])

  // rules:158-169 + 204. A non-empty list means keepsDecision does real work,
  // and this router would skip it — letting a member close a permit or verify
  // an injury, the single thing the manager gate exists to stop.
  it('refuses a collection with decision states [rules:158-169]', () => {
    expect(mount({ collection: 'permits', decisionStates: ['approved', 'rejected'] })).toThrow(
      /decision states/i
    )
  })

  // rules:1002-1032. Skipping it would let a member relabel a site-restricted
  // document as one everybody can read.
  it('refuses a collection that freezes its classification [rules:1002-1032]', () => {
    expect(mount({ collection: 'somethingClassified', classificationFrozen: true })).toThrow(
      /classification/i
    )
  })

  // rules:1058 — the `col != 'sites'` conjunct makes the whole non-manager
  // branch false for sites, which is not expressible as either predicate.
  for (const collection of ['sites', 'documents']) {
    it(`refuses ${collection}, which the generic rule treats specially [rules:1058, 1042]`, () => {
      expect(mount({ collection })).toThrow(/not servable/i)
    })
  }

  // A registry naming a predicate that does not exist is a route that looks
  // guarded and is not.
  it('refuses a spec naming a predicate that does not exist', () => {
    expect(mount({ writePredicate: 'isSuperUserOf' })).toThrow(/Unknown authorization predicate/)
    expect(mount({ deletePredicate: 'isSuperUserOf' })).toThrow(/Unknown authorization predicate/)
  })

  // THE ONE THAT WAS A LIVE BYPASS. `ORG_PREDICATES['constructor']` is the
  // Object constructor — a function, therefore truthy, therefore it sails past
  // an `if (!check) throw` existence test — and `Object(caller, orgId)` returns
  // the caller, which is truthy, which reads as "the predicate passed". A guard
  // built on that name refuses NOBODY: wrong tenant, wrong role, auditor, all
  // allowed, through the middleware AND through the in-transaction assertion.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', '']) {
    it(`refuses a spec naming the inherited key ${JSON.stringify(name)} as its predicate`, () => {
      expect(mount({ writePredicate: name })).toThrow(/Unknown authorization predicate/)
      expect(mount({ deletePredicate: name })).toThrow(/Unknown authorization predicate/)
    })
  }

  // Express takes the first match, so the second spec's field allowlist would
  // silently never apply — one of the two is dead and nobody can see which.
  it('refuses two specs claiming the same collection', () => {
    expect(() => createOrgCollectionRouter([{ ...base }, { ...base }])).toThrow(/Duplicate/)
  })

  // One of the two is a typo, and the wrong reading is the one where the caller
  // wins — a field the server means to pin that it also accepts from the body.
  it('refuses a field spec that both accepts and stamps a key', () => {
    expect(mount({ fields: { accepts: ['title', 'createdAt'], stamps: ['createdAt'] } })).toThrow(
      /both accepts and stamps/
    )
  })

  it('refuses a field spec naming a dotted or reserved field', () => {
    expect(mount({ fields: { accepts: ['responses.q1'], stamps: [] } })).toThrow(/unusable field/)
    expect(mount({ fields: { accepts: ['__proto__'], stamps: [] } })).toThrow(/unusable field/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. CONTROLS — the same requests, from the people entitled to make them.
//
//    Without these the whole file above passes against a server whose routes
//    are unmounted, misrouted, or broken in any way that produces a refusal.
//    Every control here is the exact request some test above expected to fail.
// ═════════════════════════════════════════════════════════════════════════════
describe('the controls: the same requests, from the right people, succeed', () => {
  it('a MEMBER of org A creates in org A — so the auditor 403 is about the role', async () => {
    const res = await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { title: 'Legitimate', siteId: 'site-1' } })

    expect(res.status).toBe(201)
    const doc = await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('inspectionTemplates')
      .doc(res.body.id)
      .get()
    expect(doc.exists).toBe(true)
    expect(doc.data().title).toBe('Legitimate')
    // Stamped by the server, from the live profile.
    expect(doc.data().createdBy).toBe(`member of ${ORG_A}`)
    expect(doc.data().assignments).toEqual([])
  })

  it('a MEMBER of org B creates in org B — so the cross-tenant 403 is about the tenant', async () => {
    const res = await request(app)
      .post(url(ORG_B, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.memberB.token}`)
      .send({ data: { title: 'Beta legitimate' } })

    expect(res.status).toBe(201)
  })

  it('a MANAGER of org A deletes in org A — so the delete 403 is about the gate', async () => {
    const created = await request(app)
      .post(url(ORG_A, 'inspectionTemplates'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { title: 'To be deleted' } })
      .expect(201)

    await request(app)
      .delete(url(ORG_A, 'inspectionTemplates', created.body.id))
      .set('authorization', `Bearer ${users.managerA.token}`)
      .expect(200)

    const doc = await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('inspectionTemplates')
      .doc(created.body.id)
      .get()
    expect(doc.exists).toBe(false)
  })

  it('a record submit mints a server-side docId — so the docSeq tests are not vacuous', async () => {
    const res = await request(app)
      .post(url(ORG_A, 'inspectionRecords'))
      .set('authorization', `Bearer ${users.memberA.token}`)
      .send({ data: { templateTitle: 'Numbered', score: 88 } })
      .expect(201)

    const doc = await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('inspectionRecords')
      .doc(res.body.id)
      .get()
    expect(doc.data().docId).toMatch(/^INSP-ALPHA_\d{4}$/)
  })

  it('a chosen id is created once and refused the second time [rules:705-712 create-fails-if-exists]', async () => {
    const id = `exclusive-${RUN}`
    const send = () =>
      request(app)
        .post(url(ORG_A, 'inspectionTemplates', id))
        .set('authorization', `Bearer ${users.memberA.token}`)
        .send({ data: { title: 'Exclusive' } })

    await send().expect(201)
    const second = await send()
    expect({ status: second.status, code: second.body.error.code }).toEqual({
      status: 409,
      code: 'already_exists',
    })
  })
})
