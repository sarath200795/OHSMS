import { describe, it, expect } from 'vitest'
import { resolveTagCode, unscannedPoints } from './tagScan'

const permit = {
  procedureId: 'proc1',
  points: [
    { key: 'a1b2', pointId: 'E-1' },
    { key: 'c3/d4', pointId: 'H-1' },
  ],
}

describe('resolveTagCode', () => {
  it('reads the link printed on the tag', () => {
    expect(resolveTagCode('https://app.example/t/proc1/a1b2', permit)).toMatchObject({ ok: true, point: { pointId: 'E-1' } })
  })

  it('decodes a key that had to be escaped in the link', () => {
    expect(resolveTagCode('/t/proc1/c3%2Fd4', permit)).toMatchObject({ ok: true, point: { pointId: 'H-1' } })
  })

  it('refuses a tag from other equipment — it must not count as a scan here', () => {
    const r = resolveTagCode('https://app.example/t/other/a1b2', permit)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/different equipment/)
  })

  it('refuses a tag for a point this permit does not isolate', () => {
    expect(resolveTagCode('/t/proc1/zzzz', permit).ok).toBe(false)
  })

  it('accepts the point key or the short number typed by hand, in any case', () => {
    expect(resolveTagCode('a1b2', permit).point.pointId).toBe('E-1')
    expect(resolveTagCode(' e-1 ', permit).point.pointId).toBe('E-1')
    expect(resolveTagCode('h - 1', permit).point.pointId).toBe('H-1')
  })

  it('refuses empty and unknown input with a reason', () => {
    expect(resolveTagCode('', permit)).toEqual({ ok: false, reason: 'Nothing was scanned.' })
    expect(resolveTagCode(null, permit).ok).toBe(false)
    expect(resolveTagCode('X-9', permit).reason).toMatch(/not an isolation point/)
    expect(resolveTagCode('/t/proc1/%E0%A4%A', permit).ok).toBe(false)
  })
})

describe('unscannedPoints', () => {
  it('lists the points with no scan', () => {
    expect(unscannedPoints(permit.points, { a1b2: { at: 1 } }).map((p) => p.pointId)).toEqual(['H-1'])
    expect(unscannedPoints(permit.points, { a1b2: {}, 'c3/d4': {} })).toEqual([])
  })
})
