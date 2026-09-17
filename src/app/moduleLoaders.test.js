import { describe, it, expect } from 'vitest'
import { pathIsOwned } from '../shared/modules/ownership'
import { MODULE_LOADERS } from './moduleLoaders'
import { OPERATING_APPS } from '../shared/modules/apps'

describe('MODULE_LOADERS', () => {
  it('has a loader for every operating app and nothing else', () => {
    expect(Object.keys(MODULE_LOADERS).sort()).toEqual(OPERATING_APPS.map((a) => a.key).sort())
  })
})

describe('pathIsOwned used as the AppLink switch', () => {
  it('keeps module tiles as real navigations in the shell', () => {
    expect(pathIsOwned('/incidents', 'shell')).toBe(false)
    expect(pathIsOwned('/portal', 'shell')).toBe(true)
  })
})
