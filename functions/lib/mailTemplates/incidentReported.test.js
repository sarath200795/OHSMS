import { describe, it, expect } from 'vitest'
import {
  renderIncidentReportedMail,
  fiveWhyText,
  SEALED_NOTE,
  NOT_RECORDED,
} from './incidentReported.js'
import { footerLine } from './layout.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const HYBRID = 'enk:1:medical:wrappedkeywrappedkeywrappedkey:iviviviviviviviv:ciphertextciphertext'

const node = (id, label, kind = 'box') => ({ id, data: { label, kind } })
const edge = (source, target) => ({ id: `e_${source}_${target}`, source, target })

const chain = {
  nodes: [
    node('problem', 'Problem: pallet fell', 'root'),
    node('w1', 'Rack beam gave way'),
    node('w2', 'Beam was not seated'),
    node('w3', 'Reconfiguration was not checked'),
  ],
  edges: [edge('problem', 'w1'), edge('w1', 'w2'), edge('w2', 'w3')],
}

function reported(over = {}) {
  return renderIncidentReportedMail(
    {
      refNo: 'IRA-2026-0007',
      docId: 'IRA-2026-0007',
      incidentDate: '2026-03-14',
      incidentTime: '09:15',
      severity: 'high',
      lifecycle: 'reporting',
      type: 'near_miss',
      site: 'Plant A',
      region: 'North',
      entity: 'Acme',
      location: 'Warehouse',
      narrative: 'A pallet fell from the second rack.',
      probableCause: 'Beam not seated after the reconfiguration.',
      stagesDone: { initial: true },
      investigations: [{ method: '5why', diagram: chain, summary: 'Change control gap.' }],
      capa: [{ dueDate: '2026-04-01', description: 'Inspect the beams' }],
      ...over,
    },
    { docId: 'inc1', appOrigin: 'https://suite.weehs.org', ...over.options }
  )
}

describe('renderIncidentReportedMail', () => {
  it('names the alert in the subject and carries the report, the chain and the footer', () => {
    const message = reported()
    expect(message.subject).toBe('Incident reported: IRA-2026-0007')
    expect(message.text.startsWith('Incident reported\n')).toBe(true)
    expect(message.text).toContain('An incident has been reported.')
    expect(message.text).toContain('Reference: IRA-2026-0007')
    expect(message.text).toContain('When: 2026-03-14 09:15')
    expect(message.text).toContain('Severity: High')
    expect(message.text).toContain('Status: Reporting')
    expect(message.text).toContain('Type: Near Miss')
    expect(message.text).toContain('Site: Plant A')
    expect(message.text).toContain('Region: North')
    expect(message.text).toContain('Entity: Acme')
    expect(message.text).toContain('Location: Warehouse')
    expect(message.text).toContain('Action due: 2026-04-01')
    expect(message.text).toContain('Description\nA pallet fell from the second rack.')
    expect(message.text).toContain('Probable cause\nBeam not seated after the reconfiguration.')
    expect(message.text).toContain('1. Rack beam gave way')
    expect(message.text).toContain('2. Beam was not seated')
    expect(message.text).toContain('3. Reconfiguration was not checked')
    expect(message.text).toContain('Summary: Change control gap.')
    expect(message.text).not.toContain('Problem: pallet fell')
    expect(message.text).toContain('Open it: https://suite.weehs.org/incidents/inc1')
    expect(message.text).toContain(footerLine())
    expect(message.html).toContain('Incident reported')
    expect(message.html).toContain('Open the incident')
    expect(message.html).toContain('href="https://suite.weehs.org/incidents/inc1"')
    expect(message.html).toContain('info@weehs.org')
    expect(message.html.toLowerCase()).toContain('do not reply')
    expect(message.html).toContain('EHS notifications')
  })

  it('escapes description and 5 Why in HTML and keeps the text part literal', () => {
    const message = reported({
      refNo: 'IRA & "1"',
      narrative: 'See <script>alert(1)</script> & "bay"',
      probableCause: '',
      investigations: [
        {
          method: '5why',
          diagram: {
            nodes: [node('problem', 'Problem: x', 'root'), node('w1', 'Why <b>this</b>')],
            edges: [edge('problem', 'w1')],
          },
          summary: 'A <img src=x onerror=alert(1)> gap',
        },
      ],
    })
    expect(message.subject).toBe('Incident reported: IRA & "1"')
    expect(message.subject).not.toContain('\n')
    expect(message.html).not.toContain('<script>')
    expect(message.html).not.toContain('<b>')
    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(message.html).toContain('IRA &amp; &quot;1&quot;')
    expect(message.html).toContain('Why &lt;b&gt;this&lt;/b&gt;')
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(message.html.match(/<title>/g)).toHaveLength(1)
    expect(message.text).toContain('<script>alert(1)</script>')
    expect(message.text).toContain('IRA & "1"')
    expect(message.text).not.toContain('&lt;')
  })

  it('strips a newline out of the reference so the subject cannot grow a header', () => {
    const message = reported({ refNo: 'IRA-1\r\nBcc: evil@example.com' })
    expect(message.subject).toBe('Incident reported: IRA-1 Bcc: evil@example.com')
    expect(message.subject).not.toMatch(/[\r\n]/)
  })

  it('omits a sealed description and a sealed 5 Why, and never prints the envelope', () => {
    const message = reported({
      narrative: SEALED,
      probableCause: HYBRID,
      investigations: [
        {
          method: '5why',
          diagram: {
            nodes: [node('problem', 'Problem: x', 'root'), node('w1', SEALED)],
            edges: [edge('problem', 'w1')],
          },
          summary: HYBRID,
        },
      ],
    })
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob).not.toContain('enc:')
    expect(blob).not.toContain('enk:')
    expect(message.text).toContain(`Description\n${SEALED_NOTE}`)
    expect(message.text).toContain(`Probable cause\n${SEALED_NOTE}`)
    expect(message.text).toContain(`5 Why\n${SEALED_NOTE}`)
  })

  it('keeps an unsealed why when a sibling label is sealed', () => {
    const message = reported({
      investigations: [
        {
          method: '5why',
          diagram: {
            nodes: [
              node('problem', 'Problem: x', 'root'),
              node('w1', 'Guard was left off'),
              node('w2', SEALED),
            ],
            edges: [edge('problem', 'w1'), edge('w1', 'w2')],
          },
          summary: 'The guard interlock was bypassed.',
        },
      ],
    })
    expect(message.text).toContain('1. Guard was left off')
    expect(message.text).toContain('Summary: The guard interlock was bypassed.')
    expect(message.text).toContain('Part of this analysis is sealed in the app.')
    expect(message.text).not.toContain('enc:')
    expect(message.html).not.toContain('enc:')
  })

  it('says the 5 Why is not recorded when the report has no investigation yet', () => {
    const message = reported({ investigations: [], probableCause: '' })
    expect(message.text).toContain(`5 Why\n${NOT_RECORDED}`)
    expect(message.text).not.toContain('Probable cause')
  })

  it('reads a legacy single investigation object', () => {
    const message = reported({
      investigations: undefined,
      investigation: { method: '5why', summary: 'Legacy finding.' },
    })
    expect(message.text).toContain('Summary: Legacy finding.')
  })

  it('does not walk a fishbone diagram for whys', () => {
    const message = reported({
      investigations: [{ method: 'fishbone', diagram: chain, summary: 'Man and method.' }],
    })
    expect(message.text).not.toContain('Rack beam gave way')
    expect(message.text).toContain(`5 Why\n${NOT_RECORDED}`)
    expect(message.text).not.toContain('Man and method.')
  })

  it('keeps every branch of a forked chain, not only the last why', () => {
    const text = fiveWhyText({
      investigations: [
        {
          method: '5why',
          diagram: {
            nodes: [...chain.nodes, node('w2b', 'Nobody signed off the change')],
            edges: [...chain.edges, edge('w1', 'w2b')],
          },
          summary: '',
        },
      ],
    })
    expect(text).toContain('1. Rack beam gave way')
    expect(text).toContain('2. Beam was not seated')
    expect(text).toContain('3. Reconfiguration was not checked')
    expect(text).toContain('4. Nobody signed off the change')
  })

  it('ignores toolbar placeholders and still uses a real summary', () => {
    const text = fiveWhyText({
      investigations: [
        {
          method: '5why',
          diagram: {
            nodes: [
              node('problem', 'Problem: x', 'root'),
              node('w1', 'Why did this happen?'),
              node('w2', 'Why?'),
            ],
            edges: [edge('problem', 'w1'), edge('w1', 'w2')],
          },
          summary: 'Written up in prose instead.',
        },
      ],
    })
    expect(text).toBe('Summary: Written up in prose instead.')
    expect(text).not.toContain('Why?')
  })

  it('drops a link that is not an in-app path', () => {
    const message = renderIncidentReportedMail(
      { refNo: 'IRA-1', narrative: 'Fell.', stagesDone: { initial: true } },
      { docId: '../admin', appOrigin: 'javascript:alert(1)' }
    )
    expect(message.text).toContain('Open it in the app: /incidents')
    expect(message.text).not.toContain('javascript:')
    expect(message.html).not.toContain('javascript:')
    expect(message.html).not.toContain('href="http')
  })

  it('fills site labels from the site record when the incident left them blank', () => {
    const message = renderIncidentReportedMail(
      { refNo: 'IRA-2', siteId: 's1', narrative: 'Spill.', lifecycle: 'reporting' },
      {
        docId: 'inc2',
        appOrigin: 'https://suite.weehs.org',
        site: { name: 'Dock 4', region: 'South', entity: 'Logistics' },
      }
    )
    expect(message.text).toContain('Site: Dock 4')
    expect(message.text).toContain('Region: South')
    expect(message.text).toContain('Entity: Logistics')
  })
})
