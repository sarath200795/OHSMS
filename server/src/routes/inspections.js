// ─────────────────────────────────────────────────────────────────────────────
// Inspections — the first module whose writes this server owns.
//
// WHY THIS ONE FIRST. Every cross-cutting rule in firestore.rules collapses to
// a no-op for `inspectionTemplates` and `inspectionRecords`, so the first route
// can be proved against the generic rule with nothing else in the way:
//
//   decisionStates('inspectionTemplates') and ('inspectionRecords') are both []
//   (firestore.rules:158-169), so keepsDecision returns true on its
//   `s.size() == 0` short-circuit (204). A template going ACTIVE is named in the
//   rules' own comments as explicitly NOT a decision (150-152) — it is the
//   difference between a form being ready to use and a permit being approved.
//
//   Neither is `documents`, so keepsClassification returns true on its first
//   disjunct (1003). Neither is `sites`, so no manager gate lands on create or
//   update. Both are path-tenanted, so the orgId-rewrite capture class that has
//   been patched more times than anything else in the rules file does not exist
//   here at all. No public surface, no QR mirror, no exclusive-create, no
//   append-only semantics of their own.
//
//   What is left is: isWriterOf to create and update, isManagerOf to delete.
//
// WHAT IT STILL FORCES US TO BUILD RIGHT. The auditLogs writer with a
// server-pinned actor and clock (data/audit.js) and the strictly monotonic
// docSeq reserver (data/docSeq.js). Both are reused verbatim by the other nine
// modules, which is the actual reason this module is first — it is the smallest
// one that cannot be finished without them.
//
// THE FIELD SETS BELOW ARE STRICTER THAN THE RULE. The generic rule validates
// no field at all for these collections. See src/validate.js for why the server
// pins them anyway, and note the direction: refusing a write the rules allowed
// is survivable, the reverse is not.
//
// ONE WRITE TO inspectionRecords IS NOT SERVED HERE AND MUST KEEP WORKING.
// src/modules/actions/lib/sources.js:200 patches a record's `responses` to
// close a corrective action, straight to Firestore, from the actions module.
// That is the strangler fig behaving correctly: it is not an inspections write
// site, it has not moved, and firestore.rules still governs it. `responses` is
// in the accepted set below so that the day it does move, it moves without a
// change here.
// ─────────────────────────────────────────────────────────────────────────────
import { FieldValue } from 'firebase-admin/firestore'
import { reserveDocId } from '../data/docSeq.js'

/** The module key the audit viewer groups by, and the docSeq kind. `INSP-…`. */
const MODULE = 'inspections'

/**
 * The actor's display name, with the module's own fallback.
 *
 * Deliberately NOT audit.js's actorNameOf, which falls back to 'Unknown'
 * because the rule's actorName pin accepts exactly three values
 * (firestore.rules:683-689). `createdBy` is a display field with no rule
 * attached, and it has stored `''` for every template written so far
 * (modules/inspections/lib/firestore.js:65) — writing 'Unknown' into it would
 * make new rows render differently from old ones for no reason anybody asked for.
 */
const displayNameOf = (caller) => {
  const name = caller?.profile?.name
  return typeof name === 'string' ? name : ''
}

const now = () => FieldValue.serverTimestamp()

/**
 * Inspection forms. Created in the builder, edited there, switched between
 * Draft and Active from the list, and scheduled from the assignments modal.
 */
const templates = {
  collection: 'inspectionTemplates',
  module: MODULE,

  // firestore.rules:1054-1059, with every collapsing conjunct declared so that
  // the router can refuse the spec if one of them is ever wrong.
  writePredicate: 'isWriterOf',
  deletePredicate: 'isManagerOf',
  decisionStates: [],
  classificationFrozen: false,

  fields: {
    // Exactly what the form builder sends (pages/FormBuilder.jsx:151-162) plus
    // the two the list page patches on their own — `status` for Draft/Active
    // and `assignments` for the scheduler.
    accepts: [
      'title',
      'desc',
      'siteId',
      'siteName',
      'frequency',
      'status',
      'assignedFrom',
      'assignedTo',
      'fields',
      'assignments',
    ],
    stamps: ['createdBy', 'createdAt', 'updatedAt'],
  },

  async stampCreate({ caller, data }) {
    return {
      ...data,
      // The module's own default: a template with no assignments array breaks
      // the scheduler's `.length` on the first render rather than at save time.
      assignments: data.assignments || [],
      // Stamps LAST. The client put docId first and spread the payload over it
      // (lib/firestore.js:116-117), which meant a payload carrying the field
      // would win; here the field set refuses it and the order makes that
      // visible rather than incidental.
      createdBy: displayNameOf(caller),
      createdAt: now(),
      updatedAt: now(),
    }
  },

  stampUpdate() {
    return { updatedAt: now() }
  },

  audit(op, { id, data, before, after }) {
    if (op === 'create') {
      const title = after?.title || ''
      return {
        module: MODULE,
        action: 'template.create',
        target: 'template',
        targetId: id,
        targetLabel: title,
        summary: `Created inspection form "${title}"`,
      }
    }

    if (op === 'update') {
      // The module logged three different actions depending on which screen
      // made the change, and the audit viewer's filters are built on them. The
      // server cannot see the screen, so it reads the patch — which is the same
      // information, since each screen sends exactly one field.
      const keys = Object.keys(data || {})
      const only = (field) => keys.length === 1 && keys[0] === field

      if (only('assignments')) {
        return {
          module: MODULE,
          action: 'assignment.update',
          target: 'template',
          targetId: id,
          targetLabel: after?.title || '',
          summary: `Updated assignments (${(data.assignments || []).length})`,
        }
      }

      if (only('status')) {
        // setTemplateStatus logged NOTHING (lib/firestore.js:86-88). It is
        // recorded now because a form going Active is what decides which checks
        // get done at all, and "who turned this form off" was previously
        // unanswerable.
        return {
          module: MODULE,
          action: 'template.status',
          target: 'template',
          targetId: id,
          targetLabel: after?.title || '',
          summary: `Status → ${data.status}`,
        }
      }

      return {
        module: MODULE,
        action: 'template.update',
        target: 'template',
        targetId: id,
        targetLabel: data.title || before?.title || '',
        summary: 'Updated inspection form',
      }
    }

    const label = before?.title || ''
    return {
      module: MODULE,
      action: 'template.delete',
      target: 'template',
      targetId: id,
      targetLabel: label,
      summary: `Deleted inspection form "${label}"`,
    }
  },
}

/**
 * Completed inspections. One create per submitted checklist, and a delete from
 * the records list; the responses map is patched by the actions tracker, which
 * has not moved off Firestore yet.
 */
const records = {
  collection: 'inspectionRecords',
  module: MODULE,

  writePredicate: 'isWriterOf',
  deletePredicate: 'isManagerOf',
  decisionStates: [],
  classificationFrozen: false,

  fields: {
    // pages/Execute.jsx:150-166.
    accepts: [
      'templateId',
      'templateTitle',
      'siteId',
      'siteName',
      'area',
      'assignmentId',
      'inspector',
      'completedAt',
      'scheduledFor',
      'dueString',
      'frequency',
      'score',
      'passFailResult',
      'responses',
    ],
    stamps: ['docId', 'createdAt', 'updatedAt'],
  },

  /**
   * `inspector` is left to the caller ON PURPOSE, though it names a person.
   *
   * The rule pinned identity in exactly one place — the audit entry's actorUid
   * (firestore.rules:664-669) — and this server pins it there, from the verified
   * token, for every write it serves. Pinning `inspector` as well would invent a
   * constraint the rules never had and would have to be undone the first time a
   * supervisor submits a checklist on behalf of someone without a login, which
   * is an ordinary thing on a factory floor.
   */
  async stampCreate({ tx, db, orgId, data }) {
    // Before the record write, because Firestore requires every read in a
    // transaction to precede every write and this reads three documents. The
    // number and the record now commit together — see data/docSeq.js.
    const docId = await reserveDocId(tx, db, { orgId, kind: MODULE })
    return {
      ...data,
      docId,
      // The server's clock, not the browser's, when the client did not say. A
      // device with a wrong date is common on site and an inspection dated next
      // year sorts to the top of every list forever.
      completedAt: data.completedAt || new Date().toISOString(),
      createdAt: now(),
    }
  },

  stampUpdate() {
    // Records carry no updatedAt when they are submitted, and this does not add
    // one — but an inspection whose evidence was changed afterwards is a
    // different document from the one that was submitted, and the trail says
    // who while this says when.
    return { updatedAt: now() }
  },

  audit(op, { id, data, before, after }) {
    if (op === 'create') {
      const title = after?.templateTitle || ''
      return {
        module: MODULE,
        action: 'inspection.submit',
        target: 'record',
        targetId: id,
        targetLabel: title,
        summary: `Submitted "${title}" — ${after?.score}% (${after?.passFailResult})`,
      }
    }

    if (op === 'update') {
      return {
        module: MODULE,
        action: 'record.update',
        target: 'record',
        targetId: id,
        targetLabel: after?.templateTitle || before?.templateTitle || '',
        summary: `Updated inspection record (${Object.keys(data || {}).join(', ')})`,
      }
    }

    return {
      module: MODULE,
      action: 'record.delete',
      target: 'record',
      targetId: id,
      targetLabel: before?.templateTitle || '',
      summary: 'Deleted inspection record',
    }
  },
}

/** The two collections, in the shape createOrgCollectionRouter compiles. */
export const INSPECTION_COLLECTIONS = [templates, records]
