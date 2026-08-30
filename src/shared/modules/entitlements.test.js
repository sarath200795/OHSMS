import { describe, it, expect } from 'vitest'
import {
  ALL_MODULE_KEYS,
  disabledKeys,
  enabledModules,
  isModuleEnabled,
  normalizeEntitlement,
} from './entitlements'
import { MODULES, ADDONS, OPT_IN_KEYS } from './registry'

describe('normalizeEntitlement', () => {
  it('gives an unconfigured organization every module and no add-on', () => {
    // The whole product still means every MODULE. An opt-in add-on is off
    // until an operator grants it — see ADDONS in the registry.
    const map = normalizeEntitlement(null)
    expect(Object.keys(map)).toHaveLength(ALL_MODULE_KEYS.length)
    expect(MODULES.every((m) => map[m.key])).toBe(true)
    expect(OPT_IN_KEYS.every((k) => map[k] === false)).toBe(true)
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
    for (const m of MODULES) {
      if (m.key !== 'incidents') expect(map[m.key], m.key).toBe(true)
    }
  })

  // The inverse, and the reason optIn exists: an add-on absent from the
  // document is OFF. Defaulting it on would have put ODIN in front of every
  // tenant on the platform, none of whom have a Metabase to point it at.
  it('leaves an add-on the stored document has never heard of switched off', () => {
    const map = normalizeEntitlement({ modules: { incidents: false } })
    for (const key of OPT_IN_KEYS) expect(map[key], key).toBe(false)
  })

  it('turns an add-on on only for an explicit true', () => {
    for (const key of OPT_IN_KEYS) {
      expect(normalizeEntitlement({ modules: { [key]: true } })[key]).toBe(true)
      expect(normalizeEntitlement({ modules: { [key]: false } })[key]).toBe(false)
    }
  })

  it('drops keys the registry no longer has', () => {
    const map = normalizeEntitlement({ modules: { retiredModule: false } })
    expect(map).not.toHaveProperty('retiredModule')
  })

  it('survives a malformed document rather than blacking out the app', () => {
    for (const bad of [{}, { modules: null }, { modules: 'yes' }, { modules: [] }]) {
      const map = normalizeEntitlement(bad)
      expect(MODULES.every((m) => map[m.key]), JSON.stringify(bad)).toBe(true)
    }
  })
})

describe('isModuleEnabled', () => {
  it('reads a raw stored map as well as a normalized one', () => {
    expect(isModuleEnabled({ loto: false }, 'loto')).toBe(false)
    expect(isModuleEnabled({ loto: false }, 'hira')).toBe(true)
  })

  it('needs an explicit yes for an opt-in add-on', () => {
    for (const key of OPT_IN_KEYS) {
      expect(isModuleEnabled({}, key), key).toBe(false)
      expect(isModuleEnabled(null, key), key).toBe(false)
      expect(isModuleEnabled({ [key]: false }, key), key).toBe(false)
      expect(isModuleEnabled({ [key]: true }, key), key).toBe(true)
    }
  })

  it('counts an ungranted add-on as off in the summary', () => {
    // disabledKeys drives a "3 of 18 off" line. Testing the stored value
    // directly would report every add-on as ON for an org nobody has
    // touched, which is the opposite of the truth.
    expect(disabledKeys(normalizeEntitlement(null))).toEqual([...OPT_IN_KEYS])
  })

  it('keeps add-ons out of the module grid, which has no route for them', () => {
    const granted = Object.fromEntries(ADDONS.map((a) => [a.key, true]))
    const keys = enabledModules({ ...normalizeEntitlement(null), ...granted }).map((m) => m.key)
    for (const a of ADDONS) expect(keys, a.key).not.toContain(a.key)
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
