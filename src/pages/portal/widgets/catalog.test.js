import { describe, it, expect } from 'vitest'
import {
  WIDGETS, WIDGET_BY_KEY, WIDGET_GROUPS, DEFAULT_WIDGETS,
  normalizeSelection, widgetsByGroup,
} from './catalog'

const val = (key, data) => WIDGET_BY_KEY[key].value(data)

describe('the catalogue', () => {
  it('gives every widget a unique key, a label and a group that exists', () => {
    const keys = WIDGETS.map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const w of WIDGETS) {
      expect(w.label, w.key).toBeTruthy()
      expect(WIDGET_GROUPS, w.key).toContain(w.group)
    }
  })

  it('gives every counting widget a value function and a link', () => {
    for (const w of WIDGETS) {
      if (w.kind === 'weather') continue
      expect(typeof w.value, w.key).toBe('function')
      expect(w.to, w.key).toMatch(/^\//)
    }
  })

  it('covers everything the home page was asked for', () => {
    for (const key of [
      'weather', 'incidents', 'pendingActions', 'pendingTraining',
      'extinguishers', 'extinguisherDefects', 'aeds', 'aedDefects',
      'fas', 'fasDefects', 'meetings', 'drills',
      'permitsOpen', 'permitsClosed', 'permitsInProgress', 'permitsExpired', 'permitsExtended',
    ]) {
      expect(WIDGET_BY_KEY[key], `missing widget: ${key}`).toBeTruthy()
    }
  })

  it('defaults to widgets that exist', () => {
    for (const k of DEFAULT_WIDGETS) expect(WIDGET_BY_KEY[k], k).toBeTruthy()
  })

  it('groups every widget exactly once, in group order', () => {
    const grouped = widgetsByGroup()
    expect(grouped.map((g) => g.group)).toEqual(WIDGET_GROUPS.filter((g) => WIDGETS.some((w) => w.group === g)))
    expect(grouped.flatMap((g) => g.items).length).toBe(WIDGETS.length)
  })
})

describe('widget values', () => {
  it('reads the counts the page already computed', () => {
    const d = { stats: { counts: { incidents: 4, extinguishers: 12, aeds: 3, fas: 2 } } }
    expect(val('incidents', d)).toBe(4)
    expect(val('extinguishers', d)).toBe(12)
    expect(val('aeds', d)).toBe(3)
    expect(val('fas', d)).toBe(2)
  })

  it('counts extinguishers carrying a logged defect', () => {
    const d = { extinguishers: [
      { physicalDefects: ['pin'] }, { physicalDefects: [] }, {}, { physicalDefects: ['empty', 'stand'] },
    ] }
    expect(val('extinguisherDefects', d)).toBe(2)
  })

  it('counts an AED or panel that would not work when needed', () => {
    const d = {
      aeds: [{ status: 'ready' }, { status: 'out_of_service' }, { status: 'service_due' }],
      fas: [{ status: 'ok' }, { status: 'faulty' }],
    }
    expect(val('aedDefects', d)).toBe(2)
    expect(val('fasDefects', d)).toBe(1)
  })

  it('reads each permit bucket separately', () => {
    const d = { permits: { open: 1, inProgress: 2, extended: 3, notClosed: 4, closed: 5, withObservations: 6 } }
    expect(val('permitsOpen', d)).toBe(1)
    expect(val('permitsInProgress', d)).toBe(2)
    expect(val('permitsExtended', d)).toBe(3)
    expect(val('permitsExpired', d)).toBe(4)
    expect(val('permitsClosed', d)).toBe(5)
    expect(val('permitsUnsafe', d)).toBe(6)
  })

  it('returns null, not zero, while the data has not loaded', () => {
    // Zero is an answer; "not loaded" is not, and a widget must not claim there
    // are no defective extinguishers before it has seen any extinguishers.
    for (const w of WIDGETS) {
      if (w.kind === 'weather') continue
      expect(w.value({}), w.key).toBeNull()
    }
  })

  it('reports a real zero as zero', () => {
    expect(val('extinguisherDefects', { extinguishers: [] })).toBe(0)
    expect(val('incidents', { stats: { counts: { incidents: 0 } } })).toBe(0)
    expect(val('permitsOpen', { permits: { open: 0 } })).toBe(0)
  })
})

describe('normalizeSelection', () => {
  it('keeps a valid selection in the order chosen', () => {
    expect(normalizeSelection(['aeds', 'incidents'])).toEqual(['aeds', 'incidents'])
  })

  it('drops keys that no longer exist rather than crashing the grid', () => {
    expect(normalizeSelection(['incidents', 'retiredWidget'])).toEqual(['incidents'])
  })

  it('drops duplicates', () => {
    expect(normalizeSelection(['incidents', 'incidents'])).toEqual(['incidents'])
  })

  it('falls back to the defaults for anything unusable', () => {
    // A portal showing no widgets reads as broken, not as customised.
    for (const bad of [undefined, null, 'incidents', [], ['nope'], [1, 2]]) {
      expect(normalizeSelection(bad)).toEqual(DEFAULT_WIDGETS)
    }
  })
})
