import { describe, it, expect } from 'vitest'
import {
  renderPermitMail,
  renderDefectMail,
  renderDrillReportMail,
  renderMeetingMail,
  renderWeatherDigest,
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
  expect(message.html).toContain('WEEHS OHSMS')
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

  it('lists high and medium areas by region and skips nothing that was not passed in', () => {
    const message = renderWeatherDigest(
      {
        areas: [
          { region: 'South', name: 'Plant <script>', level: 'High', hazards: 'High wind' },
          { region: 'East', name: 'Depot', level: 'Medium', hazards: 'Rain' },
        ],
        unread: 2,
      },
      { appOrigin: ORIGIN }
    )
    expect(message.subject).toBe('Weather risk: 1 high, 1 medium')
    expect(message.text).toContain('South: Plant <script> — High · High wind')
    expect(message.text).toContain('East: Depot — Medium · Rain')
    expect(message.text).toContain('Unread: 2 sites could not be read')
    expect(message.html).toContain(`${ORIGIN}/weather`)
    assertClean(message)
  })
})
