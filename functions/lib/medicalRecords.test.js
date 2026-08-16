import { describe, it, expect } from 'vitest'
import {
  planMedicalRecordMove,
  movedStoragePath,
  landedIntact,
  MEDICAL_RECORD_KIND,
  MAX_MOVES_PER_RUN,
  LEGACY_KIND,
} from './medicalRecords.js'

const ORG = 'orgA'

/** A pointer as addIncidentPhoto actually wrote it: ten fields, no personId. */
const legacyRecord = (over = {}) => ({
  id: 'p1',
  name: 'discharge.pdf',
  type: 'application/pdf',
  dataUrl: '',
  url: 'https://firebasestorage.googleapis.com/v0/b/x/o/f?alt=media&token=abc',
  path: `orgs/${ORG}/incident-photos/deadbeefdeadbeef-discharge.pdf`,
  size: 4096,
  caption: '',
  kind: LEGACY_KIND,
  uploadedBy: 'Priya',
  uploadedAt: { seconds: 1700000000 },
  ...over,
})

const incident = (over = {}) => ({
  id: 'inc1',
  refNo: 'INC-001',
  injuryReports: [{ personId: 'u1', personName: 'A Kumar' }],
  photos: [legacyRecord()],
  ...over,
})

/** The injury documents that exist, as index.js reads them: id + deletedAt. */
const injuriesWith = (...ids) => new Map(ids.map((id) => [id, {}]))

const planOne = (over = {}, injuries = injuriesWith('inc1__u1')) =>
  planMedicalRecordMove([incident(over)], injuries, ORG)

describe('moving a medical record pointer', () => {
  it('files it under the injury it belongs to, keeping the document id', () => {
    const plan = planOne()
    expect(plan.records).toBe(1)
    expect(plan.moves).toHaveLength(1)
    expect(plan.moves[0].injuryId).toBe('inc1__u1')
    // The destination id is the SOURCE id, which is what makes an interrupted
    // run resumable: a second attempt lands on the same document rather than
    // creating a second copy of somebody's discharge summary.
    expect(plan.moves[0].photoId).toBe('p1')
  })

  // The reason this migration exists at all. A stored getDownloadURL is a
  // bearer link that answers to no rule: confining the pointer while copying its
  // url forward would move the document and leave the door.
  it('drops the permanent download URL rather than carrying it across', () => {
    const plan = planOne()
    expect('url' in plan.moves[0].doc).toBe(false)
    expect(plan.urlsDropped).toBe(1)
  })

  // A label on a row in a shared collection is the thing that did not work.
  it('drops the kind label, because the collection is the boundary now', () => {
    expect('kind' in planOne().moves[0].doc).toBe(false)
  })

  it('writes the incident and the person onto the record itself', () => {
    const [move] = planOne().moves
    expect(move.doc.incidentId).toBe('inc1')
    expect(move.doc.personId).toBe('u1')
  })

  it('carries the file, its name and its caption unchanged', () => {
    const [move] = planOne({ photos: [legacyRecord({ caption: 'Fit note, week 2' })] }).moves
    expect(move.doc.name).toBe('discharge.pdf')
    expect(move.doc.type).toBe('application/pdf')
    expect(move.doc.size).toBe(4096)
    expect(move.doc.caption).toBe('Fit note, week 2')
    expect(move.doc.uploadedBy).toBe('Priya')
    expect(move.doc.uploadedAt).toEqual({ seconds: 1700000000 })
  })

  // Rebuilt by removal, not by allow-list: a field added to a pointer after
  // this was written must not be silently dropped by the job that moves it.
  it('carries a field this migration has never heard of', () => {
    const [move] = planOne({ photos: [legacyRecord({ takenAt: 'later', reviewedBy: 'Dr Rao' })] }).moves
    expect(move.doc.takenAt).toBe('later')
    expect(move.doc.reviewedBy).toBe('Dr Rao')
  })

  it('leaves ordinary scene photos exactly where they are', () => {
    const plan = planOne({
      photos: [legacyRecord(), { ...legacyRecord({ id: 'p2' }), kind: 'photo' }],
    })
    expect(plan.photos).toBe(2)
    expect(plan.records).toBe(1)
    expect(plan.moves.map((m) => m.photoId)).toEqual(['p1'])
  })

  it('finds nothing to do on an incident with no photos at all', () => {
    const plan = planMedicalRecordMove([incident({ photos: undefined })], injuriesWith('inc1__u1'), ORG)
    expect(plan.moves).toEqual([])
    expect(plan.blocked).toEqual([])
  })
})

describe('deciding whose record it is', () => {
  // The old shape never stored it: StepInjuryReports passes personId into
  // onAddPhoto and addIncidentPhoto writes ten fields that do not include it.
  it('deduces the person when the incident injured exactly one', () => {
    expect(planOne().moves[0].personId).toBe('u1')
  })

  it('uses a personId the pointer carries, even when several were injured', () => {
    const plan = planOne({
      injuryReports: [{ personId: 'u1' }, { personId: 'u2' }],
      photos: [legacyRecord({ personId: 'u2' })],
    }, injuriesWith('inc1__u2'))
    expect(plan.moves[0].personId).toBe('u2')
    expect(plan.moves[0].injuryId).toBe('inc1__u2')
  })

  // Guessing here files one colleague's discharge summary under another
  // colleague's name — a worse outcome than the exposure staying open a day,
  // and one nobody re-checks after a migration reports success.
  it('refuses to guess between two injured people, and reports the row', () => {
    const plan = planOne({ injuryReports: [{ personId: 'u1' }, { personId: 'u2' }] })
    expect(plan.moves).toEqual([])
    expect(plan.blocked).toEqual([
      { incidentId: 'inc1', refNo: 'INC-001', photoId: 'p1', reason: 'several-people' },
    ])
  })

  it('treats the same person listed twice as one candidate', () => {
    const plan = planOne({ injuryReports: [{ personId: 'u1' }, { personId: 'u1' }] })
    expect(plan.moves).toHaveLength(1)
  })

  // The portal's own report path writes { name, uid } and never a personId, so
  // there is nothing to join on at all.
  it('reports a record on an incident whose injury rows name no person', () => {
    const plan = planOne({ injuryReports: [{ name: 'A Kumar' }] })
    expect(plan.blocked[0].reason).toBe('no-person-id')
  })

  it('reports a record on an incident with no injury rows at all', () => {
    const plan = planOne({ injuryReports: undefined })
    expect(plan.blocked[0].reason).toBe('no-person-id')
  })

  // purgeIncidentMedicalRecords finds these by querying /injuries for the
  // incident. A record filed under an injury document that does not exist
  // outlives the purge of the incident it documents, unreachable by any query
  // in the product. seedInjuryRecords is the fix, and runs first.
  it('refuses to file under an injury record that does not exist', () => {
    const plan = planMedicalRecordMove([incident()], new Map(), ORG)
    expect(plan.moves).toEqual([])
    expect(plan.blocked[0].reason).toBe('no-injury-record')
  })

  // Different from planMedicalStrip, deliberately: there /injuries was about to
  // become the only copy of a field, so a soft-deleted record was too fragile to
  // lean on. Here the file is not destroyed by the move, and leaving it in the
  // photo album is the exposure. It moves, and it is counted.
  it('moves a record under a soft-deleted injury, and says so', () => {
    const plan = planMedicalRecordMove(
      [incident()],
      new Map([['inc1__u1', { deletedAt: { seconds: 1 } }]]),
      ORG,
    )
    expect(plan.moves).toHaveLength(1)
    expect(plan.underDeletedInjury).toBe(1)
  })

  // Every blocked row has to be findable and carry nothing clinical. A filename
  // like "MRI-left-knee — A Kumar.pdf" IS the record.
  it('never names the file in a blocked row', () => {
    const plan = planOne({ injuryReports: [{ personId: 'u1' }, { personId: 'u2' }] })
    expect(Object.keys(plan.blocked[0]).sort()).toEqual(['incidentId', 'photoId', 'reason', 'refNo'])
    expect(JSON.stringify(plan.blocked)).not.toContain('discharge')
  })

  it('counts the blocked rows by reason', () => {
    const plan = planMedicalRecordMove(
      [
        incident({ id: 'inc1', injuryReports: [{ personId: 'u1' }, { personId: 'u2' }] }),
        incident({ id: 'inc2', injuryReports: [] }),
        incident({ id: 'inc3', injuryReports: [{ personId: 'u9' }] }),
      ],
      new Map(),
      ORG,
    )
    expect(plan.blockedReasons).toEqual({ 'several-people': 1, 'no-person-id': 1, 'no-injury-record': 1 })
  })
})

describe('moving the bytes as well as the pointer', () => {
  // storage.rules excludes exactly one prefix from its generic member-wide read.
  // A record whose bytes stay under `incident-photos` is byte-identical to a
  // photograph of a guard rail and indistinguishable to any rule — the narrow
  // grant would be decorative for every record that already exists.
  it('sends the object to the medical-records prefix, filename intact', () => {
    const [move] = planOne().moves
    expect(move.fromPath).toBe(`orgs/${ORG}/incident-photos/deadbeefdeadbeef-discharge.pdf`)
    expect(move.toPath).toBe(`orgs/${ORG}/${MEDICAL_RECORD_KIND}/deadbeefdeadbeef-discharge.pdf`)
    expect(move.doc.path).toBe(move.toPath)
    expect(planOne().filesToMove).toBe(1)
  })

  // The entropy prefix is what stops two records called scan.pdf colliding at
  // the destination, and what makes a re-run compute the same answer.
  it('computes the same destination twice', () => {
    const p = `orgs/${ORG}/incident-photos/abc123-scan.pdf`
    expect(movedStoragePath(p, ORG)).toBe(movedStoragePath(p, ORG))
  })

  // The resumed run: the object went last time, the pointer delete did not.
  it('leaves a path already under the medical prefix unchanged', () => {
    const path = `orgs/${ORG}/${MEDICAL_RECORD_KIND}/abc123-scan.pdf`
    const [move] = planOne({ photos: [legacyRecord({ path })] }).moves
    expect(move.toPath).toBe(path)
    expect(move.fromPath).toBe(path)
    expect(planOne({ photos: [legacyRecord({ path })] }).filesToMove).toBe(0)
  })

  // Below MAX_INLINE_BYTES with no bucket configured, the file is base64 on the
  // pointer itself — the document IS the medical record, and there is nothing
  // in Storage to chase.
  it('moves an inlined record with no object behind it', () => {
    const [move] = planOne({
      photos: [legacyRecord({ path: '', url: '', dataUrl: 'data:application/pdf;base64,AAA' })],
    }).moves
    expect(move.fromPath).toBe('')
    expect(move.toPath).toBe('')
    expect(move.doc.dataUrl).toBe('data:application/pdf;base64,AAA')
    expect(planOne({ photos: [legacyRecord({ path: '', dataUrl: 'data:x,A' })] }).inlineRecords).toBe(1)
  })

  // `path` is client-writable and this runs with Admin SDK privileges that never
  // consult storage.rules. Without the check, a pointer naming another tenant's
  // object would have this job copy that object into this org and delete the
  // original — the same trap ownedByOrg() guards in the retention sweep.
  it('refuses a path belonging to another organization', () => {
    const plan = planOne({ photos: [legacyRecord({ path: 'orgs/orgB/incident-photos/victim.jpg' })] })
    expect(plan.moves).toEqual([])
    expect(plan.blocked[0].reason).toBe('foreign-path')
  })

  it('refuses a path that climbs out of the prefix', () => {
    expect(movedStoragePath(`orgs/${ORG}/incident-photos/../../orgB/x.pdf`, ORG)).toBe(null)
  })

  it('refuses a path that is not the shape storagePath writes', () => {
    expect(movedStoragePath(`orgs/${ORG}/incident-photos`, ORG)).toBe(null)
    expect(movedStoragePath(`orgs/${ORG}/incident-photos/nested/x.pdf`, ORG)).toBe(null)
    expect(movedStoragePath(`orgs/${ORG}//x.pdf`, ORG)).toBe(null)
    expect(movedStoragePath('x.pdf', ORG)).toBe(null)
    expect(movedStoragePath(`orgs/${ORG}/incident-photos/x.pdf`, '')).toBe(null)
  })
})

describe('the pointer that would land on no screen', () => {
  // subscribeMedicalRecords orders by uploadedAt, and Firestore drops documents
  // missing the ordered field. A record sorted wrongly is recoverable; a record
  // on no screen is not. index.js stamps one, because a pure function cannot
  // mint a server timestamp.
  it('flags a legacy pointer with no uploadedAt', () => {
    const [move] = planOne({ photos: [legacyRecord({ uploadedAt: undefined })] }).moves
    expect(move.needsUploadedAt).toBe(true)
  })

  it('leaves a pointer that already has one alone', () => {
    expect(planOne().moves[0].needsUploadedAt).toBe(false)
  })

  // A key holding undefined makes the Admin SDK reject the whole write, and the
  // write is what the copy, the proof and both deletions are sequenced behind.
  it('emits no key holding undefined', () => {
    const [move] = planOne({ photos: [legacyRecord({ uploadedAt: undefined, caption: undefined })] }).moves
    expect(Object.values(move.doc).some((v) => v === undefined)).toBe(false)
    expect('caption' in move.doc).toBe(false)
  })
})

describe('capping a run', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => incident({
    id: `inc${i}`,
    injuryReports: [{ personId: 'u1' }],
    photos: [legacyRecord({ id: `p${i}` })],
  }))
  const allInjuries = (n) => new Map(Array.from({ length: n }, (_, i) => [`inc${i}__u1`, {}]))

  it('moves no more than one run may finish, and reports the rest', () => {
    const plan = planMedicalRecordMove(many(5), allInjuries(5), ORG, { cap: 2 })
    expect(plan.moves).toHaveLength(2)
    expect(plan.records).toBe(5)
    expect(plan.remaining).toBe(3)
    expect(plan.capped).toBe(true)
  })

  it('does not cap a run that fits', () => {
    const plan = planMedicalRecordMove(many(3), allInjuries(3), ORG, { cap: 200 })
    expect(plan.capped).toBe(false)
    expect(plan.remaining).toBe(0)
    expect(MAX_MOVES_PER_RUN).toBeGreaterThan(0)
  })
})

// This predicate is the safety property. Nothing is deleted until it answers
// true against a document read back out of Firestore, so a crash between the
// write and the delete leaves the record in both places rather than neither.
describe('proving the new record landed', () => {
  const doc = { name: 'a.pdf', size: 10, path: 'orgs/orgA/medical-records/x-a.pdf', personId: 'u1' }

  it('accepts a faithful copy', () => {
    expect(landedIntact(doc, { ...doc })).toBe(true)
  })

  it('refuses when there is no document there at all', () => {
    expect(landedIntact(doc, null)).toBe(false)
    expect(landedIntact(doc, undefined)).toBe(false)
  })

  it('refuses when the file it names is different', () => {
    expect(landedIntact(doc, { ...doc, path: 'orgs/orgA/medical-records/x-b.pdf' })).toBe(false)
  })

  it('refuses when the person it belongs to is different', () => {
    expect(landedIntact(doc, { ...doc, personId: 'u2' })).toBe(false)
  })

  it('refuses when a field simply did not arrive', () => {
    const { size: _size, ...missing } = doc
    expect(landedIntact(doc, missing)).toBe(false)
  })

  // The seed writes a number where injuryPayload passes a string through; the
  // same latitude preservedIn allows for a clinical value.
  it('accepts a size that came back as a string', () => {
    expect(landedIntact(doc, { ...doc, size: '10' })).toBe(true)
  })

  // The server stamps it, so it cannot match, and a false mismatch here would
  // stall the record in both places forever.
  it('ignores the timestamp the server minted', () => {
    expect(landedIntact({ ...doc, uploadedAt: null }, { ...doc, uploadedAt: { seconds: 99 } })).toBe(true)
  })
})
