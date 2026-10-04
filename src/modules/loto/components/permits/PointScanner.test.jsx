// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PointScanner from './PointScanner'

beforeEach(() => cleanup())
afterEach(() => { delete window.BarcodeDetector })

describe('PointScanner', () => {
  it('falls back to a typed code when the browser has no barcode detector', () => {
    render(<PointScanner onCode={() => {}} />)
    expect(screen.getByText(/cannot scan from the camera/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /camera/ })).toBeNull()
  })

  it('hands a typed code to the caller as a manual scan and clears the box', () => {
    const onCode = vi.fn()
    render(<PointScanner onCode={onCode} />)
    const box = screen.getByLabelText(/Tag code/)
    fireEvent.change(box, { target: { value: ' E-1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record scan' }))
    expect(onCode).toHaveBeenCalledWith(' E-1 ', 'manual')
    expect(box.value).toBe('')
  })

  it('will not record an empty code', () => {
    const onCode = vi.fn()
    render(<PointScanner onCode={onCode} />)
    expect(screen.getByRole('button', { name: 'Record scan' }).disabled).toBe(true)
  })

  it('offers the camera where the browser supports it, and says so when it cannot be opened', async () => {
    window.BarcodeDetector = class {}
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new Error('denied') }) },
    })
    render(<PointScanner onCode={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Scan a tag with the camera/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/camera could not be opened/)
  })
})
