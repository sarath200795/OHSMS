import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'

const backfillDocumentVisibility = vi.fn()
const backfillClaims = vi.fn()
const clearOrphanedDefectLocks = vi.fn()
const backfillProcedureMirrors = vi.fn()

vi.mock('../../shared/functions', () => ({
  backfillDocumentVisibility: (...a) => backfillDocumentVisibility(...a),
  backfillClaims: (...a) => backfillClaims(...a),
  clearOrphanedDefectLocks: (...a) => clearOrphanedDefectLocks(...a),
}))
// The procedure-mirror job runs in the browser rather than as a callable, so
// unlike its neighbours it needs the caller's org and reaches the LOTO service
// directly. Both are mocked here — importing the real service would stand up
// Firebase, and this page is rendered without a provider.
vi.mock('../../shared/auth/AuthContext', () => ({ useAuth: () => ({ orgId: 'org-1' }) }))
vi.mock('../../modules/loto/services/procedures', () => ({
  backfillProcedureMirrors: (...a) => backfillProcedureMirrors(...a),
}))
vi.mock('../../shared/monitoring', () => ({ reportError: vi.fn() }))
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
  clearOrphanedDefectLocks.mockResolvedValue({ total: 0, kept: 0, wouldRemove: 0, removed: 0, ids: [] })
  backfillProcedureMirrors.mockResolvedValue({ total: 3, present: 1, missing: 2, ids: ['p1', 'p2'], written: 0 })
  backfillClaims.mockResolvedValue({
    total: 5, updated: 4, stamped: 4, alreadyCorrect: 0, notApproved: 1, noAuthUser: 0, failed: [],
  })
})

// Several jobs carry a button of the same name, so every query is scoped to
// the region it belongs to.
const card = (name) => within(screen.getByRole('region', { name }))
const docs = () => card(/Stamp document visibility/)
const btn = (name) => docs().getByRole('button', { name })

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
    await act(async () => fireEvent.click(card(/sign-in token/).getByRole('button', { name: /Update tokens/ })))

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

// The LOTO procedure QR opens a public read-only page, which only exists for
// procedures that have a published mirror. Procedures written before that
// feature have none until something changes them, so this job publishes the
// rest — and like its neighbours it must not write until someone has looked.
describe('publishing procedure QR pages', () => {
  const job = () => within(screen.getByRole('region', { name: /Publish procedure QR pages/ }))

  it('will not publish until you have checked', () => {
    render(<Maintenance />)
    expect(job().getByRole('button', { name: /Publish them/ }).disabled).toBe(true)
  })

  it('reports how many printed codes lead nowhere, without writing', async () => {
    render(<Maintenance />)
    await act(async () => fireEvent.click(job().getByRole('button', { name: /Check first/ })))

    await waitFor(() =>
      expect(backfillProcedureMirrors).toHaveBeenCalledWith('org-1', { dryRun: true }))
    expect(screen.getByText(/2 whose printed code leads nowhere/)).toBeTruthy()
    expect(job().getByRole('button', { name: /Publish them/ }).disabled).toBe(false)
  })

  it('writes only on the second, explicit click', async () => {
    render(<Maintenance />)
    await act(async () => fireEvent.click(job().getByRole('button', { name: /Check first/ })))
    backfillProcedureMirrors.mockResolvedValue({ total: 3, present: 3, missing: 0, ids: [], written: 3 })
    await act(async () => fireEvent.click(job().getByRole('button', { name: /Publish them/ })))

    expect(backfillProcedureMirrors).toHaveBeenCalledWith('org-1', { dryRun: false })
    await waitFor(() => expect(job().getByRole('button', { name: /Published/ })).toBeTruthy())
  })

  it('stays disabled when every procedure is already published', async () => {
    backfillProcedureMirrors.mockResolvedValue({ total: 3, present: 3, missing: 0, ids: [], written: 0 })
    render(<Maintenance />)
    await act(async () => fireEvent.click(job().getByRole('button', { name: /Check first/ })))
    await waitFor(() => expect(job().getByRole('button', { name: /Publish them/ }).disabled).toBe(true))
  })
})
