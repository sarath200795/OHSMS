// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const { exportQrLabelPdf, toast } = vi.hoisted(() => ({
  exportQrLabelPdf: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/qrLabelSheet', () => ({ exportQrLabelPdf }))
vi.mock('react-hot-toast', () => ({ default: toast }))
vi.mock('../../../shared/lib/toastCaught', () => ({ toastCaught: vi.fn() }))

const { default: ExportQrButton } = await import('./ExportQrButton')

beforeEach(() => {
  exportQrLabelPdf.mockReset()
  toast.success.mockClear()
  toast.error.mockClear()
})

describe('ExportQrButton', () => {
  it('exports exactly the rows it is given and reports the count', async () => {
    exportQrLabelPdf.mockResolvedValue({ exported: 2, skipped: 0 })
    const rows = [{ id: 'a' }, { id: 'b' }]
    render(<ExportQrButton kind="aed" rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: /Export QR codes/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(exportQrLabelPdf).toHaveBeenCalledWith('aed', rows, expect.objectContaining({ onProgress: expect.any(Function) }))
    expect(toast.success.mock.calls[0][0]).toMatch(/Exported 2 QR codes/)
  })

  it('shows the selection size on the button', () => {
    render(<ExportQrButton kind="fas" rows={[{ id: 'a' }]} selectedCount={1} />)
    expect(screen.getByRole('button').textContent).toMatch(/1 selected/)
  })

  it('shows progress while running and locks the button', async () => {
    let progress
    let finish
    exportQrLabelPdf.mockImplementation((k, r, opts) => {
      progress = opts.onProgress
      return new Promise((res) => { finish = res })
    })
    render(<ExportQrButton kind="fas" rows={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />)
    fireEvent.click(screen.getByRole('button'))
    const btn = await screen.findByRole('button')
    expect(btn.disabled).toBe(true)
    act(() => progress(1, 3))
    await waitFor(() => expect(screen.getByRole('button').textContent).toMatch(/1\/3/))
    finish({ exported: 3, skipped: 0 })
    await waitFor(() => expect(screen.getByRole('button').disabled).toBe(false))
  })

  it('says so when rows were left out for lack of a QR code', async () => {
    exportQrLabelPdf.mockResolvedValue({ exported: 1, skipped: 2 })
    render(<ExportQrButton kind="fas" rows={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.success.mock.calls[0][0]).toMatch(/2 without a QR code were left out/)
  })

  it('errors, not silently succeeds, when nothing has a QR code', async () => {
    exportQrLabelPdf.mockResolvedValue({ exported: 0, skipped: 1 })
    render(<ExportQrButton kind="fas" rows={[{ id: 'a' }]} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('is disabled with no rows', () => {
    render(<ExportQrButton kind="aed" rows={[]} />)
    expect(screen.getByRole('button').disabled).toBe(true)
  })
})
