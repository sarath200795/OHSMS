import { describe, expect, it } from 'vitest'
import {
  RESERVED_DATA_DRIVERS,
  UnimplementedDataDriverError,
  resolveDataDriver,
} from './resolveDriver'

const registered = { firestore: { name: 'firestore' }, memory: { name: 'memory' } }

describe('resolveDataDriver', () => {
  it('keeps the default build on firestore', () => {
    expect(resolveDataDriver(undefined, registered)).toBe('firestore')
    expect(resolveDataDriver('', registered)).toBe('firestore')
    expect(resolveDataDriver('  FIRESTORE  ', registered)).toBe('firestore')
  })

  it('selects the memory driver when asked', () => {
    expect(resolveDataDriver('memory', registered)).toBe('memory')
  })

  it('treats an unknown name as a typo and stays on firestore', () => {
    // A misspelling must not take down the Firebase deployment, which is
    // still the product. A published path 3 name is not a misspelling.
    expect(resolveDataDriver('mysql', registered)).toBe('firestore')
  })

  it.each(RESERVED_DATA_DRIVERS)(
    'refuses %s instead of opening Firestore under that name',
    (name) => {
      expect(RESERVED_DATA_DRIVERS).toEqual(['postgres', 'supabase'])
      let caught
      try {
        resolveDataDriver(name, registered)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(UnimplementedDataDriverError)
      expect(caught.driver).toBe(name)
      expect(caught.message).toContain('docs/CUSTOM-STACK.md')
      expect(caught.message).toContain('will not fall back to Firestore')
    }
  )

  it('normalises the reserved name before refusing', () => {
    expect(() => resolveDataDriver('  Postgres ', registered)).toThrow(UnimplementedDataDriverError)
  })

  it('prefers a registered adapter when the name is still on the reserved list', () => {
    // Registration has to win. Otherwise the change that adds the adapter
    // and forgets to edit RESERVED_DATA_DRIVERS ships a build that throws
    // on the driver it just gained.
    const withPostgres = { ...registered, postgres: { name: 'postgres' } }
    expect(resolveDataDriver('postgres', withPostgres)).toBe('postgres')
  })
})
