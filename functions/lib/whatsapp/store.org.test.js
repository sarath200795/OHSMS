import { describe, it, expect } from 'vitest'
import { memoryDb } from '../../test-support/memoryDb.js'
import { createStore } from './store.js'

describe('orgLookupEnabled on the store', () => {
  it('stays on when the switch document is missing, and off only when enabled is false', async () => {
    const db = memoryDb({ 'waOrgSettings/orgA': { enabled: false } })
    const store = createStore(db, { pepper: 'pepper' })
    expect(await store.orgLookupEnabled('orgA')).toBe(false)
    expect(await store.orgLookupEnabled('orgB')).toBe(true)
    expect(await store.orgLookupEnabled('a/b')).toBe(false)
    expect(await store.orgLookupEnabled('')).toBe(false)
  })
})
