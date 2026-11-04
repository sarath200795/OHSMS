import { describe, expect, it } from 'vitest'
import { lockPhotoStamp } from './lockPhoto'

describe('lockPhotoStamp', () => {
  it('carries the time, the person, the permit and the equipment', () => {
    const line = lockPhotoStamp({
      at: Date.parse('2026-10-05T06:10:00Z'),
      userName: 'Asha',
      permitNo: 'LP-2026-0001',
      equipment: 'Pump A',
    })
    expect(line).toBe('2026-10-05T06:10:00.000Z | Asha | LP-2026-0001 | Pump A')
  })
})
