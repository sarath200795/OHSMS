// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MeetingMinutesDoc from './MeetingMinutesDoc'

afterEach(cleanup)

describe('MeetingMinutesDoc action owners', () => {
  it('prints a legacy owner as a person and a department by name', () => {
    render(
      <MeetingMinutesDoc
        meeting={{
          docId: 'MOM-1',
          actions: [
            { action: 'Fix the gate', owner: 'Ada' },
            { action: 'Mop the yard', ownerKind: 'department', department: 'Housekeeping', owner: '' },
          ],
        }}
      />,
    )
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Department · Housekeeping')).toBeTruthy()
    expect(screen.queryByText(/WEHS|WE EHS/)).toBeNull()
    expect(screen.queryByText(/Prepared by|Signature|Chairperson/)).toBeNull()
  })
})
