import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './index'

afterEach(cleanup)

// Tab order inside the dialog is: Close (header) → Serial → Save (body).
function Fixture({ onClose = () => {}, ...rest }) {
  return (
    <Modal open onClose={onClose} title="Edit extinguisher" {...rest}>
      <input aria-label="Serial" />
      <button type="button">Save</button>
    </Modal>
  )
}

const dialog = () => screen.getByRole('dialog')
const closeBtn = () => screen.getByRole('button', { name: 'Close' })
const saveBtn = () => screen.getByRole('button', { name: 'Save' })

describe('Modal accessibility', () => {
  it('labels the dialog with its own heading', () => {
    render(<Fixture />)
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog().getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy)?.textContent).toBe('Edit extinguisher')
  })

  it('moves focus inside on open', () => {
    render(<Fixture />)
    expect(document.activeElement).toBe(closeBtn())
  })

  it('wraps Tab from the last control back to the first', () => {
    render(<Fixture />)
    saveBtn().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab' })
    expect(document.activeElement).toBe(closeBtn())
  })

  it('wraps Shift+Tab from the first control round to the last', () => {
    render(<Fixture />)
    closeBtn().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(saveBtn())
  })

  it('leaves Tab alone in the middle of the dialog', () => {
    render(<Fixture />)
    const serial = screen.getByLabelText('Serial')
    serial.focus()
    fireEvent.keyDown(dialog(), { key: 'Tab' })
    // No wrap forced — the browser's own sequential navigation takes it from here.
    expect(document.activeElement).toBe(serial)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Fixture onClose={onClose} />)
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks background scroll while open and restores it on close', () => {
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="T">
          <button type="button" onClick={() => setOpen(false)}>Dismiss</button>
        </Modal>
      )
    }
    render(<Host />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(document.body.style.overflow).toBe('')
  })

  it('returns focus to whatever opened it', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="T">
            <button type="button" onClick={() => setOpen(false)}>Dismiss</button>
          </Modal>
        </>
      )
    }
    render(<Host />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).not.toBe(trigger)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(document.activeElement).toBe(trigger)
  })

  it('does not re-grab focus when the parent re-renders with a fresh onClose', () => {
    function Host() {
      const [, bump] = useState(0)
      return (
        <>
          <button type="button" onClick={() => bump((n) => n + 1)}>Re-render</button>
          {/* inline arrow: a new function identity on every render */}
          <Modal open onClose={() => {}} title="T">
            <input aria-label="First" />
            <input aria-label="Second" />
          </Modal>
        </>
      )
    }
    render(<Host />)
    const second = screen.getByLabelText('Second')
    second.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Re-render' }))
    expect(document.activeElement).toBe(second)
  })

  it('accepts the module maxWidth spelling as well as size', () => {
    render(<Fixture maxWidth="max-w-3xl" />)
    expect(dialog().className).toContain('max-w-3xl')
  })
})
