import { describe, it, expect } from 'vitest'
import {
  ALL_MODULE_KEYS,
  disabledKeys,
  enabledModules,
  isModuleEnabled,
  normalizeEntitlement,
} from './entitlements'
import { MODULES } from './registry'

describe('normalizeEntitlement', () => {
  it('gives an unconfigured organization the whole product', () => {
    const map = normalizeEntitlement(null)
    expect(Object.keys(map)).toHaveLength(ALL_MODULE_KEYS.length)
    expect(Object.values(map).every(Boolean)).toBe(true)
  })

  it('turns off only what is explicitly false', () => {
    const map = normalizeEntitlement({ modules: { loto: false, cctv: true } })
    expect(map.loto).toBe(false)
    expect(map.cctv).toBe(true)
    expect(map.incidents).toBe(true)
  })

  // The reason absence is not "off": a module shipped after an operator last
  // saved an org would otherwise be invisible to every existing tenant.
  it('enables a module the stored document has never heard of', () => {
    const map = normalizeEntitlement({ modules: { incidents: false } })
    for (const key of ALL_MODULE_KEYS) {
      if (key !== 'incidents') expect(map[key]).toBe(true)
    }
  })

  it('drops keys the registry no longer has', () => {
    const map = normalizeEntitlement({ modules: { retiredModule: false } })
    expect(map).not.toHaveProperty('retiredModule')
  })

  it('survives a malformed document rather than blacking out the app', () => {
    for (const bad of [{}, { modules: null }, { modules: 'yes' }, { modules: [] }]) {
      expect(Object.values(normalizeEntitlement(bad)).every(Boolean)).toBe(true)
    }
  })
})

describe('isModuleEnabled', () => {
  it('reads a raw stored map as well as a normalized one', () => {
    expect(isModuleEnabled({ loto: false }, 'loto')).toBe(false)
    expect(isModuleEnabled({ loto: false }, 'hira')).toBe(true)
  })

  it('allows keys the registry does not govern', () => {
    expect(isModuleEnabled({}, 'analytics')).toBe(true)
    expect(isModuleEnabled({}, '')).toBe(true)
    expect(isModuleEnabled(null, 'incidents')).toBe(true)
  })
})

describe('enabledModules', () => {
  it('keeps registry order so the grid does not reshuffle', () => {
    const map = normalizeEntitlement({ modules: { incidents: false } })
    const keys = enabledModules(map).map((m) => m.key)
    expect(keys).toEqual(MODULES.map((m) => m.key).filter((k) => k !== 'incidents'))
  })

  it('can be emptied completely', () => {
    const off = Object.fromEntries(ALL_MODULE_KEYS.map((k) => [k, false]))
    expect(enabledModules(off)).toHaveLength(0)
    expect(disabledKeys(off)).toHaveLength(ALL_MODULE_KEYS.length)
  })
})
