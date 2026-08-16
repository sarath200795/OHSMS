import { describe, it, expect } from 'vitest'
import {
  SUBJECT_SOURCES, EXPECTED_SEALED, planExport, planScan, scanFeasibility,
  classifyErasure, ERASABLE, STATUTORY, ANONYMISE,
} from './subjectData.js'

describe('the inventory itself', () => {
  it('gives every source a retention class and a stated reason', () => {
    for (const s of SUBJECT_SOURCES) {
      expect([ERASABLE, STATUTORY, ANONYMISE], s.path).toContain(s.retention)
      // The reason is not decoration: it is what goes back to the subject when
      // part of their request is refused.
      expect(s.why, s.path).toBeTruthy()
    }
  })

  it('reaches every source by a key or names it as scan-only, never neither', () => {
    for (const s of SUBJECT_SOURCES) {
      const reachable = (s.joins || []).length > 0 || (s.mentions || []).length > 0
      expect(reachable, `${s.path} is in the table but unreachable by any means`).toBe(true)
    }
  })

  // The drift guard. These two tables describe the same personal data for
  // different purposes and live in different npm packages, so nothing but this
  // test can notice when one grows a collection the other never heard of.
  it('covers every collection the encryption policy seals', () => {
    const covered = new Set(SUBJECT_SOURCES.map((s) => s.path))
    for (const path of EXPECTED_SEALED) {
      expect(covered.has(path), `${path} is sealed by policy.js but absent from SUBJECT_SOURCES`).toBe(true)
    }
  })

  it('has no duplicate paths', () => {
    const paths = SUBJECT_SOURCES.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('planning what can be fetched by key', () => {
  it('queries by uid and by personId when both are known', () => {
    const q = planExport({ uid: 'u1', personId: 'p1' })
    const paths = q.map((x) => x.path)
    expect(paths).toContain('users')
    expect(paths).toContain('injuries')
    expect(paths).toContain('trainingRecords')
    expect(paths).toContain('auditLogs')
  })

  // The trap this exists to avoid: `where('employeeUid','==','')` matches every
  // record that never carried one, so a subject with no uid would be handed a
  // large slice of somebody else's data.
  it('skips a source whose key the subject does not have, rather than querying empty', () => {
    const q = planExport({ personId: 'p1' })
    expect(q.every((x) => x.value)).toBe(true)
    expect(q.map((x) => x.path)).not.toContain('trainingRecords')
    expect(q.map((x) => x.path)).toContain('injuries')
  })

  it('returns nothing at all for a subject with no identifiers', () => {
    expect(planExport({})).toEqual([])
    expect(planExport()).toEqual([])
  })

  it('marks the account record as top-level rather than org-scoped', () => {
    const users = planExport({ uid: 'u1' }).find((x) => x.path === 'users')
    expect(users.topLevel).toBe(true)
    expect(users.kind).toBe('docId')
  })

  it('carries the retention class through, so the caller need not re-derive it', () => {
    const injuries = planExport({ personId: 'p1' }).find((x) => x.path === 'injuries')
    expect(injuries.retention).toBe(STATUTORY)
  })
})

describe('planning what only a scan can find', () => {
  it('names the free-text collections and the exact fields to look at', () => {
    const scan = planScan()
    const byPath = Object.fromEntries(scan.map((s) => [s.path, s]))
    expect(byPath.consultations.fields).toContain('attendees[].name')
    expect(byPath.incidents.fields).toContain('affectedPersonnel[].name')
    expect(byPath.mockDrills.fields).toContain('commanders[]')
  })

  // A record found by key is complete; a record found by name is best-effort.
  // Keeping them in separate returns is what stops an export presenting the
  // cheap half as the whole answer.
  it('keeps itself separate from the key-joined plan', () => {
    const keyed = planExport({ uid: 'u1', personId: 'p1' }).map((x) => x.path)
    expect(planScan().some((s) => !keyed.includes(s.path))).toBe(true)
  })
})

describe('whether a scan can actually read anything', () => {
  it('is feasible while the fields are stored in the clear', () => {
    expect(scanFeasibility({ encryptionOn: false }).feasible).toBe(true)
    expect(scanFeasibility().feasible).toBe(true)
  })

  // The silent failure this exists to prevent: a scan over ciphertext returns
  // zero matches, which reads exactly like a person who is not mentioned.
  it('refuses once encryption is on, and says why rather than returning nothing', () => {
    const f = scanFeasibility({ encryptionOn: true })
    expect(f.feasible).toBe(false)
    expect(f.reason).toBe('encrypted')
    expect(f.note).toMatch(/zero mentions|ciphertext/i)
  })
})

describe('classifying an erasure request', () => {
  const c = classifyErasure()

  it('refuses the occupational-health record, which is the point', () => {
    const refused = c.refused.map((r) => r.path)
    expect(refused).toContain('injuries')
    expect(refused).toContain('illnesses')
    expect(refused).toContain('incidents')
    expect(refused).toContain('auditLogs')
  })

  it('gives every refusal a reason that can be sent to the subject', () => {
    for (const r of c.refused) expect(r.why, r.path).toBeTruthy()
  })

  it('erases what carries no safety evidence', () => {
    const erasable = c.erasable.map((r) => r.path)
    expect(erasable).toContain('trainingRequests')
    expect(erasable).toContain('erpContacts')
  })

  it('anonymises the account and the drills rather than deleting either', () => {
    const anon = c.anonymise.map((r) => r.path)
    expect(anon).toContain('users')
    expect(anon).toContain('mockDrills')
  })

  // Every source lands in exactly one bucket, or a request would either miss
  // data or double-handle it.
  it('places every source in exactly one bucket', () => {
    const total = c.erasable.length + c.anonymise.length + c.refused.length
    expect(total).toBe(SUBJECT_SOURCES.length)
  })
})
