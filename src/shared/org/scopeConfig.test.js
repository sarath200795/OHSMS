import { describe, it, expect } from 'vitest'
import {
  normalizeScopeConfig, moduleLevelKeys, moduleLevels, availableFields,
  siteLevelValue, distinctSiteValues, toFieldKey, cleanOptions, DEFAULT_LEVEL_KEYS,
} from './scopeConfig'

describe('scopeConfig', () => {
  it('defaults to Region → Entity → Site when unconfigured', () => {
    expect(moduleLevelKeys(null, 'incidents')).toEqual(DEFAULT_LEVEL_KEYS)
    expect(moduleLevels(null, 'incidents').map((l) => l.key)).toEqual(['region', 'entity', 'site'])
  })

  it('normalizes custom fields (with options), dropping reserved/dupe/blank keys', () => {
    const cfg = normalizeScopeConfig({
      customFields: [
        { label: 'Building', options: ['A', 'B', 'A', ' '] },
        { label: 'Building' }, // dupe
        { key: 'region', label: 'Region' }, // reserved
        { label: '' }, // blank
      ],
    })
    expect(cfg.customFields).toEqual([{ key: 'building', label: 'Building', options: ['A', 'B'] }])
  })

  it('treats Site as a normal level: keeps position, drops unknown keys', () => {
    const org = { scopeConfig: { customFields: [{ key: 'floor', label: 'Floor' }], modules: { hira: ['region', 'floor', 'bogus', 'site', 'region'] } } }
    expect(moduleLevelKeys(org, 'hira')).toEqual(['region', 'floor', 'site'])
  })

  it('allows Site to be removed entirely from a module', () => {
    const org = { scopeConfig: { modules: { ptw: ['region', 'entity'] } } }
    expect(moduleLevelKeys(org, 'ptw')).toEqual(['region', 'entity'])
  })

  it('falls back to default when a module has no valid levels', () => {
    const org = { scopeConfig: { modules: { loto: ['nope', 'bogus'] } } }
    expect(moduleLevelKeys(org, 'loto')).toEqual(DEFAULT_LEVEL_KEYS)
  })

  it('exposes built-in + Site + custom fields as available levels', () => {
    const org = { scopeConfig: { customFields: [{ key: 'zone', label: 'Zone' }] } }
    expect(availableFields(org).map((f) => f.key)).toEqual(['region', 'entity', 'site', 'zone'])
  })

  it('carries predefined options onto level descriptors', () => {
    const org = { scopeConfig: { customFields: [{ key: 'floor', label: 'Floor', options: ['G', '1', '2'] }], modules: { hira: ['region', 'floor', 'site'] } } }
    const floor = moduleLevels(org, 'hira').find((l) => l.key === 'floor')
    expect(floor.options).toEqual(['G', '1', '2'])
  })

  it('reads site values for built-in and custom keys', () => {
    const site = { name: 'North Plant', region: 'North', entity: 'Acme', attributes: { floor: '3' } }
    expect(siteLevelValue(site, 'site')).toBe('North Plant')
    expect(siteLevelValue(site, 'region')).toBe('North')
    expect(siteLevelValue(site, 'floor')).toBe('3')
    expect(siteLevelValue(site, 'missing')).toBe('')
  })

  it('collects distinct sorted values for a field', () => {
    const sites = [{ region: 'South' }, { region: 'North' }, { region: 'North' }, { region: '' }]
    expect(distinctSiteValues(sites, 'region')).toEqual(['North', 'South'])
  })

  it('cleans option lists (trim, drop blanks, de-dupe)', () => {
    expect(cleanOptions([' A ', 'B', 'A', '', null])).toEqual(['A', 'B'])
  })

  it('slugifies labels into stable keys', () => {
    expect(toFieldKey('Building / Wing')).toBe('building_wing')
    expect(toFieldKey('  Floor #  ')).toBe('floor')
  })
})
