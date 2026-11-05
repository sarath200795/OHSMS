// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StepInjuryReports from './StepInjuryReports'

const person = { id: 'p-osei', name: 'Asha', kind: 'internal' }

describe('Step 1a medical attachments', () => {
  it('shows a clinical file to a manager and not to a member', () => {
    const records = [
      { id: 'r1', personId: 'p-osei', name: 'gp-letter.pdf', type: 'application/pdf' },
    ]
    const { rerender } = render(
      <StepInjuryReports
        persons={[person]}
        records={records}
        canReadRecords={false}
        onAddRecord={() => {}}
      />
    )
    expect(screen.queryByText('gp-letter.pdf')).toBeNull()

    rerender(
      <StepInjuryReports
        persons={[person]}
        records={records}
        canReadRecords
        onAddRecord={() => {}}
        onRemoveRecord={() => {}}
      />
    )
    expect(screen.getByText('gp-letter.pdf')).toBeTruthy()
  })

  it('asks the injury-record writer for the person, and does not mark the file as an incident photo', async () => {
    const onAddRecord = vi.fn()
    render(
      <StepInjuryReports persons={[person]} canReadRecords={false} onAddRecord={onAddRecord} />
    )
    const input = document.querySelector('input[type="file"]')
    const file = new File(['%PDF'], 'gp-letter.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onAddRecord).toHaveBeenCalledTimes(1))
    const [personId, draft] = onAddRecord.mock.calls[0]
    expect(personId).toBe('p-osei')
    expect(draft.name).toBe('gp-letter.pdf')
    expect(draft.kind).toBeUndefined()
    expect(draft.dataUrl).toMatch(/^data:application\/pdf/)
  })

  it('tells a manager when older files are still in the photo album', () => {
    render(
      <StepInjuryReports persons={[person]} canReadRecords legacyCount={2} onAddRecord={() => {}} />
    )
    expect(screen.getByText(/still stored with the incident photos/)).toBeTruthy()
  })

  it('does not tell a member that count', () => {
    render(
      <StepInjuryReports
        persons={[person]}
        canReadRecords={false}
        legacyCount={2}
        onAddRecord={() => {}}
      />
    )
    expect(screen.queryByText(/still stored with the incident photos/)).toBeNull()
  })
})
