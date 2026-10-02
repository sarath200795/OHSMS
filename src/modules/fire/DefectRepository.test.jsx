// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { exportDefectRepository, toast, fleet } = vi.hoisted(() => ({
  exportDefectRepository: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  fleet: { physicalOpen: [], pendingReports: [], extinguishers: [], aeds: [], fas: [] },
}))
vi.mock('./lib/exporter', () => ({ exportDefectRepository }))
vi.mock('react-hot-toast', () => ({ default: toast }))
vi.mock('../../shared/lib/toastCaught', () => ({ toastCaught: vi.fn() }))
vi.mock('./lib/firestore', () => ({ resolveDefects: vi.fn(), decideAssetReport: vi.fn() }))
vi.mock('./context/FleetContext', () => ({ useFleet: () => fleet }))
vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ orgId: 'o', orgName: 'O', profile: { name: 'M' }, isManager: false }),
}))

const { default: DefectRepository } = await import('./DefectRepository')

beforeEach(() => {
  exportDefectRepository.mockReset()
  toast.success.mockClear()
  toast.error.mockClear()
  fleet.physicalOpen = []
  fleet.pendingReports = []
})

describe('DefectRepository export', () => {
  it('tells the user there is nothing to export instead of writing an empty file', () => {
    render(<DefectRepository />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    expect(exportDefectRepository).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('exports every defect on the list, extinguisher and QR-reported alike', () => {
    fleet.physicalOpen = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}:PIN`, extId: `e${i}`, defectType: 'PIN', defectLabel: 'PIN', serialNo: `FE-${i}`, centerName: 'S', reportedAt: new Date(2026, 8, 1 + (i % 20)),
    }))
    fleet.pendingReports = [
      { id: 'r1', kind: 'asset_defect', assetKind: 'aed', assetRefId: 'a1', assetLabel: 'AED-1', defect: 'x', reportedAt: new Date(2026, 8, 2) },
      { id: 'r2', kind: 'defect', extId: 'e1' }, // not an asset defect: not on the list
    ]
    render(<DefectRepository />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    expect(exportDefectRepository).toHaveBeenCalledTimes(1)
    const [rows, filename] = exportDefectRepository.mock.calls[0]
    expect(rows).toHaveLength(26) // beyond the 20-row page
    expect(filename).toMatch(/^equipment-defects-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(toast.success.mock.calls[0][0]).toMatch(/26 defects/)
  })
})
