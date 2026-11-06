import { describe, expect, it } from 'vitest'
import { REPORT_NOTE_MAX, boundReportText, reportNoteIssue } from './publicReport'

describe('public defect report text', () => {
  it('refuses a note the anonymous rule would reject', () => {
    expect(reportNoteIssue('pin missing')).toBe('')
    expect(reportNoteIssue('x'.repeat(REPORT_NOTE_MAX))).toBe('')
    expect(reportNoteIssue('x'.repeat(REPORT_NOTE_MAX + 1))).toMatch(/500/)
  })

  it('clips the strings the rules bound and leaves a token alone', () => {
    const bound = boundReportText({
      extLabel: 'S'.repeat(400),
      reportedByName: 'N'.repeat(200),
      reporterRole: 'Visitor',
      note: 'n'.repeat(800),
      defectType: 'empty',
      newStatus: null,
      token: 'tok-should-not-be-here',
    })
    expect(bound.extLabel).toHaveLength(200)
    expect(bound.reportedByName).toHaveLength(120)
    expect(bound.reporterRole).toBe('Visitor')
    expect(bound.note).toHaveLength(500)
    expect(bound.defectType).toBe('empty')
    expect(bound.newStatus).toBeNull()
    expect(bound.token).toBeUndefined()
  })
})
