# LOTO permits

A per-job permit on top of the isolation procedures in `src/modules/loto`. The
procedure says *how* to isolate a machine and is approved once; the permit says
*this crew isolates it, for this job, in this shift window*. Controlling
standard cited on screens and printouts: **OSHA 29 CFR 1910.147**.

## Where it lives

`organizations/{orgId}/lotoPermits/{permitNo}` — path-tenanted. (The root
`procedures` / `locks` / `technicians` collections are tenanted by an `orgId`
field; see `LOTO-COLLECTIONS.md`. Permits do not deepen that pattern.)

Subcollections: `events` (append-only history), `attachments` (create-only).

## Permit number

`LP-<UTC year>-<NNNN>`, one sequence per org per year. The number is the document
id. The counter is `organizations/{orgId}/docSeq/lotoPermit-<year>` (`{ n }`) and
the rules require the counter bump to be in **the same commit** as the permit
(`getAfter`), so a client cannot pick, reuse or skip a number.

## Status machine

```
requested ──► approved ──► active ──► returned
    │            │           └──────► emergency_removed
    ├──► rejected└──► withdrawn
    └──► withdrawn
```

`returned`, `rejected`, `withdrawn` and `emergency_removed` are closed: the rules
match no update for them, so a closed permit is immutable. The table lives in
`constants/permits.js` (drives the buttons) and `firestore.rules`
(`lotoPermitUpdate`, the one that cannot be bypassed).

## Who may do what

| Action | Who |
| --- | --- |
| Raise | any approved, non-auditor member |
| Withdraw (before work starts) | the requester, or an Admin |
| Approve / reject / extend / emergency removal | Admin (`lotoPermitAdmin()` in the rules — one place to narrow to site/entity grants later) |
| Start isolation / return | the requester, a named internal person, or an Admin |

The platform has no site-admin role: `isAdminOf(orgId)` is org-wide, and site /
entity scoping applies to the *mail audience* (`functions/lib/audience.js`), not
to rules. Self-approval is refused unless the approver records that there was no
other administrator (`approval.selfApproved` + `selfApprovalReason`).

## Procedure ↔ permit consistency

While a permit is `active`, its procedure carries `activePermit: { id, permitNo }`.
The marker is set and cleared **only in the same commit** as the permit becoming
`active` / closing (`keepsActivePermit` in the rules, wired into the legacy
`procedures` create/update rules), and the procedure's `lockedCount` cannot fall
while it is set.

## Personal data

`reason`, every name on the permit (requester, approver, internal personnel,
contractors, lock holders) and free-text notes are sealed
(`src/shared/crypto/policy.js`: `lotoPermits`, `lotoPermits/events`,
`lotoPermits/attachments`). Uids, lock numbers, status, window, scope fields and
procedure ids stay readable: they are join keys, mail scope and filters.

The authorised-technician register (`technicians`: name, contact) is now sealed
too and is covered by the backfill (`root: true` target). The technician name
copied onto a procedure's `lockState` at lock time is a separate, still-open
copy.

Subject-access export / erasure: `functions/lib/subjectData.js` lists permits (by
`requestedBy` and by `personnelUids`), their events/attachments, technicians and
locks. `exportSubjectData` constrains the root collections by their `orgId`
field.

## Retention

Closed permits are kept **1 year** from closure and then purged with their events
and attachments (`purgeClosedLotoPermits`, PR C). Open permits are never purged.
