# Data subject rights

What this system can answer when a person asks to see, or to delete, what is
held about them — and, just as importantly, what it cannot.

This app stores occupational-health data: injuries, illnesses, medical
restrictions, GP letters, fit notes. Under GDPR and India's DPDP Act 2023 that
is sensitive personal data, and both give the subject rights over it.

**Status: access is implemented. Erasure is classified but not executed.** The
reason for the split is in §3, and it is a legal decision rather than an
engineering one.

---

## 1. Where a person's data actually is

`functions/lib/subjectData.js` is the inventory, and it is the foundation of
everything else here. It exists because neither question — "show me my data",
"delete my data" — can be answered without first knowing every place the data
is, and this system denormalises people heavily.

A person appears in **two fundamentally different ways**, and only one of them
can be found by a query:

| | How | Completeness |
|---|---|---|
| **Joined** | A structural key names them: `personId` on an injury, `employeeUid` on a training record, `actorUid` in the audit log, the uid on their own profile. | **Complete.** Indexed, exact, every record found. |
| **Mentioned** | Their *name* is free text inside an object in an array: `affectedPersonnel[].name`, `attendees[].name`, `commanders[]`, `capa[].owner`. | **Cannot be queried at all.** Firestore has no substring or nested-object search. |

The export returns these separately and never merges them. That is deliberate:
a response that silently omitted the committee minutes naming someone is a
*failed* subject access response, not a partial one, and the only way to avoid
claiming completeness it does not have is to say where it stopped.

## 2. Subject access (implemented)

**Admin → Maintenance → Subject access request.** Enter the person's uid,
press Gather, download the JSON.

Server-side it is `exportSubjectData` in `functions/index.js`:

- **Manager-only.** The same standing `firestore.rules` requires to read
  `/injuries` and `/illnesses` (`isManagerOf`). Anything less would let a member
  assemble a colleague's medical history in a single call — a bulk export
  concentrates data in a way the individual screens do not.
- **Org-scoped, checked against the subject's own profile.** A uid is not a
  secret, so without this a manager of any tenant could export any uid.
- **Reports its own failures.** A collection that cannot be read appears in
  `problems` rather than being quietly absent.

### The trap this design is built around

Every scannable field is also a field `src/shared/crypto/policy.js` **seals** —
names are personal data, so of course it does. Join keys are deliberately left
readable so queries keep working.

So the moment `VITE_ENCRYPTION=on` and the backfill has run, a server-side scan
for a name reads ciphertext and finds nothing. **Zero matches is
indistinguishable from a person who is genuinely not mentioned.** That is a
silent wrong answer to a legal request.

`scanFeasibility()` exists to say so out loud, and the UI surfaces it. Once
encryption is on, the mentions half has to be done in the browser of somebody
entitled to the keys, or recorded as not performed. It must never be reported as
"none found".

## 3. Erasure (classified, not executed)

The export returns a classification of every source into three buckets. Nothing
deletes anything yet, and that is the correct state until somebody with legal
authority signs off the table.

| Bucket | Meaning | Examples |
|---|---|---|
| **Refused — statutory** | OHS law requires retention; the right to erasure does not reach it (GDPR Art. 17(3)(b), DPDP s.17(1)). | `injuries`, `illnesses`, `incidents`, `consultations`, `trainingRecords`, `auditLogs` |
| **Anonymise** | The record must survive for aggregate safety reporting but need not name anybody. | `users`, `mockDrills` |
| **Erasable** | No safety evidence once resolved. | `trainingRequests`, `trainingAssignments`, `erpContacts` |

**The refusal is a deliverable, not a failure.** In an occupational-health
system the honest answer to "delete everything about me" is mostly "most of this
cannot be deleted, and here is each part and why". Every entry in the table
carries a `why` written to be sent to the person asking.

And the refusal usually protects *them*: an injury record is the worker's own
evidence of what happened to them at work. Deleting it on request destroys the
thing they would need to prove a claim years later.

### ⚠️ Before erasure is built, someone with legal authority must fix the table

The retention classes in `subjectData.js` are an **engineering reading of the
law, not advice**. Jurisdiction changes them, and this app is multi-tenant, so
different tenants may sit under different regimes. Specifically:

- Exposure and health-surveillance records carry the longest statutory periods
  and the exact number varies by jurisdiction and by agent.
- No retention *period* is encoded anywhere — only a class. A record classed
  `STATUTORY` is currently kept forever, which is itself a data-protection
  finding: indefinite retention is not lawful merely because some retention is.
- `auditLogs` is append-only in the rules by design. Erasing from it is not
  currently possible even if it were decided to be lawful.

## 4. What is NOT built

- **Execution of erasure.** Classification only. See the warning above.
- **Retention periods.** Only the Recycle Bin's 30-day purge exists
  (`functions/lib/retention.js`). Live records have no expiry.
- **The mentions scan.** The places are named; nothing searches them.
- **Self-service.** A subject cannot make the request themselves; a manager runs
  it for them. Reasonable while volumes are low, and it should be revisited if
  they are not.

## 5. Keeping the inventory honest

`SUBJECT_SOURCES` and `POLICY` describe the same personal data for different
purposes, and they live in **different npm packages**, so no import can tie them
together. A collection added to one and not the other is a silent gap — in
`policy.js` it means storing a name in the clear, in `subjectData.js` it means
leaving a person's data out of their own export.

`EXPECTED_SEALED` in `subjectData.js` is checked by the test suite for exactly
this. When you add a collection that holds personal data, update both, or the
test tells you which one you forgot.
