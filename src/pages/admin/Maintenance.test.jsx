import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

const backfillDocumentVisibility = vi.fn()
const backfillClaims = vi.fn()

vi.mock('../../shared/functions', () => ({
  backfillDocumentVisibility: (...a) => backfillDocumentVisibility(...a),
  backfillClaims: (...a) => backfillClaims(...a),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const { default: Maintenance } = await import('./Maintenance')

const DRY = {
  total: 4, alreadyStamped: 1, wouldWrite: 3, written: 0,
  orgWide: 2, siteScoped: 1, titles: ['Lockout/Tagout Policy'],
}

beforeEach(() => {
  vi.clearAllMocks()
  backfillDocumentVisibility.mockResolvedValue(DRY)
  backfillClaims.mockResolvedValue({
    total: 5, updated: 4, stamped: 4, alreadyCorrect: 0, notApproved: 1, noAuthUser: 0, failed: [],
  })
})

const btn = (name) => screen.getByRole('button', { name })

describe('Maintenance', () => {
  it('offers both jobs', () => {
    render(<Maintenance />)
    expect(screen.getByRole('heading', { name: /Stamp document visibility/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /sign-in token/ })).toBeTruthy()
  })

  // The write touches every document in the library, so it stays out of reach
  // until someone has actually looked at what it would do.
  it('will not stamp until you have checked', () => {
    render(<Maintenance />)
    expect(btn(/Stamp them/).disabled).toBe(true)
  })

  it('checks without writing, and reports what it found', async () => {
    render(<Maintenance />)
    await act(async () => fireEvent.click(btn(/Check first/)))

    await waitFor(() => expect(backfillDocumentVisibility).toHaveBeenCalledWith({ dryRun: true }))
    expect(screen.getByText(/3 to stamp/)).toBeTruthy()
    expect(screen.getByText(/Lockout\/Tagout Policy/)).toBeTruthy()
    expect(btn(/Stamp them/).disabled).toBe(false)
  })

  it('writes only on the second, explicit click', async () => {
    render(<Maintenance />)
    await act(async () => fireEvent.click(btn(/Check first/)))
    await waitFor(() => expect(btn(/Stamp them/).disabled).toBe(false))

    backfillDocumentVisibility.mockResolvedValue({ ...DRY, written: 3, wouldWrite: 3 })
    await act(async () => fireEvent.click(btn(/Stamp them/)))

    await waitFor(() => expect(backfillDocumentVisibility).toHaveBeenLastCalledWith({ dryRun: false }))
  })

  // Nothing to do is a success, not an invitation to press the dangerous button.
  it('leaves the write disabled when there is nothing to stamp', async () => {
    backfillDocumentVisibility.mockResolvedValue({ ...DRY, wouldWrite: 0, orgWide: 0, siteScoped: 0, titles: [] })
    render(<Maintenance />)
    await act(async () => fireEvent.click(btn(/Check first/)))

    await waitFor(() => expect(screen.getByText(/0 to stamp/)).toBeTruthy())
    expect(btn(/Stamp them/).disabled).toBe(true)
  })

  it('runs the claims job and reports the counts', async () => {
    render(<Maintenance />)
    await act(async () => fireEvent.click(btn(/Update tokens/)))

    await waitFor(() => expect(backfillClaims).toHaveBeenCalled())
    expect(screen.getByText(/4 updated/)).toBeTruthy()
  })

  it('surfaces a failure instead of looking like it worked', async () => {
    backfillDocumentVisibility.mockRejectedValue(new Error('permission-denied'))
    const toast = (await import('react-hot-toast')).default
    render(<Maintenance />)
    await act(async () => fireEvent.click(btn(/Check first/)))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission-denied'))
    expect(btn(/Stamp them/).disabled).toBe(true)
  })
})
