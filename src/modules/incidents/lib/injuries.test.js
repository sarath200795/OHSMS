import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// The invariant under test is about WHERE a field lands, not about Firestore, so
// the fake below records every write with the path it went to. An assertion that
// an incident document does not carry medical fields is the assertion this fix
// exists to make, and nothing anywhere made it before.
// ─────────────────────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const store = new Map() // path -> data
  const writes = [] // { path, data }
  let autoId = 0
  const refTo = (a, seg) => {
    const head = a && typeof a === 'object' && a.path ? [a.path] : []
    const parts = [...head, ...seg.map(String)]
    // doc(collectionRef) with no path segments = "give me a new id".
    if (!seg.length && head.length) parts.push(`auto${(autoId += 1)}`)
    // .id as well as .path: createIncident returns ref.id to its caller.
    return { path: parts.join('/'), id: parts[parts.length - 1] }
  }
  return {
    store,
    writes,
    refTo,
    reset() { store.clear(); writes.length = 0; autoId = 0 },
    /** Everything written under a collection path, e.g. 'organizations/acme/injuries'. */
    writesUnder: (prefix) => writes.filter((w) => w.path.startsWith(`${prefix}/`)),
  }
})

vi.mock('../firebase', () => ({ db: {} }))
// logAudit writes its own document; it is not what these tests are about.
vi.mock('./firestore', () => ({ logAudit: vi.fn(async () => {}) }))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal()
  const write = (ref, data, opts) => {
    fake.writes.push({ path: ref.path, data })
    const prev = fake.store.get(ref.path)
    fake.store.set(ref.path, opts?.merge && prev ? { ...prev, ...data } : { ...data })
  }
  return {
    ...actual,
    collection: (dbOrRef, ...seg) => fake.refTo(dbOrRef, seg),
    doc: (dbOrRef, ...seg) => fake.refTo(dbOrRef, seg),
    getDoc: async (ref) => ({
      exists: () => fake.store.has(ref.path),
      data: () => fake.store.get(ref.path),
    }),
    getDocs: async (q) => {
      const docs = [...fake.store.entries()]
        .filter(([path]) => path.startsWith(`${q.path}/`) && path.split('/').length === q.path.split('/').length + 1)
        .filter(([, data]) => (q.clauses || []).every((c) => data[c.field] === c.value))
        .map(([path, data]) => ({ id: path.split('/').pop(), ref: { path }, data: () => data }))
      return { docs }
    },
    setDoc: async (ref, data, opts) => write(ref, data, opts),
    addDoc: async (col, data) => {
      const ref = fake.refTo(col, [])
      write(ref, data)
      return ref
    },
    updateDoc: async (ref, data) => write(ref, data, { merge: true }),
    deleteDoc: async (ref) => { fake.store.delete(ref.path) },
    query: (col, ...clauses) => ({ path: col.path, clauses: clauses.filter(Boolean) }),
    where: (field, _op, value) => ({ field, value }),
    orderBy: () => null,
    limit: () => null,
    onSnapshot: () => () => {},
    serverTimestamp: () => 'TS',
    increment: (n) => ({ inc: n }),
    runTransaction: async (_db, fn) => fn({
      get: async (ref) => ({
        exists: () => fake.store.has(ref.path),
        data: () => fake.store.get(ref.path),
      }),
      set: (ref, data, opts) => write(ref, data, opts),
    }),
  }
})

const {
  MEDICAL_FIELDS, INCIDENT_INJURY_FIELDS, incidentInjuryStub, incidentInjuryStubs,
  mergeInjuryDetail, syncIncidentInjuries, updateInjury,
} = await import('./injuries')
const { createIncident, updateIncident } = await import('./incidents')

const ORG = 'acme'
const INCIDENTS = `organizations/${ORG}/incidents`
const INJURIES = `organizations/${ORG}/injuries`
const actor = { uid: 'u1', name: 'Alex Admin' }

// One person's injury as Step 1a hands it over: join key plus the clinical half.
const REPORT = {
  personId: 'EMP-104',
  personName: 'Priya Nair',
  firstAidDone: true,
  firstAidDetail: 'Wound dressed on site',
  injuryType: 'Laceration',
  bodyParts: ['hand_l', 'wrist_l'],
  medication: 'Analgesic',
  daysToReturnToWork: 5,
}

const incident = (id = 'inc1') => ({
  id, refNo: 'IRA-2026-9001', incidentDate: '2026-07-20',
  type: 'lost_time', severity: 'high', location: 'Assembly line 2',
})

/** Every field name that reached a path — the shape of what was published there. */
const keysWrittenUnder = (prefix) =>
  new Set(fake.writesUnder(prefix).flatMap((w) => Object.keys(w.data)))

beforeEach(() => {
  fake.reset()
  vi.clearAllMocks()
})

describe('what an incident document may carry about an injury', () => {
  it('keeps the join key and drops every clinical field', () => {
    const stub = incidentInjuryStub(REPORT)
    expect(stub).toEqual({ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true })
    for (const field of MEDICAL_FIELDS) expect(stub).not.toHaveProperty(field)
    expect(Object.keys(stub).sort()).toEqual([...INCIDENT_INJURY_FIELDS].sort())
  })

  it('survives the shapes real writers produce', () => {
    // The portal used to identify people by name/uid; anything unrecognised
    // must not be carried through on the chance that it is clinical.
    expect(incidentInjuryStub({ name: 'Priya', uid: 'u9', injuryType: 'Burn' }))
      .toEqual({ personId: '', personName: '', firstAidDone: false })
    expect(incidentInjuryStubs(undefined)).toEqual([])
    expect(incidentInjuryStubs('not an array')).toEqual([])
  })

  it('is applied by createIncident, whatever the caller passes', async () => {
    const id = await createIncident(ORG, actor, { type: 'lost_time', injuryReports: [REPORT] })
    const stored = fake.store.get(`${INCIDENTS}/${id}`)
    expect(stored.injuryReports).toEqual([{ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true }])
    // The whole document, not just that array: nothing clinical anywhere on it.
    expect(JSON.stringify(stored)).not.toMatch(/Laceration|Analgesic|hand_l|Wound dressed/)
  })

  it('is applied by updateIncident too — the wizard writes through it', async () => {
    fake.store.set(`${INCIDENTS}/inc1`, { type: 'lost_time', injuryReports: [] })
    await updateIncident(ORG, 'inc1', { injuryReports: [REPORT] }, { actor, silent: true })
    expect(fake.store.get(`${INCIDENTS}/inc1`).injuryReports)
      .toEqual([{ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true }])
  })

  it('leaves updates that mention no injury alone', async () => {
    fake.store.set(`${INCIDENTS}/inc1`, { type: 'lost_time', injuryReports: [{ personId: 'EMP-104' }] })
    await updateIncident(ORG, 'inc1', { narrative: 'Reworded' }, { actor, silent: true })
    expect(fake.store.get(`${INCIDENTS}/inc1`).injuryReports).toEqual([{ personId: 'EMP-104' }])
  })
})

describe('syncIncidentInjuries', () => {
  it('writes the clinical detail to /injuries and nothing to the incident', async () => {
    await syncIncidentInjuries(ORG, incident(), [REPORT], actor)

    expect(fake.store.get(`${INJURIES}/inc1__EMP-104`)).toMatchObject({
      incidentId: 'inc1',
      personId: 'EMP-104',
      injuryType: 'Laceration',
      medication: 'Analgesic',
      bodyParts: ['hand_l', 'wrist_l'],
      daysToReturnToWork: 5,
      firstAidDetail: 'Wound dressed on site',
    })
    // The whole point: this call publishes nothing to the widely-readable doc.
    expect(fake.writesUnder(INCIDENTS)).toEqual([])
  })

  it('records nothing for an entry with no personId', async () => {
    // The doc id is built from it. This is the case that made the portal's
    // injury capture exist only on the incident.
    await syncIncidentInjuries(ORG, incident(), [{ name: 'Priya', injuryType: 'Burn' }], actor)
    expect(fake.writesUnder(INJURIES)).toEqual([])
  })
})

describe('the mirror-back from an Injuries-page edit', () => {
  beforeEach(() => {
    fake.store.set(`${INJURIES}/inc1__EMP-104`, {
      incidentId: 'inc1', personId: 'EMP-104', personName: 'Priya Nair', injuryType: 'Laceration',
    })
  })

  it('puts the edit in /injuries and only the join key on the incident', async () => {
    fake.store.set(`${INCIDENTS}/inc1`, {
      injuryReports: [{ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: false }],
    })

    await updateInjury(ORG, 'inc1__EMP-104', {
      firstAidDone: true, firstAidDetail: 'Dressing changed', medication: 'Ibuprofen', bodyParts: ['head'],
    }, actor)

    expect(fake.store.get(`${INJURIES}/inc1__EMP-104`)).toMatchObject({
      firstAidDetail: 'Dressing changed', medication: 'Ibuprofen', bodyParts: ['head'],
    })
    // It used to spread the whole edit onto the incident, re-contaminating it
    // after every save from that page.
    expect(fake.store.get(`${INCIDENTS}/inc1`).injuryReports)
      .toEqual([{ personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true }])
    for (const field of MEDICAL_FIELDS) expect(keysWrittenUnder(INCIDENTS)).not.toContain(field)
  })

  it('scrubs an incident written before the split', async () => {
    // Documents already in the database still carry the old shape. The mirror-
    // back rebuilds the whole array, so an edit cleans the record it touches —
    // the fields go without waiting for a migration.
    fake.store.set(`${INCIDENTS}/inc1`, {
      injuryReports: [
        { personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true, injuryType: 'Laceration', medication: 'Analgesic', bodyParts: ['hand_l'], daysToReturnToWork: 5, firstAidDetail: 'On site' },
        { personId: 'EMP-207', personName: 'Sam Okafor', firstAidDone: false, injuryType: 'Bruise', bodyParts: ['knee_r'] },
      ],
    })

    await updateInjury(ORG, 'inc1__EMP-104', { medication: 'Ibuprofen' }, actor)

    expect(fake.store.get(`${INCIDENTS}/inc1`).injuryReports).toEqual([
      { personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true },
      { personId: 'EMP-207', personName: 'Sam Okafor', firstAidDone: false },
    ])
  })
})

describe('mergeInjuryDetail', () => {
  const stubs = [
    { personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true },
    { personId: 'EMP-207', personName: 'Sam Okafor', firstAidDone: false },
  ]

  it('rehydrates Step 1a from /injuries', () => {
    const merged = mergeInjuryDetail(stubs, [{ ...REPORT, id: 'inc1__EMP-104' }])
    expect(merged[0]).toMatchObject({
      personId: 'EMP-104', personName: 'Priya Nair', firstAidDone: true,
      injuryType: 'Laceration', medication: 'Analgesic', bodyParts: ['hand_l', 'wrist_l'],
    })
    // Nobody else's detail leaks across the join.
    expect(merged[1]).toEqual({ personId: 'EMP-207', personName: 'Sam Okafor', firstAidDone: false })
  })

  it('returns the stubs untouched when the reader cannot see /injuries', () => {
    // A member gets an empty injuries list, not an error. What must NOT happen
    // is the form inventing blank medical fields it would then save.
    const merged = mergeInjuryDetail(stubs, [])
    expect(merged).toEqual(stubs)
    for (const field of MEDICAL_FIELDS) expect(merged[0]).not.toHaveProperty(field)
  })
})
