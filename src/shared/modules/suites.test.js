import { describe, it, expect } from 'vitest'
import { MODULES, ADDONS } from './registry'
import { ALL_MODULE_KEYS, isModuleEnabled } from './entitlements'
import {
  activateKeys,
  isPlaceholderMap,
  placeholderModulesMap,
  subscriptionMap,
} from './placeholders'
import {
  PACKAGING_SUITES,
  SUITES,
  SUITE_BY_KEY,
  activateSuite,
  assignSuite,
  assignedSuiteKey,
  describeGrant,
  suiteForModule,
  suiteIsFullyOn,
} from './suites'

describe('suites partition the registry', () => {
  it('covers every operating module exactly once across the four packaging suites', () => {
    const keys = PACKAGING_SUITES.flatMap((s) => s.keys)
    expect(keys.sort()).toEqual(MODULES.map((m) => m.key).sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps Full as the union of the packaging suites, not a fifth partition', () => {
    expect(SUITE_BY_KEY.full.keys.sort()).toEqual(MODULES.map((m) => m.key).sort())
  })

  it('never puts an add-on in a suite — those stay à-la-carte', () => {
    const bundled = new Set(SUITES.flatMap((s) => s.keys))
    for (const a of ADDONS) expect(bundled.has(a.key), a.key).toBe(false)
  })

  it('names only keys the registry actually has', () => {
    const known = new Set(ALL_MODULE_KEYS)
    for (const s of SUITES) {
      for (const key of s.keys) expect(known.has(key), `${s.key}.${key}`).toBe(true)
    }
  })
})

describe('assignSuite / activateSuite', () => {
  it('assigning Core activates exactly those placeholders, nothing else', () => {
    const map = assignSuite('core')
    expect(isPlaceholderMap(map)).toBe(false)
    for (const key of SUITE_BY_KEY.core.keys) {
      expect(isModuleEnabled(map, key), key).toBe(true)
    }
    expect(isModuleEnabled(map, 'ptw')).toBe(false)
    expect(isModuleEnabled(map, 'equipment')).toBe(false)
    expect(isModuleEnabled(map, 'audit')).toBe(false)
    expect(isModuleEnabled(map, 'odin')).toBe(false)
    expect(assignedSuiteKey(map)).toBe('core')
  })

  it('subscribing to a second suite unions it — Core is not taken away', () => {
    const once = assignSuite('core')
    const twice = activateSuite(once, 'operations')
    for (const key of SUITE_BY_KEY.core.keys) {
      expect(isModuleEnabled(twice, key), key).toBe(true)
    }
    for (const key of SUITE_BY_KEY.operations.keys) {
      expect(isModuleEnabled(twice, key), key).toBe(true)
    }
    expect(isModuleEnabled(twice, 'equipment')).toBe(false)
    expect(assignedSuiteKey(twice)).toBe('custom')
    expect(describeGrant(twice).label).toBe('Core + Operations')
  })

  it('does not recreate the org: the same document, more flags', () => {
    const seeded = placeholderModulesMap()
    const later = activateSuite(seeded, 'fire')
    expect(later.equipment).toBe(true)
    expect(later.drills).toBe(true)
    expect(later.emergency).toBe(true)
    expect(later.incidents).toBe(false)
  })

  it('keeps à-la-carte extras when a suite is applied on top', () => {
    const extra = activateKeys(placeholderModulesMap(), ['ptw'])
    const withCore = activateSuite(extra, 'core')
    expect(withCore.ptw).toBe(true)
    expect(withCore.incidents).toBe(true)
    expect(describeGrant(withCore).extras).toEqual(['ptw'])
  })

  it('Full activates every operating module and still leaves ODIN off', () => {
    const map = assignSuite('full')
    expect(MODULES.every((m) => map[m.key] === true)).toBe(true)
    expect(map.odin).toBe(false)
    expect(assignedSuiteKey(map)).toBe('full')
  })

  it('ignores an unknown suite rather than wiping the grant', () => {
    const current = assignSuite('core')
    expect(activateSuite(current, 'not-a-suite')).toEqual(current)
  })

  it('is idempotent: applying Core twice is a no-op', () => {
    const once = assignSuite('core')
    expect(activateSuite(once, 'core')).toEqual(once)
  })
})

describe('describeGrant', () => {
  it('calls a seeded org placeholders, not a suite', () => {
    const g = describeGrant(placeholderModulesMap())
    expect(g.key).toBe('')
    expect(g.label).toBe('Placeholders only')
    expect(assignedSuiteKey(placeholderModulesMap())).toBe('')
  })

  it('names an exact packaging suite', () => {
    expect(describeGrant(assignSuite('compliance')).key).toBe('compliance')
  })

  it('calls a mixed set custom, and lists complete suites plus extras', () => {
    const map = activateKeys(assignSuite('core'), ['ptw'])
    const g = describeGrant(map)
    expect(g.key).toBe('custom')
    expect(g.matched.map((s) => s.key)).toEqual(['core'])
    expect(g.extras).toEqual(['ptw'])
    expect(g.label).toBe('Core, plus à-la-carte')
  })
})

describe('suiteForModule', () => {
  it('puts every registry module in one packaging suite', () => {
    for (const m of MODULES) {
      expect(suiteForModule(m.key)?.keys, m.key).toContain(m.key)
    }
  })

  it('does not invent a suite for an add-on', () => {
    expect(suiteForModule('odin')).toBeNull()
  })
})

describe('suiteIsFullyOn', () => {
  it('is true only when every key in the suite is active', () => {
    const map = assignSuite('core')
    expect(suiteIsFullyOn(map, 'core')).toBe(true)
    expect(suiteIsFullyOn(map, 'operations')).toBe(false)
    expect(suiteIsFullyOn(subscriptionMap(['incidents', 'hira']), 'core')).toBe(false)
  })
})
