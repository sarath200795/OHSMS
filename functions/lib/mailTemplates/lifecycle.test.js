import { describe, it, expect } from 'vitest'
import {
  renderPermitMail,
  renderDefectMail,
  renderDrillReportMail,
  renderMeetingMail,
  renderWeatherDigest,
  groupDigestAreas,
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

  it('lists high then medium, grouped by region, and references the map by cid', () => {
    const areas = [
      {
        region: 'South',
        name: 'Plant <script>',
        entity: 'COCO',
        level: 'High',
        lat: 17.44,
        lng: 78.39,
        drivers: [{ key: 'wind', label: 'High wind', value: '55 km/h' }],
        observedAt: '2026-09-23T11:00',
      },
      {
        region: 'East',
        name: 'Yard',
        entity: 'COCO',
        level: 'High',
        drivers: [{ key: 'heat', label: 'Heat stress', value: 'Feels like 46°C' }],
      },
      {
        region: 'South',
        name: 'Annex',
        entity: 'FOFO',
        level: 'High',
        drivers: [{ key: 'lightning', label: 'Thunderstorm', value: 'Lightning reported' }],
      },
      {
        region: 'East',
        name: 'Depot',
        entity: 'FOFO',
        level: 'Medium',
        drivers: [{ key: 'rain', label: 'Rain', value: 'Medium · 4.0 mm/h' }],
      },
      { region: 'North', name: 'Quiet', level: 'Low', hazards: 'Heat stress' },
    ]
    const sections = groupDigestAreas(areas)
    expect(sections.map((section) => section.level)).toEqual(['High', 'Medium'])
    expect(sections[0].groups.map((group) => group.region)).toEqual(['East', 'South'])
    expect(sections[0].groups[0].sites.map((site) => site.name)).toEqual(['Yard'])
    expect(sections[0].groups[1].sites.map((site) => site.name)).toEqual([
      'Annex',
      'Plant <script>',
    ])
    expect(sections[1].groups.map((group) => group.region)).toEqual(['East'])
    expect(sections[1].groups[0].sites.map((site) => site.name)).toEqual(['Depot'])

    const message = renderWeatherDigest(
      { areas, unread: 2 },
      { appOrigin: ORIGIN, mapCid: 'weather-risk-map', windowLabel: '2026-09-23 06:00-12:00 IST' }
    )
    expect(message.subject).toBe('Weather risk: 3 high, 1 medium')
    expect(message.text.indexOf('High risk')).toBeLessThan(message.text.indexOf('Medium risk'))
    expect(message.text).toContain('Site: Plant <script>')
    expect(message.text).toContain('Entity: COCO')
    expect(message.text).toContain('Drivers: High wind · 55 km/h')
    expect(message.text).toContain('When: 2026-09-23T11:00')
    expect(message.text).toContain('When: 2026-09-23 06:00-12:00 IST')
    expect(message.text).toContain('Drivers: Rain · Medium · 4.0 mm/h')
    expect(message.text).toContain('Window: 2026-09-23 06:00-12:00 IST')
    expect(message.text).not.toContain('Quiet')
    expect(message.text).toContain('Unread: 2 sites could not be read')
    expect(message.html).toContain('src="cid:weather-risk-map"')
    expect(message.html).toContain('#dc2626')
    expect(message.html).toContain('#eab308')
    expect(message.html.indexOf('>High risk<')).toBeLessThan(message.html.indexOf('>Medium risk<'))
    expect(message.html).toContain(`${ORIGIN}/weather`)
    expect(message.html).not.toContain('17.44')
    expect(message.text).toContain('© OpenStreetMap contributors')
    assertClean(message)
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
            drivers: [{ label: 'Heat stress', value: 'Feels like 46°C' }],
          },
        ],
      },
      { appOrigin: ORIGIN }
    )
    expect(message.text).toContain('Site: No pin')
    expect(message.text).toContain('Drivers: Heat stress · Feels like 46°C')
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
