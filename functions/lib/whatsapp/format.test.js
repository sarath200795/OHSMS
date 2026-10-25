import { describe, it, expect } from 'vitest'
import {
  aedLine,
  auditLines,
  defectLines,
  formatSiteReply,
  formatChoices,
  formatNotFound,
  contactLines,
  clean,
  istStamp,
  MAX_BODY,
  CENTRE_PROMPT,
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
    expect(text).toContain('Open defects: 3')
    expect(text).toContain('Fire Extinguishers (2):')
    expect(text).toContain('Fire Alarm System (FAS): No open defects')
    expect(text).toContain('AED (1):')
    expect(text).toContain('First aid boxes: 2')
    expect(text).toContain('Pending actions: 4 (1 overdue)')
    expect(text).toContain('Incidents: 7 total · 1 open · 2 in last 90 days')
    expect(text).toContain('Updated 12 Oct, 07:30 IST')
    expect(text).toContain('Reply with another Centre ID or Centre Name.')
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

  it('names an external service that has no published number, and keeps the distance', () => {
    // A blank phone used to drop the row, so the nearest hospital disappeared
    // from the lookup whenever OpenStreetMap had no number for it.
    expect(
      contactLines(
        [
          {
            kind: 'external',
            role: 'Hospital',
            name: 'Near Hospital',
            phone: '',
            distanceKm: 0.7,
            address: 'Hebbal Road',
          },
        ],
        site
      )
    ).toEqual(['• Hospital: Near Hospital · ~0.7 km · Hebbal Road — no number published'])
  })

  it('still drops an internal contact with no number', () => {
    expect(
      contactLines([{ kind: 'internal', role: 'CM', name: 'Asha Example', phone: '' }], site)
    ).toEqual([])
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
    const { text, rows, list } = formatChoices(sites, 'long')
    expect(rows).toHaveLength(8)
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24)
      expect(r.description.length).toBeLessThanOrEqual(72)
      expect(r.id).toMatch(/^site:s\d+$/)
    }
    expect(text).toContain('Several centres match "long"')
    expect(text).toMatch(/1\. /)
    expect(text).toMatch(/8\. /)
    expect(text).not.toMatch(/9\. /)
    expect(list.button.length).toBeLessThanOrEqual(20)
    expect(list.section.length).toBeLessThanOrEqual(24)
  })
})

describe('formatNotFound', () => {
  const sites = [
    { id: 's1', name: 'Koramangala Block', code: 'BLR1', region: 'South' },
    { id: 's2', name: 'Whitefield Hub', code: 'BLR2', region: 'South' },
  ]

  it('says not found and numbers the closest names', () => {
    const { text, rows } = formatNotFound('koramangla', sites)
    expect(text).toContain('Centre not found for "koramangla"')
    expect(text).toContain('Closest names:')
    expect(text).toContain('1. Koramangala Block (BLR1)')
    expect(rows.map((r) => r.id)).toEqual(['site:s1', 'site:s2'])
  })

  it('repeats the centre prompt when nothing is close', () => {
    const { text, rows } = formatNotFound('zzzz', [])
    expect(text).toContain(CENTRE_PROMPT)
    expect(text).toContain('Centre not found')
    expect(rows).toEqual([])
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

describe('last audit', () => {
  const ok = {
    ok: true,
    date: '2026-03-02',
    scoreOnDay: 82.46,
    scoreAfter7: 91,
    findingsKnown: true,
    openTotal: 1,
    openMore: 0,
    openPoints: ['Fire: Exit route blocked'],
  }

  it('prints the date, both scores when they differ, and the open points', () => {
    const lines = auditLines(ok)
    expect(lines[0]).toBe('📋 Last audit: 2 Mar 2026 · Score 82.5% · 91% after 7 days')
    expect(lines).toContain('Open points (1):')
    expect(lines).toContain('1. Fire: Exit route blocked')
  })

  it('omits "after 7 days" when the two scores are the same', () => {
    expect(
      auditLines({ ...ok, scoreOnDay: 90, scoreAfter7: 90, openPoints: [], openTotal: 0 })[0]
    ).toBe('📋 Last audit: 2 Mar 2026 · Score 90%')
  })

  it('says the open points could not be read without dropping the score', () => {
    const lines = auditLines({ ...ok, findingsKnown: false })
    expect(lines[0]).toContain('Score 82.5%')
    expect(lines).toContain('Open points unavailable.')
    expect(lines.join('\n')).not.toMatch(/Open points \(/)
  })

  it('caps the list and says how many are left', () => {
    const points = Array.from({ length: 12 }, (_, i) => `Point ${i + 1}`)
    const lines = auditLines({ ...ok, openPoints: points, openTotal: 14, openMore: 2 })
    expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(10)
    expect(lines).toContain('10. Point 10')
    expect(lines).not.toContain('11. Point 11')
    expect(lines).toContain('+4 more')
  })

  it('flattens formatting and newlines in an observation', () => {
    const lines = auditLines({ ...ok, openPoints: ['*Bold*\nnext'], openTotal: 1 })
    expect(lines).toContain('1. Bold next')
  })

  it('notes a window with no score, and a lookup that could not be answered', () => {
    expect(auditLines({ ok: false, reason: 'none', windowDays: 90 })).toEqual([
      '📋 No audit score in the last 90 days.',
    ])
    expect(auditLines({ ok: false, reason: 'unreachable' })).toEqual([
      '📋 Audit score unavailable.',
    ])
  })

  it('keeps the section inside the body budget, and leaves it out when not asked', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      kind: 'external',
      role: 'Other',
      name: `Contact ${i} ${'x'.repeat(30)}`,
      phone: `+91 90000 ${String(i).padStart(5, '0')}`,
    }))
    const withAudit = formatSiteReply(site, counts, { contacts: many, asOf, audit: ok })
    expect(withAudit.length).toBeLessThanOrEqual(MAX_BODY)
    expect(withAudit).toContain('📋 Last audit: 2 Mar 2026')
    expect(withAudit).toContain('1. Fire: Exit route blocked')
    const plain = formatSiteReply(site, counts, { contacts, asOf })
    expect(plain).not.toContain('Last audit')
    expect(plain).not.toContain('Audit score')
  })
})

describe('AED and per-type defects', () => {
  it('AED availability line', () => {
    expect(aedLine({ aeds: 2 })).toBe('❤️ AED: Available (2)')
    expect(aedLine({ aeds: 0 })).toBe('❤️ AED: Not available')
    expect(aedLine({ aeds: 1, aedsOutOfService: 1 })).toBe(
      '❤️ AED: Not available (1 out of service)'
    )
    expect(aedLine({ aeds: 3, aedsOutOfService: 1 })).toBe(
      '❤️ AED: Available (2) · 1 out of service'
    )
  })
  it('lists items per type, capped at 5 with +N more', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      label: `SN${i}`,
      where: 'Ground floor',
      defect: 'HPT Due',
    }))
    const lines = defectLines({
      openDefects: 9,
      defectsByKind: { extinguisher: 7, aed: 2, fas: 0 },
      defectItems: {
        extinguisher: items,
        aed: [{ label: 'AED-1', where: '', defect: 'Pads Expired' }],
      },
    })
    expect(lines).toContain('Fire Extinguishers (7):')
    expect(lines).toContain('  • SN0 · Ground floor — HPT Due')
    expect(lines).toContain('  +2 more in the app')
    expect(lines).toContain('Fire Alarm System (FAS): No open defects')
    expect(lines).toContain('  • AED-1 — Pads Expired')
    expect(lines).toContain('  +1 more in the app')
  })
})
