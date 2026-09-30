import { describe, it, expect } from 'vitest'
import {
  renderPermitMail,
  renderDefectMail,
  renderDrillReportMail,
  renderMeetingMail,
  renderWeatherDigest,
  groupDigestSections,
  shownDigestAreas,
  DIGEST_AREA_CAP,
  SEALED_LINE,
} from './lifecycle.js'
import { footerLine } from './layout.js'

const ORIGIN = 'https://suite.weehs.org'
const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const HYBRID = 'enk:1:medical:wrapped:iviviviviviviviv:ciphertextciphertext'

function assertClean(message) {
  const blob = `${message.subject}\n${message.text}\n${message.html}`
  expect(blob).not.toContain('enc:')
  expect(blob).not.toContain('enk:')
  // The text part is plain. The HTML part is what has to escape the tag.
  expect(message.html).not.toContain('<script>')
  expect(message.html).toContain('&lt;script&gt;')
  expect(message.text).toContain(footerLine())
  expect(message.html).toContain('info@weehs.org')
  expect(message.html).toContain('EHS notifications')
}

describe('permit mail', () => {
  const permit = {
    permitNo: 'PTW-2026-0007',
    typeOfWork: 'Hot work <script>',
    site: 'Plant 2',
    jobLocation: 'Roof',
    jobDescription: 'Alice was on the scaffold',
    participants: [{ name: 'Alice <script>', contact: '999' }],
    issuedToName: 'Receiver Ray',
  }

  it('carries the ref, type, site, location, status and link, and not the people', () => {
    const message = renderPermitMail(
      permit,
      {
        subjectLead: 'Permit raised',
        headline: 'A permit to work was raised and is waiting for approval.',
        status: 'Waiting for approval',
        path: '/permits/p1',
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toBe('Permit raised: PTW-2026-0007')
    expect(message.text).toContain('Type: Hot work <script>')
    expect(message.text).toContain('Site: Plant 2')
    expect(message.text).toContain('Location: Roof')
    expect(message.text).toContain('Status: Waiting for approval')
    expect(message.text).toContain(`${ORIGIN}/permits/p1`)
    expect(message.text).not.toContain('Alice')
    expect(message.text).not.toContain('Receiver')
    expect(message.text).not.toContain('scaffold')
    assertClean(message)
  })

  it('replaces a sealed permit number and does not emit the envelope', () => {
    const message = renderPermitMail(
      { ...permit, permitNo: SEALED, typeOfWork: HYBRID },
      {
        subjectLead: 'Permit raised',
        headline: 'Raised.',
        status: 'Waiting for approval',
        path: '/permits/p1',
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toBe('Permit raised')
    expect(message.text).toContain(SEALED_LINE)
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob).not.toContain('enc:')
    expect(blob).not.toContain('enk:')
  })
})

describe('defect, drill, meeting and weather mail', () => {
  it('describes a defect without a sealed note', () => {
    const message = renderDefectMail(
      {
        assetKind: 'extinguisher',
        summary: 'PIN',
        ref: 'SN-9',
        note: SEALED,
        siteName: 'Plant 2',
        region: 'South',
        entity: 'COCO',
        path: '/equipment/approvals',
        headline: 'A fire extinguisher defect was reported.',
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toContain('Fire extinguisher defect: PIN (SN-9)')
    expect(message.text).toContain('Site: Plant 2')
    expect(message.text).toContain('Region: South')
    expect(message.text).toContain(SEALED_LINE)
    expect(message.text).toContain(`${ORIGIN}/equipment/approvals`)
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob).not.toContain('enc:')
  })

  it('keeps drill outcome and drops a sealed scenario, debrief and commander', () => {
    const message = renderDrillReportMail(
      {
        scenario: SEALED,
        eventType: 'Mock Drill',
        date: '2026-09-01',
        siteName: 'Plant 2',
        outcome: 'Pass',
        scoreLabel: '80%',
        docId: 'DR-1',
        debrief: 'Commander Priya froze',
        commander: HYBRID,
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toBe('Mock drill report: Mock Drill')
    expect(message.text).toContain('Outcome: Pass')
    expect(message.text).toContain('Score: 80%')
    expect(message.text).toContain(SEALED_LINE)
    expect(message.text).not.toContain('Priya')
    expect(message.text).not.toContain('enk:')
    expect(message.html).toContain(`${ORIGIN}/mock-drills`)
  })

  it('records a meeting without minutes, attendees or a sealed subject', () => {
    const message = renderMeetingMail(
      {
        subject: SEALED,
        type: 'HSE Committee Meeting',
        date: '2026-09-02',
        time: '10:00',
        siteName: 'Plant 2',
        docId: 'MOM-1',
        minutes: 'Spoke about <script> Alice',
        attendees: [{ name: 'Alice' }],
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toBe('Committee meeting: HSE Committee Meeting')
    expect(message.text).toContain(SEALED_LINE)
    expect(message.text).toContain('When: 2026-09-02 10:00')
    expect(message.text).not.toContain('Alice')
    expect(message.text).not.toContain('Spoke')
    expect(`${message.text}${message.html}`).not.toContain('enc:')
    expect(message.html).toContain(`${ORIGIN}/committee`)
  })

  describe('weather digest sections', () => {
    const drv = (key, label, value, level) => ({ key, label, value, level })
    const areas = [
      {
        region: 'South',
        name: 'Plant <script>',
        entity: 'COCO',
        level: 'High',
        lat: 17.44,
        lng: 78.39,
        drivers: [
          drv('heat', 'Heat stress', 'Feels like 52°C', 'High'),
          drv('rain', 'Rain', 'Medium · 4.0 mm/h', 'Medium'),
          drv('wind', 'High wind', '55 km/h', 'High'),
        ],
        observedAt: '2026-09-23T11:00',
      },
      {
        region: 'East',
        name: 'Yard',
        entity: 'COCO',
        level: 'High',
        drivers: [drv('heat', 'Heat stress', 'Feels like 46°C', 'Medium')],
      },
      {
        region: 'South',
        name: 'Annex',
        entity: 'FOFO',
        level: 'High',
        drivers: [
          drv('lightning', 'Thunderstorm', 'Lightning reported', 'High'),
          drv('rain', 'Rain', 'High · 12.0 mm/h', 'High'),
        ],
      },
      {
        region: 'East',
        name: 'Depot',
        entity: 'FOFO',
        level: 'Medium',
        drivers: [drv('rain', 'Rain', 'Medium · 4.0 mm/h', 'Medium')],
      },
      { region: 'North', name: 'Quiet', level: 'Low', hazards: 'Heat stress' },
    ]

    it('makes one section per hazard, Heat Stress and Rain Risk first, with region tables', () => {
      const sections = groupDigestSections(areas)
      expect(sections.map((section) => section.title)).toEqual([
        'Heat Stress',
        'Rain Risk',
        'Other hazards',
      ])
      const [heat, rain, other] = sections
      // Heat: East (Yard, Medium) and South (Plant, High).
      expect(heat.groups.map((group) => group.region)).toEqual(['East', 'South'])
      expect(heat.groups[0].rows.map((row) => `${row.name}:${row.level}`)).toEqual(['Yard:Medium'])
      expect(heat.groups[1].rows.map((row) => `${row.name}:${row.level}`)).toEqual([
        'Plant <script>:High',
      ])
      // Rain: a site is under Rain Risk at ITS rain level, not its worst level.
      expect(rain.groups.map((group) => group.region)).toEqual(['East', 'South'])
      expect(rain.groups[0].rows.map((row) => `${row.name}:${row.level}`)).toEqual(['Depot:Medium'])
      expect(rain.groups[1].rows.map((row) => `${row.name}:${row.level}`)).toEqual([
        'Annex:High',
        'Plant <script>:Medium',
      ])
      // Other: one row per site-hazard pair, High before Medium inside a region.
      expect(other.groups).toHaveLength(1)
      expect(other.groups[0].rows.map((row) => `${row.name}:${row.hazard}`)).toEqual([
        'Annex:Thunderstorm',
        'Plant <script>:High wind',
      ])
      expect(
        sections.flatMap((s) => s.groups.flatMap((g) => g.rows)).some((r) => r.name === 'Quiet')
      ).toBe(false)
      expect(heat).toMatchObject({ sites: 2, high: 1, medium: 1, hidden: 0 })
    })

    it('renders the sections in order, counts sites once, and references the map by cid', () => {
      const message = renderWeatherDigest(
        { areas, unread: 2 },
        { appOrigin: ORIGIN, mapCid: 'weather-risk-map', windowLabel: '2026-09-23 06:00-12:00 IST' }
      )
      // Plant, Yard, Annex are High sites; Depot is Medium; Quiet is Low.
      expect(message.subject).toBe('Weather risk: 3 high, 1 medium')
      const { text, html } = message
      const heat = text.indexOf('HEAT STRESS')
      const rain = text.indexOf('RAIN RISK')
      const other = text.indexOf('OTHER HAZARDS')
      expect(heat).toBeGreaterThan(-1)
      expect(heat).toBeLessThan(rain)
      expect(rain).toBeLessThan(other)
      expect(text).toContain('HEAT STRESS (2 sites: 1 high, 1 medium)')
      expect(text).toContain('RAIN RISK (3 sites: 1 high, 2 medium)')
      expect(text).toContain('OTHER HAZARDS (2 readings: 2 high)')
      // Plant is under all three sections.
      expect(text.slice(heat, rain)).toContain('Site: Plant <script>')
      expect(text.slice(rain, other)).toContain('Site: Plant <script>')
      expect(text.slice(other)).toContain('Site: Plant <script>')
      expect(text.slice(rain, other)).toContain('Level: Medium')
      expect(text.slice(other)).toContain('Hazard: High wind')
      expect(text.slice(heat, rain)).not.toContain('Hazard:')
      expect(text).toContain('Entity: COCO')
      expect(text).toContain('Reading: Feels like 52°C')
      expect(text).toContain('When: 2026-09-23T11:00')
      expect(text).toContain('When: 2026-09-23 06:00-12:00 IST')
      expect(text).toContain('Window: 2026-09-23 06:00-12:00 IST')
      expect(text).toContain('counted once here at its worst level')
      expect(text).not.toContain('Quiet')
      expect(text).toContain('Unread: 2 sites could not be read')
      expect(html).toContain('src="cid:weather-risk-map"')
      expect(html).toContain('#dc2626')
      expect(html).toContain('#eab308')
      expect(html.indexOf('>Heat Stress<')).toBeLessThan(html.indexOf('>Rain Risk<'))
      expect(html.indexOf('>Rain Risk<')).toBeLessThan(html.indexOf('>Other hazards<'))
      expect(html).toContain(`${ORIGIN}/weather`)
      expect(html).not.toContain('17.44')
      expect(text).toContain('© OpenStreetMap contributors')
      assertClean(message)
    })

    it('omits a section with no rows', () => {
      const message = renderWeatherDigest(
        {
          areas: [
            {
              region: 'East',
              name: 'Depot',
              level: 'Medium',
              drivers: [drv('rain', 'Rain', 'Medium · 4.0 mm/h', 'Medium')],
            },
          ],
        },
        { appOrigin: ORIGIN }
      )
      expect(message.text).toContain('RAIN RISK')
      expect(message.text).not.toContain('HEAT STRESS')
      expect(message.text).not.toContain('OTHER HAZARDS')
      expect(message.subject).toBe('Weather risk: 0 high, 1 medium')
    })

    it('caps each section on its own, worst first, and says what was left out', () => {
      const many = Array.from({ length: DIGEST_AREA_CAP + 5 }, (_, i) => ({
        region: 'South',
        name: `Heat ${String(i).padStart(3, '0')}`,
        level: i < 3 ? 'High' : 'Medium',
        drivers: [drv('heat', 'Heat stress', 'Feels like 46°C', i < 3 ? 'High' : 'Medium')],
      }))
      // Listed last, and still shown: Rain Risk has room even though Heat Stress is full.
      many.push({
        region: 'South',
        name: 'Rainy',
        level: 'Medium',
        drivers: [drv('rain', 'Rain', 'Medium · 4.0 mm/h', 'Medium')],
      })
      const sections = groupDigestSections(many)
      expect(sections[0]).toMatchObject({ key: 'heat', total: DIGEST_AREA_CAP + 5, hidden: 5 })
      expect(sections[0].groups[0].rows).toHaveLength(DIGEST_AREA_CAP)
      expect(sections[0].groups[0].rows.slice(0, 3).every((r) => r.level === 'High')).toBe(true)
      expect(sections[1]).toMatchObject({ key: 'rain', hidden: 0 })
      const message = renderWeatherDigest({ areas: many }, { appOrigin: ORIGIN })
      expect(message.text).toContain('Heat Stress: 5 further sites — in the app')
      expect(message.text).toContain('Site: Rainy')
      expect(message.subject).toBe(`Weather risk: 3 high, ${DIGEST_AREA_CAP + 3} medium`)
      // Sites cut from every section are not pinned.
      const pinned = shownDigestAreas(many)
      expect(pinned).toHaveLength(DIGEST_AREA_CAP + 1)
    })

    it('reads older rows that carry only hazards or a driver without a level', () => {
      const sections = groupDigestSections([
        {
          region: 'East',
          name: 'Old',
          level: 'High',
          hazards: 'Heat stress, Rain',
        },
        {
          region: 'East',
          name: 'Older',
          level: 'Medium',
          drivers: [{ label: 'Rain', value: 'Medium · 4.0 mm/h' }],
        },
      ])
      expect(sections.map((s) => s.key)).toEqual(['heat', 'rain'])
      expect(sections[1].groups[0].rows.map((r) => `${r.name}:${r.level}`)).toEqual([
        'Old:High',
        'Older:Medium',
      ])
    })
  })

  it('keeps a site with no coordinates in the table and off the map', () => {
    const message = renderWeatherDigest(
      {
        areas: [
          {
            region: 'South',
            name: 'No pin',
            entity: 'COCO',
            level: 'High',
            drivers: [
              { key: 'heat', label: 'Heat stress', value: 'Feels like 46°C', level: 'High' },
            ],
          },
        ],
      },
      { appOrigin: ORIGIN }
    )
    expect(message.text).toContain('Site: No pin')
    expect(message.text).toContain('Reading: Feels like 46°C')
    expect(message.html).not.toContain('cid:')
    expect(message.html).not.toContain('<img')
  })
})

describe('organisation name on a lifecycle mail', () => {
  it('replaces the neutral label when the caller already has the name', () => {
    const message = renderPermitMail(
      { permitNo: 'PTW-1', typeOfWork: 'Hot work' },
      {
        subjectLead: 'Permit raised',
        headline: 'A permit to work was raised and is waiting for approval.',
        status: 'Waiting for approval',
        path: '/permits/p1',
      },
      { appOrigin: 'https://app.example', sender: 'Northwind Steel' }
    )
    expect(message.senderName).toBe('Northwind Steel')
    expect(message.text).toContain('Sent by Northwind Steel ·')
    expect(message.html).toContain('Northwind Steel')
    expect(message.html).not.toContain('EHS notifications')
  })
})
