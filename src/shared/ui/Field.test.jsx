// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field, IconButton } from './index'

afterEach(cleanup)

// getByLabelText resolves the label→control association the way a screen reader
// does, so these assertions fail for exactly the reason a user would complain:
// the label is on screen but names nothing.
describe('Field labels its control', () => {
  it('attaches a generated id when the call site gives none', () => {
    render(
      <Field label="Start time">
        <input type="time" />
      </Field>
    )
    const input = screen.getByLabelText('Start time')
    expect(input.tagName).toBe('INPUT')
    expect(input.id).toBeTruthy()
  })

  it('works for select and textarea, not just input', () => {
    render(
      <>
        <Field label="Type of work">
          <select>
            <option>Hot work</option>
          </select>
        </Field>
        <Field label="Description">
          <textarea />
        </Field>
      </>
    )
    expect(screen.getByLabelText('Type of work').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA')
  })

  it('gives each Field a distinct id', () => {
    render(
      <>
        <Field label="Start date">
          <input type="date" />
        </Field>
        <Field label="End date">
          <input type="date" />
        </Field>
      </>
    )
    const a = screen.getByLabelText('Start date')
    const b = screen.getByLabelText('End date')
    expect(a.id).not.toBe(b.id)
  })

  // An explicit htmlFor is the caller naming the control they mean — often one
  // nested deeper than Field can see. Overriding it would silently repoint the
  // label at the wrong element.
  it('defers to an explicit htmlFor', () => {
    render(
      <Field label="Serial number" htmlFor="serial">
        <div>
          <input id="serial" />
        </div>
      </Field>
    )
    expect(screen.getByLabelText('Serial number').id).toBe('serial')
  })

  it('keeps an id the child already carries', () => {
    render(
      <Field label="Permit number">
        <input id="permit-no" />
      </Field>
    )
    expect(screen.getByLabelText('Permit number').id).toBe('permit-no')
  })

  // The `action` variant renders a different branch — "Forgot password?" beside
  // the label — and it was the branch most likely to be missed.
  it('labels the control in the action variant too', () => {
    render(
      <Field label="Password" action={<button type="button">Forgot?</button>}>
        <input type="password" />
      </Field>
    )
    expect(screen.getByLabelText('Password').tagName).toBe('INPUT')
  })

  // Nothing to point at, and guessing would attach the label to whichever
  // control happened to be first.
  it('leaves multi-element children alone rather than guessing', () => {
    render(
      <Field label="Coordinates">
        <input aria-label="Latitude" />
        <input aria-label="Longitude" />
      </Field>
    )
    expect(screen.getByLabelText('Latitude')).toBeTruthy()
    expect(screen.getByLabelText('Longitude')).toBeTruthy()
  })
})

describe('IconButton', () => {
  it('names itself with its label', () => {
    render(<IconButton label="Delete row" icon={() => <svg />} />)
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeTruthy()
  })

  // A default label would make the unlabelled case work silently, which is how
  // fifty unlabelled icon buttons happened in the first place.
  it('refuses to render without a label', () => {
    expect(() => render(<IconButton icon={() => <svg />} />)).toThrow(/label/)
  })
})
