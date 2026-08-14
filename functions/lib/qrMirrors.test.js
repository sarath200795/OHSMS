import { describe, it, expect } from 'vitest'
import { planQrBackfill, QR_SOURCES } from './qrMirrors.js'

const ORG = 'orgA'
const asset = (id, qrToken, collection = 'extinguishers') => ({ collection, id, qrToken })

describe('QR_SOURCES', () => {
  // All three asset types write into the same /qr collection, so a backfill
  // that only covered extinguishers would leave AED and FAS labels broken.
  it('covers every collection that writes a QR mirror', () => {
    expect(QR_SOURCES).toContain('extinguishers')
    expect(QR_SOURCES).toContain('aeds')
    expect(QR_SOURCES).toContain('fas')
  })
})

describe('planning the orgId backfill', () => {
  it('stamps a mirror that predates the field', () => {
    const mirrors = new Map([['tok1', { extId: 'e1', token: 'tok1' }]])
    const plan = planQrBackfill([asset('e1', 'tok1')], mirrors, ORG)
    expect(plan.writes).toEqual([{ token: 'tok1', patch: { orgId: ORG }, collection: 'extinguishers', id: 'e1' }])
  })

  // Idempotence is the whole point: this gets run twice by someone unsure
  // whether the first run took.
  it('leaves a mirror that already names this org alone', () => {
    const mirrors = new Map([['tok1', { orgId: ORG, extId: 'e1' }]])
    const plan = planQrBackfill([asset('e1', 'tok1')], mirrors, ORG)
    expect(plan.writes).toEqual([])
    expect(plan.alreadyStamped).toBe(1)
  })

  // Rewriting this would hand one tenant an asset that answers to another
  // tenant's printed label.
  it('refuses to rewrite a mirror naming a different org, and reports it', () => {
    const mirrors = new Map([['tok1', { orgId: 'orgB', extId: 'e1' }]])
    const plan = planQrBackfill([asset('e1', 'tok1')], mirrors, ORG)
    expect(plan.writes).toEqual([])
    expect(plan.foreign).toEqual([{ token: 'tok1', collection: 'extinguishers', id: 'e1', orgId: 'orgB' }])
  })

  it('treats an empty-string orgId as unstamped', () => {
    const mirrors = new Map([['tok1', { orgId: '', extId: 'e1' }]])
    expect(planQrBackfill([asset('e1', 'tok1')], mirrors, ORG).writes).toHaveLength(1)
  })

  it('reports an asset whose mirror is missing rather than inventing one', () => {
    const plan = planQrBackfill([asset('e1', 'tok1')], new Map([['tok1', null]]), ORG)
    expect(plan.writes).toEqual([])
    expect(plan.missingMirror).toEqual([{ collection: 'extinguishers', id: 'e1', token: 'tok1' }])
  })

  it('skips assets carrying no token at all', () => {
    const plan = planQrBackfill([asset('e1', ''), asset('e2', null)], new Map(), ORG)
    expect(plan.writes).toEqual([])
    expect(plan.missingMirror).toEqual([])
  })

  // Two assets on one token is its own defect, but it must not put two
  // conflicting writes for the same document into one batch — Firestore rejects
  // that outright, which would fail the whole run.
  it('emits one write when two assets name the same token', () => {
    const mirrors = new Map([['tok1', { extId: 'e1' }]])
    const plan = planQrBackfill([asset('e1', 'tok1'), asset('e2', 'tok1')], mirrors, ORG)
    expect(plan.writes).toHaveLength(1)
  })

  it('covers all three asset types in one pass', () => {
    const mirrors = new Map([
      ['t1', { extId: 'e1' }], ['t2', { aedId: 'a1' }], ['t3', { fasId: 'f1' }],
    ])
    const plan = planQrBackfill(
      [asset('e1', 't1', 'extinguishers'), asset('a1', 't2', 'aeds'), asset('f1', 't3', 'fas')],
      mirrors, ORG,
    )
    expect(plan.writes.map((w) => w.collection)).toEqual(['extinguishers', 'aeds', 'fas'])
  })

  it('handles a mixed estate without letting one bad row stop the rest', () => {
    const mirrors = new Map([
      ['t1', { extId: 'e1' }],
      ['t2', { orgId: ORG }],
      ['t3', { orgId: 'orgB' }],
      ['t4', null],
    ])
    const plan = planQrBackfill(
      [asset('e1', 't1'), asset('e2', 't2'), asset('e3', 't3'), asset('e4', 't4')],
      mirrors, ORG,
    )
    expect(plan.writes).toHaveLength(1)
    expect(plan.alreadyStamped).toBe(1)
    expect(plan.foreign).toHaveLength(1)
    expect(plan.missingMirror).toHaveLength(1)
  })
})
