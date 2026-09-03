import { describe, it, expect } from 'vitest'
import {
  PRE_LAUNCH_CATEGORIES, PRE_LAUNCH_ITEMS, PRE_LAUNCH_TOTAL,
  categoryReadiness, matchPrelaunch, pct, prelaunchItemOf, prelaunchReadiness,
  refiledKey,
} from './prelaunch'
import { DOC_TYPE_BY_VALUE } from './docTypes'

const linked = (key, url = 'https://example.test/a.pdf') =>
  ({ id: key, prelaunchKey: key, source: 'link', linkUrl: url })

const uploaded = (key) =>
  ({ id: key, prelaunchKey: key, source: 'upload', file: { url: 'https://cdn.test/a.pdf', name: 'a.pdf' } })

/** A record somebody created and never attached anything to. */
const stub = (key) => ({ id: key, prelaunchKey: key, source: 'upload', file: null })

describe('the checklist itself', () => {
  it('is the handover schedule, whole', () => {
    expect(PRE_LAUNCH_CATEGORIES).toHaveLength(6)
    expect(PRE_LAUNCH_TOTAL).toBe(35)
    expect(PRE_LAUNCH_ITEMS).toHaveLength(PRE_LAUNCH_TOTAL)
  })

  // A key is the ONLY thing tying an uploaded certificate to the row it
  // satisfies. Two rows sharing one silently swallows the other's evidence.
  it('gives every item a unique key', () => {
    const keys = PRE_LAUNCH_ITEMS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every item a title, an owner and a timeline', () => {
    for (const i of PRE_LAUNCH_ITEMS) {
      expect(i.title, i.key).toBeTruthy()
      expect(i.owner, i.key).toBeTruthy()
      expect(i.timeline, i.key).toBeTruthy()
    }
  })

  // A seeded type the form does not offer would land the reader on a select
  // showing nothing, which reads as the form having lost their answer.
  it('only seeds document types the form actually offers', () => {
    for (const i of PRE_LAUNCH_ITEMS) {
      if (i.docType) expect(DOC_TYPE_BY_VALUE[i.docType], i.key).toBeTruthy()
    }
  })

  it('carries the category down onto each item', () => {
    expect(prelaunchItemOf({ prelaunchKey: 'fas-06' }).categoryKey).toBe('fas')
    expect(prelaunchItemOf({ prelaunchKey: 'nope' })).toBeNull()
    expect(prelaunchItemOf(null)).toBeNull()
  })
})

describe('matching documents to rows', () => {
  it('ignores records naming no row, or a row that no longer exists', () => {
    const m = matchPrelaunch([{ id: 'a' }, { id: 'b', prelaunchKey: 'retired-99' }, linked('general-01')])
    expect([...m.keys()]).toEqual(['general-01'])
  })

  // Two people file the same certificate, or an old record is superseded
  // without being deleted. The one that opens is the one that answers the
  // question a handover asks.
  it('prefers the record that can actually be opened', () => {
    const m = matchPrelaunch([stub('fas-01'), uploaded('fas-01')])
    expect(m.get('fas-01').file).toBeTruthy()
  })

  it('keeps the first of two that both open — newest, as the service sorts', () => {
    const first = { ...linked('fas-01'), id: 'new' }
    const m = matchPrelaunch([first, { ...linked('fas-01'), id: 'old' }])
    expect(m.get('fas-01').id).toBe('new')
  })
})

describe('readiness', () => {
  it('is zero, and complete-free, for a site that has filed nothing', () => {
    const r = prelaunchReadiness([])
    expect(r.ready).toBe(0)
    expect(r.pct).toBe(0)
    expect(r.missing).toBe(PRE_LAUNCH_TOTAL)
    expect(r.complete).toBe(false)
    expect(r.rows).toHaveLength(PRE_LAUNCH_TOTAL)
    expect(r.rows.every((row) => row.doc === null)).toBe(true)
  })

  // The whole reason there are two numbers. A record with nothing attached is
  // somebody having been here, not a document anybody can produce on the day.
  it('counts a record with nothing attached as logged but not ready', () => {
    const r = prelaunchReadiness([stub('electrical-01'), linked('electrical-02')])
    expect(r.logged).toBe(2)
    expect(r.ready).toBe(1)
    expect(r.stub).toBe(1)
    expect(r.missing).toBe(PRE_LAUNCH_TOTAL - 2)
  })

  // A javascript: URL is not a document; docTypes refuses it on render, and it
  // must not be counted as evidence here either.
  it('does not count a link the library would refuse to open', () => {
    // eslint-disable-next-line no-script-url
    const r = prelaunchReadiness([linked('electrical-01', 'javascript:alert(1)')])
    expect(r.ready).toBe(0)
    expect(r.stub).toBe(1)
  })

  it('reaches 100% only when every row opens', () => {
    const all = PRE_LAUNCH_ITEMS.map((i) => uploaded(i.key))
    const r = prelaunchReadiness(all)
    expect(r.ready).toBe(PRE_LAUNCH_TOTAL)
    expect(r.pct).toBe(100)
    expect(r.complete).toBe(true)

    const short = prelaunchReadiness(all.slice(0, PRE_LAUNCH_TOTAL - 1))
    expect(short.complete).toBe(false)
    expect(short.pct).toBeLessThan(100)
  })

  it('splits the same rows by category, each summing back to the whole', () => {
    const r = prelaunchReadiness([uploaded('fas-01'), uploaded('fas-02'), uploaded('general-01')])
    const fas = r.byCategory.find((c) => c.key === 'fas')
    expect(fas.ready).toBe(2)
    expect(fas.total).toBe(8)
    expect(fas.pct).toBe(25)
    expect(r.byCategory.reduce((n, c) => n + c.total, 0)).toBe(PRE_LAUNCH_TOTAL)
    expect(r.byCategory.reduce((n, c) => n + c.ready, 0)).toBe(r.ready)
  })

  it('answers for one category on its own', () => {
    expect(categoryReadiness('elevators', [uploaded('elevators-01')]).ready).toBe(1)
    expect(categoryReadiness('no-such-category', [])).toBeNull()
  })
})

// Re-filing rewrites every classification field a document carries. The
// checklist key is the one that cannot be rewritten — nothing at the new site
// stands in for "North Plant's earth pit report" — so it is dropped instead.
describe('refiledKey', () => {
  it('keeps the key when a document is tidied within its own site', () => {
    expect(refiledKey('fas-01', 's1', 's1')).toBe('fas-01')
  })

  // The bug this exists to stop: one change of the Location picker closed the
  // row at the new site and reopened it at the old one.
  it('drops the key when the document moves to another site', () => {
    expect(refiledKey('fas-01', 's1', 's2')).toBe('')
  })

  // Org and region level name no site, so they can satisfy no site's row.
  it('drops the key when the document stops belonging to a site at all', () => {
    expect(refiledKey('fas-01', 's1', '')).toBe('')
    expect(refiledKey('fas-01', 's1', null)).toBe('')
  })

  // A document that never satisfied a row has nothing to lose, however it moves.
  it('is empty for a document carrying no key', () => {
    expect(refiledKey('', 's1', 's1')).toBe('')
    expect(refiledKey(null, 's1', 's2')).toBe('')
  })

  // A key arriving at a site from nowhere would satisfy a row on the strength
  // of a document that was never that site's.
  it('drops a key on a document that had no site to begin with', () => {
    expect(refiledKey('fas-01', '', 's1')).toBe('')
  })

  it('ignores surrounding whitespace on either id', () => {
    expect(refiledKey(' fas-01 ', ' s1', 's1 ')).toBe('fas-01')
  })
})

describe('pct', () => {
  it('rounds, and refuses to divide by nothing', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
    expect(pct(0, 0)).toBe(0)
  })
})
