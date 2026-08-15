import { describe, it, expect } from 'vitest'
import { planMedicalStrip, preservedIn, injuryDocId, MEDICAL_FIELDS } from './incidentMedical.js'

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
