// ─────────────────────────────────────────────────────────────────────────────
// The write path for an org subcollection — the generic rule, as express.
//
// WHAT IT REIMPLEMENTS. firestore.rules:1034-1078, for a collection that hits
// none of the special cases:
//
//   create, update: isWriterOf(orgId)
//                && (isElevatedOf(orgId) || keepsClassification(col))
//                && (isManagerOf(orgId) || (col != 'sites' && keepsDecision(col, before, after)))
//   delete:         isManagerOf(orgId)
//
// For a collection with no decision states and which is not `documents` and not
// `sites`, every conjunct after the first collapses: keepsClassification returns
// true on its first disjunct (1003) and keepsDecision returns true on the
// `s.size() == 0` short-circuit (204). What is left is isWriterOf to write and
// isManagerOf to delete — and that is the whole authorization surface a spec
// registered here is allowed to have.
//
// SO A SPEC MUST DECLARE THAT, AND IS REFUSED AT WIRING TIME IF IT CANNOT. This
// router does not implement keepsDecision or keepsClassification. A collection
// that needs either — permits, incidents, documents, training, audits — is not
// servable here yet, and the honest failure is a server that will not start
// rather than one that starts and ignores the half of the rule it never
// learned. In firestore.rules a too-narrow rule was merely decorative, because
// rules are a permissive union; here it inverts, and a route with a missing
// check is the weakest member and it wins (firestore.rules:516-517, 929-931).
//
// THREE THINGS THE ROUTES DO THAT THE VERBS DO NOT SAY:
//
//   1. CLASSIFY BY DOCUMENT EXISTENCE, NOT BY HTTP VERB. Rules treat
//      `resource == null` as a create, so a set() over an existing document is
//      an UPDATE. PUT reads the document first and stamps accordingly; the
//      predicate happens to be the same either way for these collections, but
//      the stamping is not, and a `createdAt` re-stamped on every save is a
//      list that reorders itself for no reason.
//
//   2. RE-READ THE CALLER INSIDE THE TRANSACTION. The middleware ran before the
//      handler and the write happens after it. Rules had no such gap — they
//      evaluate against committed state at write time — so the check that
//      actually protects the data is assertOrgAccess() against a profile
//      re-read through the transaction, which commits or aborts with the write.
//      The middleware is still there: it refuses the obvious without opening a
//      transaction, and it makes each route's intent readable at its declaration.
//
//   3. USE .create() WHERE THE RULE RELIED ON create-failing-if-exists. The
//      Admin SDK's set() OVERWRITES, so it succeeds exactly where the rule
//      refused (firestore.rules:705-712 — the defect lock's whole duplicate
//      check is that a create over an existing document fails). Nothing in this
//      module depends on it yet; the primitive is built here, correct, so the
//      module that does depend on it is not the one inventing it.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express'
import { assertOrgAccess, predicateFor, reloadCaller, requireOrgAccess } from '../authz/index.js'
import { writeAuditEntry } from '../data/audit.js'
import { ApiError } from '../errors.js'
import { getDb } from '../firestore.js'
import { compileFieldSpec, readDocumentFields } from '../validate.js'

/** gRPC status codes the Admin SDK raises on a write, by name. */
const ALREADY_EXISTS = 6
const NOT_FOUND = 5

/**
 * Express 4 does not catch a rejected promise from a handler — it hangs the
 * request until the client gives up, which reads as a dead server rather than
 * as the error it is. Every handler here is wrapped.
 */
const asyncRoute = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next)
}

/**
 * A document id Firestore will actually accept, checked before it is used.
 *
 * `.` and `..` are path segments to the SDK and throw from deep inside it, and
 * `__anything__` is reserved. Without this the caller gets a 500 carrying a
 * stack trace from the storage layer for what is plainly a bad request.
 */
/**
 * One Firestore path segment, and nothing that pretends to be one.
 *
 * A rule matches `/organizations/{orgId}/{col}/{docId}` where each brace binds
 * exactly ONE segment, so a slash cannot smuggle a value past the match. The
 * Admin SDK has no such property: `.doc('a/b')` expands into two segments and
 * lands somewhere the tenancy comparison above never looked at. Rejecting the
 * separator is what makes the server's comparison the same comparison the rule
 * was making.
 *
 * Control characters go too. A NUL survives percent-decoding and Firestore
 * accepts it, so `nul%00id` and `nulid` become two documents that are
 * indistinguishable in any log, console or export anyone would use to
 * investigate them.
 */
function assertSegment(value, what, code) {
  const bad =
    typeof value !== 'string' ||
    value === '' ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^__.*__$/.test(value) ||
    Buffer.byteLength(value, 'utf8') > 1500
  if (bad) throw new ApiError(400, code, `${what}: ${String(value).slice(0, 64)}`)
}

function assertUsableDocId(id) {
  assertSegment(id, 'document id', 'invalid_document_id')
}

/**
 * The tenant id decides everything downstream, so it gets the same treatment
 * BEFORE it is compared against the caller's profile or used to build a ref.
 */
function assertUsableOrgId(orgId) {
  assertSegment(orgId, 'organization id', 'invalid_organization_id')
}

/**
 * Turn a storage-layer failure into the code that says what happened.
 *
 * Both of these are ordinary outcomes of a correct request racing another one,
 * not server faults, and a 500 would send a client into a retry loop against a
 * request that can never succeed. `document_not_found` is deliberately its own
 * code and not the router's `not_found`: a client that cannot tell "no such
 * document" from "no such route" will treat a wiring mistake as a missing row
 * and go on to create one.
 */
function translateWriteError(err) {
  if (err?.code === ALREADY_EXISTS) return new ApiError(409, 'already_exists', err.message)
  if (err?.code === NOT_FOUND) return new ApiError(404, 'document_not_found', err.message)
  return err
}

/**
 * Compile one collection's spec, refusing anything this router cannot honour.
 *
 * Every check here is a rule this file does not implement. Failing at startup
 * is the point: the alternative is a route that looks registered and enforces
 * two-thirds of its rule.
 */
function compileSpec(spec) {
  const { collection } = spec
  if (typeof collection !== 'string' || collection === '' || collection.includes('/')) {
    throw new Error(`Collection spec has an unusable collection name: ${JSON.stringify(collection)}`)
  }

  // firestore.rules:158-169. A non-empty list means keepsDecision does real
  // work for this collection, and this router would silently skip it — letting
  // a member close a permit or verify an injury, which is the single thing the
  // manager gate exists to stop.
  if (spec.decisionStates?.length) {
    throw new Error(`${collection} declares decision states; keepsDecision is not implemented here`)
  }
  // firestore.rules:1002-1032. Only `documents` freezes its classification, and
  // skipping it would let a member relabel a site-restricted document as one
  // everybody can read.
  if (spec.classificationFrozen) {
    throw new Error(`${collection} freezes its classification; keepsClassification is not implemented here`)
  }
  // firestore.rules:1058 — the `col != 'sites'` conjunct makes the whole
  // non-manager branch false for sites. It is not expressible as one of the two
  // predicates below, so a spec for it belongs to whoever implements it.
  if (collection === 'sites' || collection === 'documents') {
    throw new Error(`${collection} is not servable by the generic collection router`)
  }
  // A registry naming a predicate that does not exist is a route that looks
  // guarded and is not — and, through an inherited Object.prototype key, one
  // that would refuse NOBODY. predicateFor is the own-property lookup that
  // closes both, and calling it here moves the failure to startup.
  predicateFor(spec.writePredicate)
  predicateFor(spec.deletePredicate)

  return { ...spec, fields: compileFieldSpec(spec.fields) }
}

/** `organizations/{orgId}/{collection}` as an Admin SDK collection reference. */
const collectionRef = (db, orgId, collection) =>
  db.collection('organizations').doc(orgId).collection(collection)

/**
 * The audit entry for an operation, or null when a spec does not describe one.
 *
 * Derived entirely from what the server knows — the collection, the operation,
 * the id it minted and the document it just wrote. Nothing about the trail is
 * taken from the request: an `action` a caller could choose is an action a
 * caller can misname, and the whole value of the entry is that it was not
 * written by the person it describes.
 */
const auditFor = (spec, op, ctx) => (spec.audit ? spec.audit(op, ctx) : null)

function collectionRouter(spec, { db }) {
  const router = Router({ mergeParams: true })
  const canWrite = requireOrgAccess(spec.writePredicate, (req) => req.params.orgId)
  const canDelete = requireOrgAccess(spec.deletePredicate, (req) => req.params.orgId)

  /** Everything after the transaction: the audit entry, then the response. */
  async function finish(req, res, { status, id, caller, entry }) {
    if (entry) await writeAuditEntry(db(), { orgId: req.params.orgId, caller, entry })
    res.status(status).json({ id })
  }

  // ── create: a server-minted id ────────────────────────────────────────────
  router.post(
    '/',
    canWrite,
    asyncRoute(async (req, res) => {
      const orgId = req.params.orgId
      assertUsableOrgId(orgId)
      // Before any I/O. A body that will be refused should not cost a
      // transaction, and a refusal that arrives after a read is a refusal that
      // can be made to cost something by whoever sends the worst body.
      const data = readDocumentFields(req.body, spec.fields)
      const store = db()
      const ref = collectionRef(store, orgId, spec.collection).doc()

      const { caller, written } = await store
        .runTransaction(async (tx) => {
          const fresh = await reloadCaller(req.caller, tx)
          assertOrgAccess(fresh, orgId, spec.writePredicate)
          const doc = await spec.stampCreate({ tx, db: store, orgId, caller: fresh, data })
          tx.create(ref, doc)
          return { caller: fresh, written: doc }
        })
        .catch((err) => {
          throw translateWriteError(err)
        })

      await finish(req, res, {
        status: 201,
        id: ref.id,
        caller,
        entry: auditFor(spec, 'create', { id: ref.id, data, after: written }),
      })
    })
  )

  // ── createExclusive: the caller names the id, and a collision is refused ───
  router.post(
    '/:id',
    canWrite,
    asyncRoute(async (req, res) => {
      const orgId = req.params.orgId
      assertUsableOrgId(orgId)
      assertUsableDocId(req.params.id)
      const data = readDocumentFields(req.body, spec.fields)
      const store = db()
      const ref = collectionRef(store, orgId, spec.collection).doc(req.params.id)

      const { caller, written } = await store
        .runTransaction(async (tx) => {
          const fresh = await reloadCaller(req.caller, tx)
          assertOrgAccess(fresh, orgId, spec.writePredicate)
          const doc = await spec.stampCreate({ tx, db: store, orgId, caller: fresh, data })
          // .create() and never .set(): the existence test and the write are
          // one operation at the backend. A get-then-set passes every test on a
          // quiet day and corrupts under load.
          tx.create(ref, doc)
          return { caller: fresh, written: doc }
        })
        .catch((err) => {
          throw translateWriteError(err)
        })

      await finish(req, res, {
        status: 201,
        id: ref.id,
        caller,
        entry: auditFor(spec, 'create', { id: ref.id, data, after: written }),
      })
    })
  )

  // ── set: replace, or merge, classified by whether the document is there ───
  router.put(
    '/:id',
    canWrite,
    asyncRoute(async (req, res) => {
      const orgId = req.params.orgId
      assertUsableOrgId(orgId)
      assertUsableDocId(req.params.id)
      const data = readDocumentFields(req.body, spec.fields)
      const merge = req.body?.merge === true
      const store = db()
      const ref = collectionRef(store, orgId, spec.collection).doc(req.params.id)

      const result = await store
        .runTransaction(async (tx) => {
          const fresh = await reloadCaller(req.caller, tx)
          assertOrgAccess(fresh, orgId, spec.writePredicate)
          const snap = await tx.get(ref)
          const before = snap.exists ? snap.data() : null

          if (!before) {
            const doc = await spec.stampCreate({ tx, db: store, orgId, caller: fresh, data })
            tx.set(ref, doc)
            return { caller: fresh, before: null, after: doc, created: true }
          }

          const patch = { ...data, ...spec.stampUpdate({ caller: fresh, data, before }) }
          if (merge) {
            tx.set(ref, patch, { merge: true })
            return { caller: fresh, before, after: { ...before, ...patch }, created: false }
          }
          // A wholesale replace replaces the CALLER'S fields. The server's
          // stamps survive it, because they were never the caller's to send and
          // are therefore not theirs to erase — and because a template that
          // lost its createdAt would drop straight out of the only listener that
          // lists templates (orderBy('createdAt','desc')) and read as deleted.
          const kept = {}
          for (const key of spec.fields.stamp) {
            if (key in before && !(key in patch)) kept[key] = before[key]
          }
          const doc = { ...kept, ...patch }
          tx.set(ref, doc)
          return { caller: fresh, before, after: doc, created: false }
        })
        .catch((err) => {
          throw translateWriteError(err)
        })

      await finish(req, res, {
        status: result.created ? 201 : 200,
        id: ref.id,
        caller: result.caller,
        entry: auditFor(spec, result.created ? 'create' : 'update', {
          id: ref.id,
          data,
          before: result.before,
          after: result.after,
        }),
      })
    })
  )

  // ── update: a patch over a document that must already be there ────────────
  router.patch(
    '/:id',
    canWrite,
    asyncRoute(async (req, res) => {
      const orgId = req.params.orgId
      assertUsableOrgId(orgId)
      assertUsableDocId(req.params.id)
      const data = readDocumentFields(req.body, spec.fields)
      const store = db()
      const ref = collectionRef(store, orgId, spec.collection).doc(req.params.id)

      const result = await store
        .runTransaction(async (tx) => {
          const fresh = await reloadCaller(req.caller, tx)
          assertOrgAccess(fresh, orgId, spec.writePredicate)
          const snap = await tx.get(ref)
          // Refusing rather than upserting is a guarantee callers lean on: the
          // incidents stats document is SEEDED by catching this rejection, and
          // an adapter that quietly created the document instead would rewind
          // the sequence counter it seeds beside it.
          if (!snap.exists) throw new ApiError(404, 'document_not_found', `${spec.collection}/${req.params.id}`)

          const patch = { ...data, ...spec.stampUpdate({ caller: fresh, data, before: snap.data() }) }
          tx.update(ref, patch)
          // The merged post-state, because that is what a rule sees:
          // request.resource.data is the full document after the write, not the
          // patch. No guard reads it for these collections — a spec that needed
          // one is refused at wiring time — but the audit entry describes the
          // document, not the diff.
          return { caller: fresh, before: snap.data(), after: { ...snap.data(), ...patch } }
        })
        .catch((err) => {
          throw translateWriteError(err)
        })

      await finish(req, res, {
        status: 200,
        id: ref.id,
        caller: result.caller,
        entry: auditFor(spec, 'update', { id: ref.id, data, before: result.before, after: result.after }),
      })
    })
  )

  // ── remove: the manager gate ──────────────────────────────────────────────
  router.delete(
    '/:id',
    canDelete,
    asyncRoute(async (req, res) => {
      const orgId = req.params.orgId
      assertUsableOrgId(orgId)
      assertUsableDocId(req.params.id)
      const store = db()
      const ref = collectionRef(store, orgId, spec.collection).doc(req.params.id)

      const result = await store
        .runTransaction(async (tx) => {
          const fresh = await reloadCaller(req.caller, tx)
          assertOrgAccess(fresh, orgId, spec.deletePredicate)
          const snap = await tx.get(ref)
          // Read for the label, not as a precondition: deleting a document that
          // is not there is not an error, and making it one would turn a
          // double-click into a red toast about something that already happened.
          tx.delete(ref)
          return { caller: fresh, before: snap.exists ? snap.data() : null }
        })
        .catch((err) => {
          throw translateWriteError(err)
        })

      await finish(req, res, {
        status: 200,
        id: ref.id,
        caller: result.caller,
        entry: auditFor(spec, 'remove', { id: ref.id, before: result.before }),
      })
    })
  )

  return router
}

/**
 * One router for every migrated org subcollection.
 *
 * Mounted so that a path reads exactly as the Firestore path does —
 * `/v1/organizations/{orgId}/{collection}` for `organizations/{orgId}/{collection}`
 * — which is what lets the client's data seam address a route with the same
 * string it already uses to address a collection, without a translation table
 * that can disagree with itself.
 *
 * A collection NOT in the registry gets a 404 from the app's own handler, which
 * sits behind requireAuth: an anonymous caller cannot use the difference
 * between 404 and 401 to discover which collections have moved.
 *
 * `db` is a getter rather than a handle so that importing this module needs no
 * credentials — the same reason src/firestore.js initialises lazily.
 */
export function createOrgCollectionRouter(specs, { db = getDb } = {}) {
  const router = Router()
  const seen = new Set()

  for (const raw of specs) {
    const spec = compileSpec(raw)
    // Two specs for one collection means one of them is dead and nobody can see
    // which — express takes the first match, so the second's field allowlist
    // would silently never apply.
    if (seen.has(spec.collection)) throw new Error(`Duplicate collection spec: ${spec.collection}`)
    seen.add(spec.collection)
    router.use(`/:orgId/${spec.collection}`, collectionRouter(spec, { db }))
  }

  return router
}
