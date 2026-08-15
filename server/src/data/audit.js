// ─────────────────────────────────────────────────────────────────────────────
// The append-only audit trail, written with a pinned actor and a pinned clock.
//
// THE RULE THIS REPLACES (firestore.rules:662-702):
//
//   read:   isApprovedMemberOf(orgId)
//   create: isApprovedMemberOf(orgId)
//        && request.resource.data.actorUid == request.auth.uid
//        && request.resource.data.at == request.time
//        && (actorName == myProfile().name || actorName == 'Unknown' || actorName == '')
//   update, delete: if false
//
// Four things in that are decisions rather than plumbing:
//
//   isApprovedMemberOf, NOT isWriterOf. An auditor's own actions must still be
//   recorded. A trail that stops writing for the one role whose whole job is to
//   look at the records is a trail with a hole shaped exactly like the person
//   most likely to be investigated.
//
//   actorUid pins WHO and `at == request.time` pins WHEN (664-669). Without the
//   timestamp pin a member could file a real entry under their own uid, dated
//   last Tuesday, describing somebody else's action. This server does better
//   than the rule: both come from the verified token and the server clock, and
//   ANYTHING the caller sent for either is ignored. There is no field for them
//   in the entry a route hands over.
//
//   actorName is a THREE-WAY pin, not a strict profile match (683-689), and the
//   looseness is the point: logAudit falls back to 'Unknown' for an actor with
//   no name, so a strict pin would stop recording those users SILENTLY. Losing
//   the trail is worse than a soft name.
//
//   update and delete are `false`, full stop. This module exposes neither, and
//   no route may — an editable audit trail is a document that says whatever the
//   last person to touch it wanted it to say.
//
// AND ONE INHERITED BEHAVIOUR THAT LOOKS LIKE A BUG: this swallows its own
// failures. The client's logAudit does the same (modules/inspections/lib/
// firestore.js:43-46, shared/org/orgData.js:64-67) so that an audit write can
// never break the action it describes. An inspector standing on a factory floor
// must not lose a completed checklist because a log entry would not write. The
// failure goes to the log with the request id, where it is somebody's alert
// rather than the inspector's problem.
//
// That is also why the entry is written AFTER the caller's transaction commits
// rather than inside it. In the transaction, a failed audit write would roll
// back the inspection — the exact inversion of the behaviour above.
// ─────────────────────────────────────────────────────────────────────────────
import { FieldValue } from 'firebase-admin/firestore'
import { log } from '../log.js'

export const AUDIT_COLLECTION = 'auditLogs'

/**
 * The actor's name, resolved the way logAudit resolves it.
 *
 * Falls back to 'Unknown', which is one of the three values the rule's pin
 * accepts. Read defensively — a profile that has never carried a name is
 * ordinary, and the rule reads it with `.get('name','')` for that reason
 * (firestore.rules:691-697).
 */
export function actorNameOf(caller) {
  const name = caller?.profile?.name
  return typeof name === 'string' && name.trim() !== '' ? name : 'Unknown'
}

/**
 * Append one entry. Resolves either way — see the header.
 *
 * `entry` carries only what the trail is ABOUT. Who and when are not arguments
 * and cannot be passed: the moment they are parameters, some later route
 * forwards the caller's own values into them and the pin is gone.
 */
export async function writeAuditEntry(db, { orgId, caller, entry }) {
  if (!orgId || !caller?.uid) return null

  const ref = db.collection('organizations').doc(orgId).collection(AUDIT_COLLECTION).doc()

  try {
    // .create(), not .set(). The rule allows create and nothing else, and the
    // Admin SDK's set() would happily overwrite an existing entry — on a
    // server-minted id that is unreachable today, and it is one word to make it
    // unreachable by construction rather than by luck.
    await ref.create({
      // Pinned. Not from `entry`, which has no key for either.
      at: FieldValue.serverTimestamp(),
      actorUid: caller.uid,
      actorName: actorNameOf(caller),

      // Free-form, as the rules leave it (firestore.rules:659-661) — the trail
      // records many shapes. `source` is not a field the browser writes for
      // this module; it is here so that during the migration an operator can
      // tell an entry this server wrote from one a browser wrote directly, and
      // therefore tell whether a module's writes have actually moved.
      action: entry.action,
      module: entry.module,
      target: entry.target,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel || '',
      summary: entry.summary || '',
      source: 'api',
    })
    return ref.id
  } catch (err) {
    // Never the entry itself. A summary on this system can name a person and
    // what happened to them, and a log line outlives the request.
    log.warn('audit entry failed', {
      orgId,
      uid: caller.uid,
      action: entry.action,
      detail: err?.message,
    })
    return null
  }
}
