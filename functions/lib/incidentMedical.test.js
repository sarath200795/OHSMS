import { describe, it, expect } from 'vitest'
import {
  planMedicalStrip, planInjurySeed, preservedIn, injuryDocId, MEDICAL_FIELDS,
} from './incidentMedical.js'

const INC = 'inc1'

/** An incident carrying the full Step 1a shape for one person. */
const incident = (reports, id = INC) => ({ id, refNo: 'IRA-2026-0007', injuryReports: reports })

const report = (over = {}) => ({
  personId: 'EMP-104',
  personName: 'Priya Nair',
  firstAidDone: true,
  firstAidDetail: 'Wound dressed on site',
  injuryType: 'Laceration',
  bodyParts: ['hand_l', 'wrist_l'],
  medication: 'Analgesic',
  daysToReturnToWork: 5,
  ...over,
})

/** The matching /injuries document — the copy that is about to become the only one. */
const injuryMap = (over = {}, personId = 'EMP-104', incidentId = INC) =>
  new Map([[
    injuryDocId(incidentId, personId),
    {
      incidentId,
      personId,
      personName: 'Priya Nair',
      firstAidDone: true,
      firstAidDetail: 'Wound dressed on site',
      injuryType: 'Laceration',
      bodyParts: ['hand_l', 'wrist_l'],
      medication: 'Analgesic',
      daysToReturnToWork: 5,
      deletedAt: null,
      ...over,
    },
  ]])

const only = (plan) => plan.writes[0].patch.injuryReports[0]

describe('the id the two copies are joined on', () => {
  // If this drifts from injuryId() in src/modules/incidents/lib/injuries.js the
  // proof looks up nothing, finds nothing, and blocks every record in the org.
  it('matches the app', () => {
    expect(injuryDocId('inc1', 'EMP-104')).toBe('inc1__EMP-104')
  })
})

describe('proving a value survives the move', () => {
  it('accepts an identical value', () => {
    expect(preservedIn('Laceration', 'Laceration')).toBe('preserved')
  })

  // The seed writes daysToReturnToWork as a number and injuryPayload passes it
  // through untouched, so the two copies of one answer legitimately differ in
  // type. Blocking on that would strand every seeded record.
  it('reads 5 and "5" as the same answer', () => {
    expect(preservedIn(5, '5')).toBe('preserved')
  })

  it('calls an absent or blank injury value missing', () => {
    expect(preservedIn('Analgesic', undefined)).toBe('missing')
    expect(preservedIn('Analgesic', '  ')).toBe('missing')
    expect(preservedIn(['hand_l'], [])).toBe('missing')
  })

  it('calls a different value a difference, not an absence', () => {
    expect(preservedIn('Analgesic', 'Ibuprofen')).toBe('differs')
  })

  // Containment, not equality: /injuries listing more body parts than the
  // incident loses nothing when the incident's shorter list goes.
  it('accepts a longer list in the injury record', () => {
    expect(preservedIn(['hand_l'], ['hand_l', 'wrist_l', 'arm_l'])).toBe('preserved')
  })

  it('refuses when the incident lists a part the injury record does not', () => {
    expect(preservedIn(['hand_l', 'head'], ['hand_l'])).toBe('differs')
  })
})

describe('planning the strip', () => {
  it('removes every medical field once the injury record is proved to hold them', () => {
    const plan = planMedicalStrip([incident([report()])], injuryMap())
    const entry = only(plan)
    MEDICAL_FIELDS.forEach((f) => expect(entry).not.toHaveProperty(f))
    expect(plan.blocked).toEqual([])
    expect(plan.confined).toBe(5) // recordFileIds was never on the entry
  })

  it('keeps the join key, the name and the first-aid flag', () => {
    const entry = only(planMedicalStrip([incident([report()])], injuryMap()))
    expect(entry).toEqual({ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true })
  })

  // The whole point of the safety check. Removing these would not confine the
  // data, it would delete the only record of somebody's injury.
  it('touches nothing when the injury record is missing, and reports it', () => {
    const plan = planMedicalStrip([incident([report()])], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.blocked).toEqual([{
      incidentId: INC,
      refNo: 'IRA-2026-0007',
      personId: 'EMP-104',
      personName: 'Priya Nair',
      reason: 'no-injury-record',
      fields: ['bodyParts', 'injuryType', 'medication', 'firstAidDetail', 'daysToReturnToWork'],
    }])
  })

  it('keeps a field the injury record does not carry, and moves the ones it does', () => {
    const plan = planMedicalStrip([incident([report()])], injuryMap({ medication: '' }))
    const entry = only(plan)
    expect(entry.medication).toBe('Analgesic')
    expect(entry).not.toHaveProperty('bodyParts')
    expect(entry).not.toHaveProperty('injuryType')
    expect(plan.blocked).toEqual([expect.objectContaining({ reason: 'missing-in-injury', fields: ['medication'] })])
  })

  // A value that disagrees is not a value that is safe to drop. Somebody edited
  // one copy and not the other, and only a human knows which one is right.
  it('keeps a field whose injury copy says something else', () => {
    const plan = planMedicalStrip([incident([report()])], injuryMap({ injuryType: 'Fracture' }))
    expect(only(plan).injuryType).toBe('Laceration')
    expect(plan.blocked[0]).toMatchObject({ reason: 'differs-in-injury', fields: ['injuryType'] })
  })

  // The portal's report path writes { name, uid, injuryType, bodyParts } and
  // never calls syncIncidentInjuries, so no /injuries document has ever existed
  // for these. The incident is the only copy there is.
  it('never touches a portal-filed entry, which has no personId at all', () => {
    const portal = { name: 'Ravi Kumar', uid: 'u9', injuryType: 'Burn', bodyParts: ['hand_r'] }
    const plan = planMedicalStrip([incident([portal])], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0]).toMatchObject({
      reason: 'no-person-id',
      personName: 'Ravi Kumar', // read off `name`, or the row names nobody
      fields: ['bodyParts', 'injuryType'],
    })
  })

  // Nothing purges /injuries yet, but a soft-deleted injury shows on no screen —
  // subscribeInjuries filters it out. Leaning on it as the sole surviving copy
  // is the cascade audit MEDIUM-33 is about to add.
  it('refuses to rely on an injury record that is in the Recycle Bin', () => {
    const plan = planMedicalStrip([incident([report()])], injuryMap({ deletedAt: new Date() }))
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0].reason).toBe('injury-record-deleted')
  })

  it('reports field names and never values', () => {
    const plan = planMedicalStrip([incident([report()])], new Map())
    expect(JSON.stringify(plan.blocked)).not.toContain('Analgesic')
    expect(JSON.stringify(plan.blocked)).not.toContain('hand_l')
  })

  // An empty field carries no medical detail, so there is nothing to prove and
  // nothing to lose — otherwise a blank medication would block a whole record.
  it('drops empty fields without needing an injury record at all', () => {
    const sparse = { personId: 'EMP-9', personName: 'Sam', medication: '', bodyParts: [], firstAidDetail: '   ' }
    const plan = planMedicalStrip([incident([sparse])], new Map())
    expect(only(plan)).toEqual({ personId: 'EMP-9', personName: 'Sam' })
    expect(plan.emptied).toBe(3)
    expect(plan.confined).toBe(0)
    expect(plan.blocked).toEqual([])
  })

  // 0 is an answer — the person returned the same day.
  it('does not treat 0 days to return as empty', () => {
    const plan = planMedicalStrip([incident([report({ daysToReturnToWork: 0 })])], injuryMap({ daysToReturnToWork: '' }))
    expect(only(plan).daysToReturnToWork).toBe(0)
    expect(plan.blocked[0]).toMatchObject({ reason: 'missing-in-injury', fields: ['daysToReturnToWork'] })
  })

  // Rebuilt by removal, not by allow-list: a field added to this shape after
  // this migration was written must not be quietly deleted by it.
  it('leaves fields it does not know about alone', () => {
    const plan = planMedicalStrip([incident([report({ witnessStatement: 'saw it happen' })])], injuryMap())
    expect(only(plan).witnessStatement).toBe('saw it happen')
  })

  it('leaves a null array element alone rather than rebuilding it', () => {
    const plan = planMedicalStrip([incident([null, report()])], injuryMap())
    expect(plan.writes[0].patch.injuryReports[0]).toBe(null)
  })

  // Idempotence is the point: this gets run twice by someone unsure whether the
  // first run took, and after the UI stops writing these fields at all.
  it('writes nothing on a second pass', () => {
    const first = planMedicalStrip([incident([report()])], injuryMap())
    const cleaned = { ...incident([]), injuryReports: first.writes[0].patch.injuryReports }
    const second = planMedicalStrip([cleaned], injuryMap())
    expect(second.writes).toEqual([])
    expect(second.alreadyClean).toBe(1)
  })

  it('counts an incident with no injury reports as already clean', () => {
    const plan = planMedicalStrip([incident([]), { id: 'inc2' }], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.alreadyClean).toBe(2)
    expect(plan.stillExposed).toBe(0)
  })

  // Reporting a fully blocked incident as "clean" would say the exposure is
  // closed while it is still open — the one thing a migration report must never
  // do, because it is the number the rules change gets shipped on.
  it('counts an incident it could not strip as still exposed, not as clean', () => {
    const plan = planMedicalStrip([incident([report()])], new Map())
    expect(plan.alreadyClean).toBe(0)
    expect(plan.stillExposed).toBe(1)
  })

  it('counts a partially stripped incident as still exposed too', () => {
    const plan = planMedicalStrip([incident([report()])], injuryMap({ medication: '' }))
    expect(plan.writes).toHaveLength(1)
    expect(plan.alreadyClean).toBe(0)
    expect(plan.stillExposed).toBe(1)
  })

  it('plans each person in one incident separately', () => {
    const two = incident([report(), report({ personId: 'EMP-9', personName: 'Sam' })])
    const plan = planMedicalStrip([two], injuryMap())
    const [first, second] = plan.writes[0].patch.injuryReports
    expect(first).not.toHaveProperty('medication')
    expect(second.medication).toBe('Analgesic') // no injury record for EMP-9
    expect(plan.blocked[0]).toMatchObject({ personId: 'EMP-9', reason: 'no-injury-record' })
  })

  it('does not let one blocked record stop the rest of the org', () => {
    const plan = planMedicalStrip(
      [incident([report()], 'inc1'), incident([report()], 'inc2')],
      injuryMap(),
    )
    expect(plan.writes.map((w) => w.id)).toEqual(['inc1'])
    expect(plan.blocked.map((b) => b.incidentId)).toEqual(['inc2'])
    expect(plan.blockedFields).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Seeding — step one, which puts the detail INTO /injuries.
//
// The strip's guard fired on production data with an injury document already
// present (incidents: 1, injuries: 1, toWrite: 0, blocked: 1), so every one of
// these cases has to be told apart: the ones a record can be built or completed
// from, and the ones where doing so would forge a sign-off, revive a deleted
// record, overwrite a manager's correction or attach a colleague's medical
// detail to a person nobody named.
// ─────────────────────────────────────────────────────────────────────────────

/** The incident fields a new injury record needs to render as more than a blank row. */
const withContext = (inc) => ({
  ...inc,
  incidentDate: '2026-03-04',
  type: 'injury',
  severity: 'lost_time',
  location: 'Bay 3',
})

/** What the batch does: set(patch, { merge: true }) onto whatever is there. */
const applySeed = (injuries, plan) => {
  const next = new Map(injuries)
  for (const w of plan.writes) next.set(w.id, { ...(next.get(w.id) || {}), ...w.patch })
  return next
}

const seedOnly = (plan) => {
  expect(plan.writes).toHaveLength(1)
  return plan.writes[0]
}

describe('seeding the injury record', () => {
  it('writes to the id the Injuries page reads, and the strip proves against', () => {
    const plan = planInjurySeed([withContext(incident([report()]))], new Map())
    expect(seedOnly(plan).id).toBe(injuryDocId(INC, 'EMP-104'))
  })

  // Shape C: no injury document at all, and a personId to key one on. The main
  // body of the job.
  it('creates the whole record from the incident when none exists', () => {
    const plan = planInjurySeed([withContext(incident([report()]))], new Map())
    const w = seedOnly(plan)
    expect(w.create).toBe(true)
    expect(w.patch).toEqual({
      incidentId: INC,
      incidentRefNo: 'IRA-2026-0007',
      personId: 'EMP-104',
      personName: 'Priya Nair',
      firstAidDone: true,
      firstAidDetail: 'Wound dressed on site',
      injuryType: 'Laceration',
      bodyParts: ['hand_l', 'wrist_l'],
      medication: 'Analgesic',
      daysToReturnToWork: 5,
      recordFileIds: [],
      incidentDate: '2026-03-04',
      incidentType: 'injury',
      severity: 'lost_time',
      location: 'Bay 3',
      deletedAt: null,
    })
    expect(plan.created).toBe(1)
    expect(plan.completed).toBe(0)
    expect(plan.seeded).toBe(5)
    expect(plan.blocked).toEqual([])
  })

  // Nobody reviewed this. Stamping it verified would forge the one thing
  // /injuries exists to carry, so the absent status reads as pending.
  it('creates the record as pending, never as verified', () => {
    const w = seedOnly(planInjurySeed([withContext(incident([report()]))], new Map()))
    expect(w.patch).not.toHaveProperty('status')
    expect(w.patch).not.toHaveProperty('verifiedBy')
    expect(w.patch.deletedAt).toBe(null)
  })

  // The incident context is why index.js reads more of the incident than the
  // strip does: without it the Injuries page shows a medical record nobody can
  // place — no date, no reference, no location.
  it('carries the incident context onto a new record', () => {
    const bare = planInjurySeed([incident([report()])], new Map())
    expect(seedOnly(bare).patch).toMatchObject({
      incidentDate: '', incidentType: '', severity: '', location: '',
    })
  })

  // Shape A: the record is there, some answers are not.
  it('fills only the fields the injury record has no answer for', () => {
    const plan = planInjurySeed(
      [withContext(incident([report()]))],
      injuryMap({ medication: '', daysToReturnToWork: '' }),
    )
    const w = seedOnly(plan)
    expect(w.create).toBe(false)
    expect(w.patch).toEqual({ medication: 'Analgesic', daysToReturnToWork: 5 })
    expect(w.fields).toEqual(['medication', 'daysToReturnToWork'])
    expect(plan.completed).toBe(1)
    expect(plan.created).toBe(0)
    expect(plan.seeded).toBe(2)
    expect(plan.alreadyHeld).toBe(3) // bodyParts, injuryType, firstAidDetail
  })

  // /injuries is the system of record and the incident copy is the stale
  // duplicate. Filling a gap is the whole licence; nothing else is included in
  // the patch, so a merge cannot touch an answer that is already there.
  it('never puts a field the injury record already answers into the patch', () => {
    const plan = planInjurySeed([withContext(incident([report()]))], injuryMap({ medication: '' }))
    const w = seedOnly(plan)
    expect(Object.keys(w.patch)).toEqual(['medication'])
    expect(w.patch).not.toHaveProperty('injuryType')
    expect(w.patch).not.toHaveProperty('personName')
  })

  it('writes nothing when the injury record already holds everything', () => {
    const plan = planInjurySeed([withContext(incident([report()]))], injuryMap())
    expect(plan.writes).toEqual([])
    expect(plan.blocked).toEqual([])
    expect(plan.alreadyComplete).toBe(1)
    expect(plan.alreadyHeld).toBe(5)
  })

  // Containment, exactly as the strip reads it: a longer list in /injuries
  // already covers the incident's shorter one, so there is no gap to fill.
  it('treats a longer list in the injury record as already held', () => {
    const plan = planInjurySeed(
      [withContext(incident([report({ bodyParts: ['hand_l'] })]))],
      injuryMap(),
    )
    expect(plan.writes).toEqual([])
  })

  // An empty field carries nothing. Seeding it would write blanks into the
  // system of record and report them as work done — and the strip drops those
  // without proof anyway.
  it('does not seed a field the incident holds blank', () => {
    const sparse = { personId: 'EMP-9', personName: 'Sam', medication: '', bodyParts: [], firstAidDetail: '   ' }
    const plan = planInjurySeed([withContext(incident([sparse]))], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.alreadyComplete).toBe(1)
    expect(plan.blocked).toEqual([])
  })

  // 0 is an answer — the person returned the same day — and ?? rather than ||
  // is what keeps it from becoming ''.
  it('seeds a same-day return as 0, not as blank', () => {
    const plan = planInjurySeed(
      [withContext(incident([report({ daysToReturnToWork: 0 })]))],
      injuryMap({ daysToReturnToWork: '' }),
    )
    expect(seedOnly(plan).patch).toEqual({ daysToReturnToWork: 0 })
  })

  it('reports field names and never values', () => {
    const portal = { name: 'Ravi Kumar', uid: 'u9', injuryType: 'Burn', bodyParts: ['hand_r'] }
    const plan = planInjurySeed([withContext(incident([portal]))], new Map())
    expect(JSON.stringify(plan.blocked)).not.toContain('Burn')
    expect(JSON.stringify(plan.blocked)).not.toContain('hand_r')
  })
})

describe('what seeding refuses to repair', () => {
  // Shape D2. The doc id is built from the person; there is no id to write to,
  // and a name-derived key collides the moment two people share a name.
  it('will not invent an id for a row that names nobody', () => {
    const anon = { personName: 'Ravi Kumar', injuryType: 'Burn', bodyParts: ['hand_r'] }
    const plan = planInjurySeed([withContext(incident([anon]))], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.blocked).toEqual([{
      incidentId: INC,
      refNo: 'IRA-2026-0007',
      personId: '',
      personName: 'Ravi Kumar',
      reason: 'no-person-id',
      fields: ['bodyParts', 'injuryType'],
    }])
  })

  // Shape D1 — the legacy portal's { name, uid, ... }. `uid` is the same
  // identity the fixed portal now writes as personId, so the key is guessable.
  // Reported under its own reason precisely because it is: promoting a sign-in
  // id to a person id is an identity decision about whose medical record this
  // is, and it is one edit for an admin who can see the incident.
  it('will not promote a sign-in id to a person id, and says so separately', () => {
    const portal = { name: 'Ravi Kumar', uid: 'u9', injuryType: 'Burn', bodyParts: ['hand_r'] }
    const plan = planInjurySeed([withContext(incident([portal]))], new Map())
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0]).toMatchObject({
      reason: 'sign-in-id-only',
      personName: 'Ravi Kumar', // read off `name`, or the row names nobody
      fields: ['bodyParts', 'injuryType'],
    })
  })

  // Both app writers decline to touch a verified record. Adding unreviewed
  // fields underneath somebody's sign-off makes the sign-off cover data nobody
  // signed off.
  it('will not add anything to a verified injury record', () => {
    const plan = planInjurySeed(
      [withContext(incident([report()]))],
      injuryMap({ medication: '', status: 'verified' }),
    )
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0]).toMatchObject({ reason: 'injury-record-verified', personId: 'EMP-104' })
  })

  it('treats a record with no status as pending and seeds it', () => {
    const injuries = injuryMap({ medication: '' })
    delete injuries.get(injuryDocId(INC, 'EMP-104')).status
    const plan = planInjurySeed([withContext(incident([report()]))], injuries)
    expect(seedOnly(plan).fields).toEqual(['medication'])
  })

  // Writing into a soft-deleted record makes a Recycle Bin document the sole
  // surviving copy, and clearing deletedAt un-deletes what a human deleted.
  it('will not write into an injury record that is in the Recycle Bin', () => {
    const plan = planInjurySeed(
      [withContext(incident([report()]))],
      injuryMap({ medication: '', deletedAt: new Date() }),
    )
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0]).toMatchObject({ reason: 'injury-record-deleted' })
  })

  // Two copies disagree and only a human knows which is right. Overwriting
  // /injuries would destroy the value a manager corrected on the Injuries page.
  it('will not overwrite a field whose injury copy says something else', () => {
    const plan = planInjurySeed(
      [withContext(incident([report()]))],
      injuryMap({ injuryType: 'Fracture' }),
    )
    expect(plan.writes).toEqual([])
    expect(plan.blocked[0]).toMatchObject({ reason: 'differs-in-injury', fields: ['injuryType'] })
  })

  // Per field, like the strip: one disagreement must not strand the gaps beside
  // it, or a single corrected value keeps four others exposed forever.
  it('still fills the gaps beside a field it refuses to overwrite', () => {
    const plan = planInjurySeed(
      [withContext(incident([report()]))],
      injuryMap({ injuryType: 'Fracture', medication: '' }),
    )
    expect(seedOnly(plan).patch).toEqual({ medication: 'Analgesic' })
    expect(plan.blocked.map((b) => b.reason)).toEqual(['differs-in-injury'])
  })
})

describe('an injury record no row names', () => {
  // Shape B: the wizard keys on affectedPersonnel.id and the portal keyed on the
  // auth uid, so one person can hold a record under one id and a row under
  // another. That is how a run reports injuries: 1 and blocked: 1 at once.
  it('creates the row its own record and reports the other, never merging them', () => {
    const foreign = new Map([[injuryDocId(INC, 'WIZ-7'), {
      incidentId: INC, personId: 'WIZ-7', injuryType: 'Sprain', deletedAt: null,
    }]])
    const plan = planInjurySeed([withContext(incident([report()]))], foreign)
    expect(seedOnly(plan).id).toBe(injuryDocId(INC, 'EMP-104'))
    expect(plan.writes[0].patch.injuryType).toBe('Laceration')
    expect(plan.orphanInjuries).toEqual([
      { injuryId: injuryDocId(INC, 'WIZ-7'), incidentId: INC, personId: 'WIZ-7' },
    ])
  })

  it('names no clinical detail in the orphan report', () => {
    const foreign = new Map([[injuryDocId(INC, 'WIZ-7'), {
      incidentId: INC, personId: 'WIZ-7', personName: 'Someone Else', medication: 'Ibuprofen',
    }]])
    const plan = planInjurySeed([withContext(incident([report()]))], foreign)
    expect(JSON.stringify(plan.orphanInjuries)).not.toContain('Ibuprofen')
    expect(JSON.stringify(plan.orphanInjuries)).not.toContain('Someone Else')
  })

  it('does not call a record an orphan when its own row named it', () => {
    const plan = planInjurySeed([withContext(incident([report()]))], injuryMap())
    expect(plan.orphanInjuries).toEqual([])
  })

  // A person removed from an incident legitimately leaves a verified record
  // behind — syncIncidentInjuries keeps those on purpose. Reporting every one
  // of them would drown the key mismatch this is for.
  it('says nothing about incidents that carry no injury rows at all', () => {
    const orphaned = new Map([[injuryDocId('inc9', 'EMP-1'), { incidentId: 'inc9', personId: 'EMP-1' }]])
    const plan = planInjurySeed([withContext(incident([], 'inc9'))], orphaned)
    expect(plan.orphanInjuries).toEqual([])
  })

  it('ignores a soft-deleted record when reporting orphans', () => {
    const foreign = new Map([[injuryDocId(INC, 'WIZ-7'), {
      incidentId: INC, personId: 'WIZ-7', deletedAt: new Date(),
    }]])
    const plan = planInjurySeed([withContext(incident([report()]))], foreign)
    expect(plan.orphanInjuries).toEqual([])
  })
})

describe('seeding is safe to repeat and safe to batch', () => {
  it('writes nothing on a second pass', () => {
    const incidents = [withContext(incident([report()]))]
    const first = planInjurySeed(incidents, new Map())
    const second = planInjurySeed(incidents, applySeed(new Map(), first))
    expect(second.writes).toEqual([])
    expect(second.blocked).toEqual([])
  })

  // Two rows naming one person in one incident is a defect on its own, but it
  // must not become two conflicting writes to one document in one batch. The
  // second row is judged against what the first one already planned.
  it('merges two rows for one person into a single write', () => {
    const two = incident([
      report({ medication: undefined, firstAidDetail: undefined }),
      report({ injuryType: undefined, bodyParts: undefined, daysToReturnToWork: undefined }),
    ])
    const plan = planInjurySeed([withContext(two)], new Map())
    const w = seedOnly(plan)
    expect(w.patch.injuryType).toBe('Laceration')
    expect(w.patch.medication).toBe('Analgesic')
    expect(plan.created).toBe(1)
  })

  it('reports the second row when it disagrees with the first', () => {
    const two = incident([report(), report({ injuryType: 'Fracture' })])
    const plan = planInjurySeed([withContext(two)], new Map())
    expect(plan.writes).toHaveLength(1)
    expect(plan.blocked[0]).toMatchObject({ reason: 'differs-in-injury', fields: ['injuryType'] })
  })

  it('leaves a null array element alone rather than reading a record out of it', () => {
    const plan = planInjurySeed([withContext(incident([null, report()]))], new Map())
    expect(plan.writes).toHaveLength(1)
    expect(plan.blocked).toEqual([])
  })

  it('does not let one blocked row stop the rest of the org', () => {
    const anon = { personName: 'Ravi Kumar', injuryType: 'Burn' }
    const plan = planInjurySeed(
      [withContext(incident([anon], 'inc1')), withContext(incident([report()], 'inc2'))],
      new Map(),
    )
    expect(plan.writes.map((w) => w.incidentId)).toEqual(['inc2'])
    expect(plan.blocked.map((b) => b.incidentId)).toEqual(['inc1'])
  })
})

// The two halves are separate operations run by separate buttons, but they are
// one job: a seed that does not satisfy the strip's proof is a copy of a medical
// record made for nothing.
describe('seed, then strip', () => {
  it('unblocks an incident whose injury record did not exist', () => {
    const incidents = [withContext(incident([report()]))]
    const before = planMedicalStrip(incidents, new Map())
    expect(before.writes).toEqual([])
    expect(before.blocked[0].reason).toBe('no-injury-record')

    const seeded = applySeed(new Map(), planInjurySeed(incidents, new Map()))
    const after = planMedicalStrip(incidents, seeded)
    expect(after.blocked).toEqual([])
    expect(after.stillExposed).toBe(0)
    expect(after.confined).toBe(5)
    MEDICAL_FIELDS.forEach((f) => expect(after.writes[0].patch.injuryReports[0]).not.toHaveProperty(f))
  })

  it('unblocks an incident whose injury record was only half filled in', () => {
    const incidents = [withContext(incident([report()]))]
    const partial = injuryMap({ medication: '', daysToReturnToWork: '' })
    expect(planMedicalStrip(incidents, partial).stillExposed).toBe(1)

    const seeded = applySeed(partial, planInjurySeed(incidents, partial))
    expect(planMedicalStrip(incidents, seeded).stillExposed).toBe(0)
  })

  // The reason seeding cannot be folded into the strip: after a seed the strip
  // reports these fields as `confined`, which claims they were already in
  // /injuries. The seed run's own `seeded` count is the only record that this
  // migration is what put them there.
  it('counts the copy on the seed run, not inside the strip', () => {
    const incidents = [withContext(incident([report()]))]
    const seed = planInjurySeed(incidents, new Map())
    expect(seed.seeded).toBe(5)
    expect(seed.alreadyHeld).toBe(0)
    expect(seed).not.toHaveProperty('confined')
  })

  // Everything seeding refuses still fails safe downstream: the strip holds the
  // same rows for its own reasons and takes nothing off the incident.
  it('leaves what it refused to seed exposed rather than destroyed', () => {
    const portal = { name: 'Ravi Kumar', uid: 'u9', injuryType: 'Burn', bodyParts: ['hand_r'] }
    const incidents = [withContext(incident([portal]))]
    const seeded = applySeed(new Map(), planInjurySeed(incidents, new Map()))
    const after = planMedicalStrip(incidents, seeded)
    expect(after.writes).toEqual([])
    expect(after.blocked[0].reason).toBe('no-person-id')
    expect(after.stillExposed).toBe(1)
  })
})
