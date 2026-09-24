import { describe, it, expect } from 'vitest'
import { planAssignmentMails, renderAssignmentMail } from '../assignmentNotify.js'
import { ASSIGNMENT_TEMPLATE_KINDS, renderAssignmentMessage } from './assignments.js'
import { escapeHtml } from './safe.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const HYBRID = 'enk:1:medical:wrapped:iviviviviviviviv:ciphertextciphertext'
const ORIGIN = 'https://suite.weehs.org'

function render(plan, options) {
  return renderAssignmentMessage(plan, { appOrigin: ORIGIN, ...options })
}

describe('escapeHtml', () => {
  it('escapes the characters that break out of text or a double-quoted attribute', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })
})

describe('assignment mail templates', () => {
  it('renders a subject, module label, context, due date, assigner, link and footer for each module', () => {
    const cases = [
      {
        plan: {
          kind: 'assignment.incident_capa',
          includeTitle: true,
          title: 'Fix the guard',
          what: 'corrective action',
          context: 'IRA-2026-0001',
          due: '2026-10-01',
          path: '/incidents/i1',
        },
        label: 'Incident',
        subject: 'Incident CAPA: Fix the guard (IRA-2026-0001)',
        rows: ['What: Fix the guard', 'Record: IRA-2026-0001'],
        action: 'Open the incident',
        url: `${ORIGIN}/incidents/i1`,
      },
      {
        plan: {
          kind: 'assignment.illness_action',
          includeTitle: false,
          title: 'Review the asthma case',
          what: 'corrective action on an occupational illness record',
          context: 'ILL-2026-0003',
          due: '2026-11-01',
          path: '/incidents/illness/ill1',
        },
        label: 'Illness',
        subject: 'Illness action assigned (ILL-2026-0003)',
        rows: ['Record: ILL-2026-0003'],
        absent: ['asthma', 'What:'],
        action: 'Open the record',
        url: `${ORIGIN}/incidents/illness/ill1`,
      },
      {
        plan: {
          kind: 'assignment.drill_capa',
          includeTitle: true,
          title: 'Check the assembly point',
          what: 'mock-drill corrective action',
          context: 'Fire Emergency',
          due: '2026-10-02',
          path: '/mock-drills',
        },
        label: 'Mock drill',
        subject: 'Mock drill CAPA: Check the assembly point (Fire Emergency)',
        rows: ['What: Check the assembly point', 'Scenario: Fire Emergency'],
        action: 'Open mock drills',
        url: `${ORIGIN}/mock-drills`,
      },
      {
        plan: {
          kind: 'assignment.training',
          includeTitle: true,
          title: 'Working at Height',
          what: 'training course',
          context: 'Training',
          due: '2026-06-15',
          path: '/training/my',
        },
        label: 'Training',
        subject: 'Training assigned: Working at Height',
        rows: ['Course: Working at Height'],
        absent: ['Record: Training', '(Training)'],
        action: 'Open my training',
        url: `${ORIGIN}/training/my`,
      },
    ]

    expect(cases.map((item) => item.plan.kind).sort()).toEqual(
      [...ASSIGNMENT_TEMPLATE_KINDS].sort()
    )

    for (const item of cases) {
      const message = render(item.plan, { assignerName: 'Priya Menon' })
      expect(message.subject, item.plan.kind).toBe(item.subject)
      expect(message.subject).not.toMatch(/[\r\n]/)
      expect(message.text.startsWith(`${item.label}\n`)).toBe(true)
      expect(message.html).toContain(`>${item.label}<`)
      for (const row of item.rows) {
        expect(message.text, row).toContain(row)
        expect(message.html).toContain(row.split(': ')[1])
      }
      expect(message.text).toContain('Due: ' + item.plan.due)
      expect(message.text).toContain('Assigned by: Priya Menon')
      expect(message.html).toContain('Priya Menon')
      expect(message.text).toContain(`Open it: ${item.url}`)
      expect(message.html).toContain(`href="${item.url}"`)
      expect(message.html).toContain(item.action)
      expect(message.text).toContain('Sent by EHS notifications · info@weehs.org')
      expect(message.text.toLowerCase()).toContain('do not reply')
      expect(message.html).toContain('info@weehs.org')
      expect(message.html.toLowerCase()).toContain('do not reply')
      for (const banned of item.absent || []) {
        expect(message.subject).not.toContain(banned)
        expect(message.text).not.toContain(banned)
        expect(message.html).not.toContain(banned)
      }
    }
  })

  it('omits due and assigner lines when they were not on the plan', () => {
    const message = render({
      kind: 'assignment.incident_capa',
      includeTitle: true,
      title: 'Fix the guard',
      what: 'corrective action',
      context: 'IRA-1',
      due: '',
      path: '/incidents/i1',
    })
    expect(message.text).not.toContain('Due:')
    expect(message.text).not.toContain('Assigned by:')
    expect(message.html).not.toContain('>Due<')
    expect(message.html).not.toContain('Assigned by')
  })

  it('does not copy an illness action description even when a caller passes it as the title', () => {
    const message = render({
      kind: 'assignment.illness_action',
      includeTitle: true,
      title: 'Review the asthma case',
      what: 'corrective action on an occupational illness record',
      context: 'ILL-9',
      path: '/incidents/illness/ill9',
    })
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob.toLowerCase()).not.toContain('asthma')
    expect(message.text).not.toContain('What:')
    expect(message.text).toContain('Record: ILL-9')
    expect(message.subject).toBe('Illness action assigned (ILL-9)')
  })

  it('drops sealed titles, context, due dates and assigner names from every part', () => {
    const message = render(
      {
        kind: 'assignment.incident_capa',
        includeTitle: true,
        title: SEALED,
        what: 'corrective action',
        context: HYBRID,
        due: SEALED,
        path: '/incidents/i1',
      },
      { assignerName: SEALED }
    )
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob).not.toContain('enc:')
    expect(blob).not.toContain('enk:')
    expect(message.subject).toBe('Incident CAPA assigned')
    expect(message.text).not.toContain('What:')
    expect(message.text).not.toContain('Record:')
    expect(message.text).not.toContain('Due:')
    expect(message.text).not.toContain('Assigned by:')
    expect(message.text).toContain('Open it: https://suite.weehs.org/incidents/i1')
  })

  it('keeps an ordinary title that merely contains the letters enc', () => {
    const message = render({
      kind: 'assignment.incident_capa',
      includeTitle: true,
      title: 'Fence the pit',
      what: 'corrective action',
      context: 'IRA-2',
      path: '/incidents/i2',
    })
    expect(message.subject).toContain('Fence the pit')
    expect(message.text).toContain('What: Fence the pit')
    expect(message.html).toContain('Fence the pit')
  })

  it('escapes user-controlled strings in HTML and leaves them literal in the text part', () => {
    const message = render(
      {
        kind: 'assignment.incident_capa',
        includeTitle: true,
        title: '</title><script>alert(1)</script>',
        what: 'corrective action',
        context: 'IRA & "1"',
        due: '2026-10-01',
        path: '/incidents/i1',
      },
      { assignerName: `A <b>B</b> & Co` }
    )
    expect(message.html).not.toContain('<script>')
    expect(message.html).not.toContain('<b>')
    expect(message.html).toContain('&lt;/title&gt;&lt;script&gt;')
    expect(message.html).toContain('IRA &amp; &quot;1&quot;')
    expect(message.html).toContain('A &lt;b&gt;B&lt;/b&gt; &amp; Co')
    expect(message.html.match(/<title>/g)).toHaveLength(1)
    expect(message.text).toContain('<script>alert(1)</script>')
    expect(message.text).toContain('IRA & "1"')
    expect(message.text).not.toContain('&lt;')
    expect(message.subject).not.toMatch(/[\r\n]/)
  })

  it('collapses a newline in the assigner so it cannot start a second header', () => {
    const message = render(
      {
        kind: 'assignment.training',
        includeTitle: true,
        title: 'Working at Height',
        what: 'training course',
        context: 'Training',
        path: '/training/my',
      },
      { assignerName: 'Priya\r\nBcc: evil@example.com' }
    )
    expect(message.subject).not.toMatch(/[\r\n]/)
    expect(message.text).not.toMatch(/[\r\n]Bcc:/)
    expect(message.text).toContain('Assigned by: Priya Bcc: evil@example.com')
  })

  it('does not turn a hostile path or origin into a link', () => {
    const script = render({
      kind: 'assignment.incident_capa',
      includeTitle: true,
      title: 'Fix the guard',
      what: 'corrective action',
      context: 'IRA-1',
      path: '/incidents/i1"><script>alert(1)</script>',
    })
    expect(script.html).not.toContain('<script>')
    expect(script.html).not.toContain('href="http')
    expect(script.text).not.toContain('Open it:')

    const offsite = render(
      {
        kind: 'assignment.incident_capa',
        includeTitle: false,
        what: 'corrective action',
        context: 'IRA-1',
        path: 'https://evil.example/phish',
      },
      { appOrigin: 'javascript:alert(1)' }
    )
    const blob = `${offsite.text}\n${offsite.html}`
    expect(blob).not.toContain('evil.example')
    expect(blob).not.toContain('javascript:')
  })

  it('still renders a text and html body for a kind that has no template yet', () => {
    const message = render(
      {
        kind: 'assignment.future',
        includeTitle: true,
        title: 'Do the thing',
        what: 'task',
        context: 'REF-1',
        path: '/somewhere',
      },
      { appOrigin: 'https://app.example' }
    )
    expect(message.subject).toBe('Assigned: Do the thing (REF-1)')
    expect(message.text).toContain('Open it: https://app.example/somewhere')
    expect(message.html).toContain('href="https://app.example/somewhere"')
    expect(message.html).toContain('EHS notifications')
    expect(message.text).toContain('info@weehs.org')
  })

  it('uses the organisation name in the header and footer, and escapes it in HTML', () => {
    const message = render(
      {
        kind: 'assignment.incident_capa',
        includeTitle: true,
        title: 'Fix the guard',
        what: 'corrective action',
        context: 'IRA-1',
        path: '/incidents/i1',
      },
      { sender: 'Northwind & Co', appOrigin: 'https://app.example' }
    )
    expect(message.senderName).toBe('Northwind & Co')
    expect(message.text).toContain('Sent by Northwind & Co · info@weehs.org')
    expect(message.html).toContain('Northwind &amp; Co')
    expect(message.html).not.toContain('Northwind & Co')
    expect(message.text).not.toContain('EHS notifications')
    expect(message.html).not.toContain('EHS notifications')
  })

  it('keeps the neutral label when the only name offered is the product name', () => {
    const message = render(
      {
        kind: 'assignment.training',
        includeTitle: true,
        title: 'Working at Height',
        path: '/training/my',
      },
      { sender: 'WEEHS OHSMS', appOrigin: 'https://app.example' }
    )
    expect(message.senderName).toBe('EHS notifications')
    expect(message.text).toContain('Sent by EHS notifications ·')
    expect(`${message.subject}\n${message.text}\n${message.html}`).not.toContain('WEEHS')
  })

  it('is the body renderAssignmentMail returns, for every kind the planner emits', () => {
    const samples = [
      {
        collection: 'incidents',
        docId: 'i1',
        after: {
          refNo: 'IRA-1',
          capa: [
            {
              id: 'a1',
              description: 'Fix the guard',
              ownerUid: 'u1',
              dueDate: '2026-10-01',
              status: 'open',
            },
          ],
        },
      },
      {
        collection: 'illnesses',
        docId: 'ill1',
        after: {
          refNo: 'ILL-1',
          actions: [
            {
              id: 'a1',
              description: 'Review the asthma case',
              ownerUid: 'u1',
              dueDate: '2026-11-01',
              status: 'open',
            },
          ],
        },
      },
      {
        collection: 'mockDrills',
        docId: 'd1',
        after: {
          scenario: 'Fire Emergency',
          capa: [
            {
              action: 'Check the assembly point',
              assignees: [{ uid: 'u1' }],
              due: '2026-10-02',
              status: 'Open',
            },
          ],
        },
      },
      {
        collection: 'trainingAssignments',
        docId: 'as1',
        after: {
          employeeUid: 'u1',
          assignedBy: 'u9',
          courseName: 'Working at Height',
          dueDate: '2026-06-15',
          status: 'assigned',
        },
      },
    ]

    const kinds = []
    for (const sample of samples) {
      const [plan] = planAssignmentMails({ ...sample, before: null })
      kinds.push(plan.kind)
      const options = { assignerName: 'Priya Menon', appOrigin: ORIGIN }
      const message = renderAssignmentMail(plan, options)
      expect(message).toEqual(renderAssignmentMessage(plan, options))
      expect(message.html).toContain('EHS notifications')
      expect(message.html).toContain('info@weehs.org')
      expect(message.text).toContain('Open it: ')
      expect(JSON.stringify(message)).not.toContain('asthma')
      expect(JSON.stringify(message)).not.toContain('enc:')
    }
    expect(kinds.sort()).toEqual([...ASSIGNMENT_TEMPLATE_KINDS].sort())
  })

  it('does not mail a sealed incident action that the planner already blanked', () => {
    const [plan] = planAssignmentMails({
      collection: 'incidents',
      before: null,
      docId: 'i1',
      after: {
        refNo: 'IRA-1',
        capa: [{ id: 'a1', description: SEALED, ownerUid: 'u1', status: 'open' }],
      },
    })
    const message = renderAssignmentMail(plan, { appOrigin: ORIGIN })
    const blob = `${message.subject}\n${message.text}\n${message.html}`
    expect(blob).not.toContain('enc:')
    expect(message.text).toContain('Record: IRA-1')
    expect(message.subject).toBe('Incident CAPA assigned (IRA-1)')
  })
})
