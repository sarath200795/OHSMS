import { describe, expect, it } from 'vitest'
import { fieldApps } from './appGrid'
import { IDLE_MOTIONS, fieldIdle } from './fieldIdle'

describe('fieldIdle', () => {
  it('keeps neighbouring tiles off the same beat', () => {
    const apps = fieldApps({ moduleMap: {}, role: 'admin' })
    expect(apps.length).toBeGreaterThan(4)
    const rows = apps.map((app, i) => fieldIdle(app.key, i))
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].delayMs).not.toBe(rows[i - 1].delayMs)
      expect(rows[i].phaseMs).not.toBe(rows[i - 1].phaseMs)
    }
    for (const row of rows) {
      expect(IDLE_MOTIONS).toContain(row.motion)
      expect(row.delayMs).toBeGreaterThanOrEqual(480)
      expect(row.phaseMs).toBeLessThan(0)
      expect(row.durationMs).toBeGreaterThan(2000)
    }
  })

  it('uses a known motion for a module that has no assignment', () => {
    expect(IDLE_MOTIONS).toContain(fieldIdle('not-a-tile', 2).motion)
    expect(fieldIdle('extinguishers', 0).motion).toBe('sway')
    expect(fieldIdle('aed', 1).motion).toBe('pulse')
  })

  it('is stable for the same key', () => {
    expect(fieldIdle('weather', 3)).toEqual(fieldIdle('weather', 3))
  })
})
