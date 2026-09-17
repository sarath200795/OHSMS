import { describe, it, expect } from 'vitest'
import { MODULES, ADDONS } from './registry'
import {
  ALL_MODULE_KEYS,
  disabledKeys,
  isModuleEnabled,
  normalizeEntitlement,
} from './entitlements'
import { OPERATING_APPS, appIndexPath, appRewrites } from './apps'
import { pathIsOwned } from './ownership'
import {
  MODULE_STATUS,
  activateKeys,
  isPlaceholderMap,
  moduleStatus,
  placeholderEntitlementFields,
  placeholderModulesMap,
  placeholderRecords,
  recordsFromMap,
  subscriptionMap,
} from './placeholders'

describe('placeholderModulesMap', () => {
  it('has one entry per registry module and add-on, all off', () => {
    const map = placeholderModulesMap()
    expect(Object.keys(map).sort()).toEqual([...ALL_MODULE_KEYS].sort())
    expect(ALL_MODULE_KEYS.every((k) => map[k] === false)).toBe(true)
    expect(isPlaceholderMap(map)).toBe(true)
  })

  it('agrees with isModuleEnabled: a seeded org can use nothing', () => {
    const map = placeholderModulesMap()
    for (const key of ALL_MODULE_KEYS) {
      expect(isModuleEnabled(map, key), key).toBe(false)
      expect(moduleStatus(map, key), key).toBe(MODULE_STATUS.PLACEHOLDER)
    }
  })
})

describe('placeholderRecords', () => {
  it('writes one record per operating module, never an add-on', () => {
    const records = placeholderRecords()
    expect(records).toHaveLength(MODULES.length)
    expect(records.map((r) => r.key)).toEqual(MODULES.map((m) => m.key))
    expect(records.every((r) => r.status === MODULE_STATUS.PLACEHOLDER)).toBe(true)
    for (const a of ADDONS) expect(records.map((r) => r.key)).not.toContain(a.key)
  })
})

describe('subscriptionMap / activateKeys', () => {
  it('activates only the granted keys, leaving the rest as placeholders', () => {
    const map = subscriptionMap(['incidents', 'hira', 'odin', 'not-a-module'])
    expect(map.incidents).toBe(true)
    expect(map.hira).toBe(true)
    expect(map.odin).toBe(true)
    expect(map).not.toHaveProperty('not-a-module')
    expect(map.loto).toBe(false)
    expect(isModuleEnabled(map, 'incidents')).toBe(true)
    expect(isModuleEnabled(map, 'loto')).toBe(false)
    expect(isModuleEnabled(map, 'odin')).toBe(true)
  })

  it('can activate later without recreating the org — same document, new flags', () => {
    const seeded = placeholderModulesMap()
    const later = activateKeys(seeded, ['ptw', 'loto'])
    expect(later.ptw).toBe(true)
    expect(later.loto).toBe(true)
    expect(later.incidents).toBe(false)
    expect(isPlaceholderMap(later)).toBe(false)
  })

  it('fills missing keys as placeholders rather than inheriting the legacy default', () => {
    // A partial map would read "missing = on" under normalizeEntitlement.
    // Activation starts from a complete placeholder set so a key the caller
    // did not mention cannot quietly become usable.
    const later = activateKeys({ incidents: true }, ['hira'])
    expect(later.incidents).toBe(true)
    expect(later.hira).toBe(true)
    expect(later.loto).toBe(false)
  })

  it('is idempotent: activating an already-active key is a no-op', () => {
    const once = subscriptionMap(['incidents'])
    expect(activateKeys(once, ['incidents'])).toEqual(once)
  })
})

describe('recordsFromMap', () => {
  it('reports every key, matching the entitlement gate', () => {
    const map = normalizeEntitlement({ modules: { incidents: true, loto: false } })
    const byKey = Object.fromEntries(recordsFromMap(map).map((r) => [r.key, r.status]))
    for (const key of ALL_MODULE_KEYS) {
      const expected = isModuleEnabled(map, key) ? MODULE_STATUS.ACTIVE : MODULE_STATUS.PLACEHOLDER
      expect(byKey[key], key).toBe(expected)
    }
  })
})

describe('placeholderEntitlementFields', () => {
  it('is the document shape firestore.rules pins, with every module off', () => {
    const fields = placeholderEntitlementFields({ uid: 'u1', email: 'a@t.co' })
    expect(Object.keys(fields).sort()).toEqual(['modules', 'updatedBy', 'updatedByEmail'])
    expect(fields.updatedBy).toBe('u1')
    expect(fields.updatedByEmail).toBe('a@t.co')
    expect(isPlaceholderMap(fields.modules)).toBe(true)
  })
})

describe('operating apps stay in lockstep with the registry', () => {
  it('covers every registry module exactly once, at the registry path', () => {
    expect(OPERATING_APPS.map((a) => a.key).sort()).toEqual(MODULES.map((m) => m.key).sort())
    for (const app of OPERATING_APPS) {
      const mod = MODULES.find((m) => m.key === app.key)
      expect(mod.path, app.key).toBe(app.pathPrefix)
    }
  })

  it('emits a hosting rewrite for each module prefix', () => {
    const rewrites = appRewrites()
    expect(rewrites).toHaveLength(OPERATING_APPS.length * 2)
    expect(rewrites[0]).toEqual({
      source: '/incidents',
      destination: appIndexPath('incidents'),
    })
  })
})

describe('pathIsOwned', () => {
  it('lets the combined app keep every route, which is how e2e still runs', () => {
    expect(pathIsOwned('/incidents', 'combined')).toBe(true)
    expect(pathIsOwned('/portal', 'combined')).toBe(true)
    expect(pathIsOwned('/incidents/new', 'combined')).toBe(true)
  })

  it('gives the shell everything that is not a module', () => {
    expect(pathIsOwned('/portal', 'shell')).toBe(true)
    expect(pathIsOwned('/login', 'shell')).toBe(true)
    expect(pathIsOwned('/platform', 'shell')).toBe(true)
    expect(pathIsOwned('/analytics', 'shell')).toBe(true)
    expect(pathIsOwned('/incidents', 'shell')).toBe(false)
    expect(pathIsOwned('/incidents/new', 'shell')).toBe(false)
    expect(pathIsOwned('/permits/abc', 'shell')).toBe(false)
  })

  it('gives a module app only its own prefix', () => {
    expect(pathIsOwned('/incidents', 'module', 'incidents')).toBe(true)
    expect(pathIsOwned('/incidents/new', 'module', 'incidents')).toBe(true)
    expect(pathIsOwned('/hira', 'module', 'incidents')).toBe(false)
    expect(pathIsOwned('/portal', 'module', 'incidents')).toBe(false)
    expect(pathIsOwned('/permits', 'module', 'ptw')).toBe(true)
  })
})

describe('disabledKeys on a seeded org', () => {
  it('counts every key as off, which is the launcher empty state', () => {
    expect(disabledKeys(placeholderModulesMap())).toEqual([...ALL_MODULE_KEYS])
  })
})
