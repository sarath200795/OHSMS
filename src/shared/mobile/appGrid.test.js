import { describe, expect, it } from 'vitest'
import { fieldApps } from './appGrid'

const labels = (role, moduleMap) => fieldApps({ role, moduleMap }).map((a) => a.label)

describe('fieldApps', () => {
  it('leads with the field registers and includes every enabled module', () => {
    const names = labels('member')
    expect(names.slice(0, 8)).toEqual([
      'Extinguishers',
      'AED',
      'FAS',
      'Signage',
      'Incidents',
      'Permits',
      'LOTO',
      'HIRA',
    ])
    expect(names).toEqual(
      expect.arrayContaining([
        'Defects',
        'Mock drills',
        'Meetings',
        'Weather',
        'Sites',
        'Emergency',
        'Reports',
        'Inspections',
        'Training',
        'CCTV',
      ])
    )
    expect(names).not.toContain('Settings')
    expect(names).not.toContain('Employees')
    expect(names).not.toContain('Audit log')
  })

  it('drops a module the organisation has switched off, including its equipment tiles', () => {
    const names = labels('admin', { equipment: false, incidents: false, weather: false })
    for (const gone of ['Extinguishers', 'AED', 'FAS', 'Signage', 'Defects', 'Incidents', 'Weather']) {
      expect(names).not.toContain(gone)
    }
    expect(names).toContain('Permits')
    expect(names).toContain('Settings')
  })

  it('gives an admin settings and an auditor the audit log, and neither a write-only tool they cannot open', () => {
    expect(labels('admin')).toEqual(
      expect.arrayContaining(['Settings', 'Employees', 'Audit log', 'Maintenance'])
    )
    const auditor = labels('auditor')
    expect(auditor).toContain('Audit log')
    expect(auditor).toContain('Sites')
    expect(auditor).not.toContain('Settings')
    expect(auditor).not.toContain('Employees')
    const manager = labels('manager')
    expect(manager).toContain('Audit log')
    expect(manager).not.toContain('Settings')
  })

  it('points each leading tile at the register it names', () => {
    const byLabel = Object.fromEntries(fieldApps({ role: 'member' }).map((a) => [a.label, a.to]))
    expect(byLabel.Extinguishers).toBe('/equipment/extinguishers')
    expect(byLabel.AED).toBe('/equipment/aed')
    expect(byLabel.FAS).toBe('/equipment/fas')
    expect(byLabel.Signage).toBe('/equipment/signages')
    expect(byLabel.Defects).toBe('/equipment/defects')
    expect(byLabel.Permits).toBe('/permits')
    expect(byLabel.LOTO).toBe('/loto')
    expect(byLabel.HIRA).toBe('/hira')
    expect(byLabel['Mock drills']).toBe('/mock-drills')
    expect(byLabel.Meetings).toBe('/committee')
    expect(byLabel.Emergency).toBe('/emergency-response')
    expect(byLabel.Reports).toBe('/analytics')
    expect(byLabel.Sites).toBe('/sites')
  })
})
