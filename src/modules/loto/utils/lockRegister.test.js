import { describe, expect, it } from 'vitest'
import { derivedUseCount, lockIntegrity, traceQuery } from './lockRegister'

const lock = (over = {}) => ({ id: 'l1', lockNo: 'D-1', tagNo: 'RED-1', serviceStatus: 'available', ...over })
const permit = (over = {}) => ({
  id: 'LP-1', permitNo: 'LP-1', status: 'active', equipment: 'Pump A', locks: [{ lockNo: 'D-1' }], ...over,
})

describe('lockIntegrity', () => {
  it('requires an issued lock to sit on exactly one open permit', () => {
    expect(lockIntegrity([lock({ serviceStatus: 'issued' })], [permit()])).toEqual([])
    expect(lockIntegrity([lock({ serviceStatus: 'issued' })], [])[0]).toMatch(/0 open/)
    expect(lockIntegrity(
      [lock({ serviceStatus: 'issued' })],
      [permit(), permit({ id: 'LP-2', permitNo: 'LP-2' })],
    )[0]).toMatch(/2 open/)
  })

  it('flags an available lock that an active permit still lists, and an out-of-service lock in use', () => {
    expect(lockIntegrity([lock()], [permit()])[0]).toMatch(/available/)
    expect(lockIntegrity([lock({ serviceStatus: 'out_of_service' })], [permit({ status: 'approved' })])[0]).toMatch(/out of service/)
  })
})

describe('traceQuery', () => {
  const locks = [lock()]
  const permits = [permit({ status: 'returned', requestedAt: 1 }), permit({ id: 'LP-2', permitNo: 'LP-2', status: 'active', requestedAt: 2 })]

  it('finds a lock by its number or its tag and counts every permit', () => {
    const byTag = traceQuery('red-1', { locks, permits })
    expect(byTag.kind).toBe('lock')
    expect(byTag.now.map((p) => p.id)).toEqual(['LP-2'])
    expect(byTag.useCount).toBe(2)
    expect(derivedUseCount(lock(), permits)).toBe(2)
  })

  it('finds equipment and reports nothing for an unknown code', () => {
    expect(traceQuery('Pump A', { locks, permits }).kind).toBe('equipment')
    expect(traceQuery('nope', { locks, permits }).kind).toBe('none')
    expect(traceQuery('  ', { locks, permits }).kind).toBe('empty')
  })
})
