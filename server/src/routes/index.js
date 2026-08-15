// ─────────────────────────────────────────────────────────────────────────────
// Where module routes get mounted.
//
// A route that writes before the rule protecting that write has been
// reimplemented is worse than no route at all, so this file grows one module at
// a time. Everything mounted here has already passed requireAuth (a verified
// uid) and requireProfile (the live /users profile), so a handler here starts
// from `req.caller.uid` and whatever src/authz/ attached — never from an orgId
// in the path or the body. An orgId the client sent is an ASSERTION TO BE
// COMPARED against the profile, exactly as isApprovedMemberOf(orgId) compares a
// path segment (firestore.rules:63-68).
//
// The order writes move, and why, is in README.md. Inspections is first
// because every cross-cutting rule collapses to a no-op for its two
// collections, so the first route can be proved against the generic rule
// (firestore.rules:1034-1078) with nothing else in the way.
//
// WHY THE MOUNT PATH MIRRORS THE FIRESTORE PATH. `/v1/organizations/{orgId}/
// {collection}` addresses exactly what `organizations/{orgId}/{collection}`
// addresses, so the client's data seam can reach a route with the same string
// it already uses for the collection (src/shared/data/adapters/http.js). A
// module-shaped URL would need a translation table on both sides, and the day
// the two disagree is the day a write lands somewhere nobody meant.
//
// A collection that is NOT registered falls through to the app's 404 handler,
// which sits behind requireAuth — so nobody without a login can use the
// difference between 404 and 401 to map which modules have moved.
//
// ONE SURFACE THAT MUST NOT BE MOUNTED HERE AT ALL. The public QR paths
// (/reports, /observations, /defectLocks) are anonymous, and firestore.rules
// keeps their hasOnly() INSIDE the anonymous branch rather than above both,
// because a constraint on the member branch is silently overridden by the
// generic rule (firestore.rules:762-767). The server equivalent is a separate
// router with no auth middleware and its own exhaustive validation — not an
// optional-auth flag on a handler in here.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express'
import { INSPECTION_COLLECTIONS } from './inspections.js'
import { createOrgCollectionRouter } from './orgCollection.js'

export const apiRouter = Router()

// Migration order (see README.md §Strangler fig):
//   1. inspections   inspectionTemplates, inspectionRecords   ← served here
//   2. objectives    objectives
//   3. cctv          cameras, dvrs, merakis
//   ... and the rest, once the primitives each needs are proved.
//
// One router for every migrated org subcollection. Each spec declares the
// predicates it is served under and is REFUSED AT STARTUP if it needs a rule
// this router does not implement — see createOrgCollectionRouter.
apiRouter.use('/organizations', createOrgCollectionRouter([...INSPECTION_COLLECTIONS]))
