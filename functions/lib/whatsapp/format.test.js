import { describe, it, expect } from 'vitest'
import {
  formatSiteReply,
  formatChoices,
  contactLines,
  clean,
  istStamp,
  MAX_BODY,
} from './format.js'

// Invented data throughout (AGENTS.md: nothing real in a fixture).
const site = {
  id: 's1',
  name: 'Demo Fitness Central',
  code: 'DEMO001',
  region: 'South',
  entity: 'Demo Co',
}
const counts = {
  extinguishers: 6,
  hptOverdue: 1,
  openDefects: 3,
  defectsByKind: { extinguisher: 2, aed: 1, fas: 0 },
  firstAidBoxes: 2,
  pendingActions: 4,
  overdueActions: 1,
  incidentsTotal: 7,
  incidentsOpen: 1,
  incidents90d: 2,
}
const contacts = [
  { kind: 'internal', role: 'CM', name: 'Asha Example', phone: '+91 90000 00001', siteId: 's1' },
  { kind: 'external', role: 'Police', name: 'Demo Police Station', phone: '100', siteId: 's1' },
  {
    kind: 'external',
    role: 'Hospital',
    name: 'Demo General Hospital',
    phone: '+91 80 0000 0000',
    siteId: '',
  },
  { kind: 'external', role: 'Fire Brigade', name: 'Elsewhere', phone: '101', siteId: 's9' },
]
const asOf = new Date('2026-10-12T02:00:00Z')

describe('formatSiteReply', () => {
  const text = formatSiteReply(site, counts, {
    contacts,
    helplinePrimary: '1800 000 0000',
    roleLabels: { CM: 'Centre Manager' },
    asOf,
  })

  it('carries every required line', () => {
    expect(text).toContain('*Demo Fitness Central (DEMO001)*')
    expect(text).toContain('South · Demo Co')
    expect(text).toContain('Fire extinguishers: 6 (1 HPT overdue)')
    expect(text).toContain('Open defects: 3 (2 extinguisher, 1 AED)')
    expect(text).toContain('First aid boxes: 2')
    expect(text).toContain('Pending actions: 4 (1 overdue)')
    expect(text).toContain('Incidents: 7 total · 1 open · 2 in last 90 days')
    expect(text).toContain('Updated 12 Oct, 07:30 IST')
    expect(text).toContain('Reply with another site code')
  })

  it('lists the site and org-wide contacts, external first, with the org label', () => {
    const block = text.split('Emergency contacts*')[1]
    expect(block.indexOf('Police')).toBeLessThan(block.indexOf('Centre Manager'))
    expect(block).toContain('Hospital: Demo General Hospital — +91 80 0000 0000')
    expect(block).not.toContain('Elsewhere')
    expect(text).toContain('Safety helpline: 1800 000 0000')
    expect(text).toContain('112')
  })

  it('says "none" when there are no pending actions', () => {
    expect(formatSiteReply(site, { ...counts, pendingActions: 0 }, {})).toContain(
      'Pending actions: none'
    )
  })

  it('leaves out the lines for a module that is switched off', () => {
    const t = formatSiteReply(site, counts, {
      modules: { equipment: false, incidents: false, emergency: false },
      contacts,
    })
    expect(t).not.toContain('extinguishers')
    expect(t).not.toContain('Incidents:')
    expect(t).not.toContain('Emergency contacts')
    expect(t).toContain('First aid boxes')
  })

  it('stays under 4096 characters with a huge contact list, and says how many it left out', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      kind: 'external',
      role: 'Other',
      name: `Contact ${i} ${'x'.repeat(30)}`,
      phone: `+91 90000 ${String(i).padStart(5, '0')}`,
    }))
    const t = formatSiteReply(site, counts, { contacts: many, asOf })
    expect(t.length).toBeLessThanOrEqual(MAX_BODY)
    expect(t).toMatch(/\+\d+ more in the app/)
    expect(t).toContain('Updated 12 Oct')
    // Never a phone number cut in half.
    const lines = t.split('\n').filter((l) => l.startsWith('• '))
    for (const l of lines) expect(l).toMatch(/— \+91 90000 \d{5}$/)
  })

  it('cannot be restyled or broken by stored text', () => {
    const t = formatSiteReply({ ...site, name: '*Bold*_x_\nInjected' }, counts, {})
    expect(t.split('\n')[0]).toBe('🏢 *Boldx Injected (DEMO001)*')
  })

  it('drops contacts without a usable number', () => {
    expect(contactLines([{ role: 'Police', name: 'X', phone: '' }], site)).toEqual([])
  })
})

describe('formatChoices', () => {
  it('builds list rows within WhatsApp limits', () => {
    const sites = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      name: `A Very Long Site Name Number ${i}`,
      code: `C${i}`,
      region: 'North',
    }))
    const { text, rows } = formatChoices(sites, 'long')
    expect(rows).toHaveLength(10)
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24)
      expect(r.description.length).toBeLessThanOrEqual(72)
      expect(r.id).toMatch(/^site:s\d+$/)
    }
    expect(text).toContain('Several sites match "long"')
  })
})

describe('helpers', () => {
  it('formats IST stamps', () => {
    expect(istStamp(new Date('2026-10-11T20:15:00Z'))).toBe('12 Oct, 01:45 IST')
  })
  it('drops sealed values', () => {
    expect(clean('enc:1:abcdef')).toBe('')
    expect(clean({ v: 1 })).toBe('')
  })
})
