// @vitest-environment jsdom
//
// The Signage Register's edit form: the Status field, the photo control, and
// the rule that a sign cannot be saved as Deployed without a photo AND a
// last-checked date. deployedRequirementErrors is unit-tested in
// lib/signageLogic.test.js; these check the page actually asks it the right
// question — with the STORED record as `prev` — and shows the answer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

const fleet = { value: null }
const addSignage = vi.fn(async () => 'new-id')
const updateSignage = vi.fn(async () => {})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ orgId: 'org-1', orgName: 'Acme', profile: { uid: 'u1', name: 'Ravi' } }),
}))
vi.mock('../context/FleetContext', () => ({ useFleet: () => fleet.value }))
vi.mock('../lib/firestore', () => ({
  addSignage: (...a) => addSignage(...a),
  updateSignage: (...a) => updateSignage(...a),
  deleteSignage: vi.fn(),
  linkSignagesToSites: vi.fn(),
}))
vi.mock('../lib/exporter', () => ({ exportSignage: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../shared/org/SiteScopePicker', () => ({ default: () => null }))
vi.mock('../../../shared/storage/StoredImage', () => ({
  StoredImage: ({ pointer, alt }) => <img data-testid="stored" alt={alt} src={pointer?.path} />,
}))
const compress = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
vi.mock('../../../shared/lib/image', () => ({ fileToCompressedDataUrl: (...a) => compress(...a) }))

const { default: Signages } = await import('./Signages')

const photo = { path: 'orgs/org-1/signage-photos/a.jpg' }
const rec = (over) => ({
  id: 's1', centerName: 'Alpha', region: 'North', entity: 'COCO', type: 'No Smoking',
  condition: 'OK', quantity: 1, location: 'Gate', lastChecked: '', ...over,
})

function open(records, name = /Edit No Smoking signage/) {
  fleet.value = {
    loading: false, incomplete: null, sites: ['Alpha'],
    siteInventory: [{ id: 'site-a', name: 'Alpha', region: 'North', entity: 'COCO' }],
    extinguishers: [], aeds: [], fas: [], firstAid: [], stretchers: [], mockDrills: [],
    signages: records,
  }
  render(<Signages />)
  fireEvent.click(screen.getByRole('button', { name: /List/ }))
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('dialog')
}

const save = (dlg) => within(dlg).getByRole('button', { name: /Save changes/ })
const status = (dlg) => within(dlg).getByLabelText('Status')

beforeEach(() => {
  vi.clearAllMocks()
  compress.mockResolvedValue('data:image/jpeg;base64,AAAA')
})

describe('Signage form — status', () => {
  it('offers Not set, Planned, Deployed and Removed, and opens an old record as Not set', () => {
    const dlg = open([rec()])
    expect(status(dlg).value).toBe('')
    expect([...status(dlg).options].map((o) => o.textContent)).toEqual(['Not set', 'Planned', 'Deployed', 'Removed'])
    expect(save(dlg).disabled).toBe(false)
  })

  it('shows "Not set" in the list for a record without a status', () => {
    open([rec()])
    // (the dialog is open; the badge is in the table behind it)
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
  })
})

describe('Signage form — the Deployed requirement', () => {
  it('shows both errors and disables Save when an unset record is moved to Deployed', () => {
    const dlg = open([rec()])
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    expect(within(dlg).getByText('Add a photo before marking as deployed')).toBeTruthy()
    expect(within(dlg).getByText('Enter the last checked date')).toBeTruthy()
    expect(save(dlg).disabled).toBe(true)
  })

  it('clears the date error once a date is entered, leaving the photo one', () => {
    const dlg = open([rec()])
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    fireEvent.change(within(dlg).getByLabelText('Last checked'), { target: { value: '2026-09-01' } })
    expect(within(dlg).queryByText('Enter the last checked date')).toBeNull()
    expect(within(dlg).getByText('Add a photo before marking as deployed')).toBeTruthy()
    expect(save(dlg).disabled).toBe(true)
  })

  it('enables Save once a photo is picked and a date entered, and sends the draft + stored prev', async () => {
    const dlg = open([rec({ status: 'Planned' })])
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    fireEvent.change(within(dlg).getByLabelText('Last checked'), { target: { value: '2026-09-01' } })
    const input = dlg.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'p.png', { type: 'image/png' })] } })
    await waitFor(() => expect(within(dlg).getByAltText('Signage')).toBeTruthy())
    expect(within(dlg).queryByText('Add a photo before marking as deployed')).toBeNull()
    expect(save(dlg).disabled).toBe(false)
    fireEvent.click(save(dlg))
    await waitFor(() => expect(updateSignage).toHaveBeenCalledTimes(1))
    const [, id, payload, , prev] = updateSignage.mock.calls[0]
    expect(id).toBe('s1')
    expect(payload).toMatchObject({ status: 'Deployed', lastChecked: '2026-09-01', photoDraft: 'data:image/jpeg;base64,AAAA' })
    expect(prev).toMatchObject({ id: 's1', status: 'Planned' })
  })

  it('does not block an existing Deployed record with no photo or date from being edited', () => {
    const dlg = open([rec({ status: 'Deployed' })])
    expect(status(dlg).value).toBe('Deployed')
    expect(within(dlg).queryByText('Add a photo before marking as deployed')).toBeNull()
    expect(save(dlg).disabled).toBe(false)
  })

  it('does not re-open that exemption by switching away and back: prev is the stored status', () => {
    const dlg = open([rec({ status: 'Deployed' })])
    fireEvent.change(status(dlg), { target: { value: 'Removed' } })
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    // It IS still the stored status, so nothing new is being set.
    expect(save(dlg).disabled).toBe(false)
  })

  it('needs no photo or date for Planned or Removed', () => {
    const dlg = open([rec()])
    for (const v of ['Planned', 'Removed']) {
      fireEvent.change(status(dlg), { target: { value: v } })
      expect(save(dlg).disabled).toBe(false)
    }
  })

  it('a new record starts Not set and asks for evidence only when Deployed is chosen', () => {
    fleet.value = {
      loading: false, incomplete: null, sites: ['Alpha'], siteInventory: [], extinguishers: [], aeds: [],
      fas: [], firstAid: [], stretchers: [], mockDrills: [], signages: [],
    }
    render(<Signages />)
    fireEvent.click(screen.getAllByRole('button', { name: /Add signage/ })[0])
    const dlg = screen.getByRole('dialog')
    expect(status(dlg).value).toBe('')
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    expect(within(dlg).getByText('Add a photo before marking as deployed')).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: /Add signage/ }).disabled).toBe(true)
  })
})

describe('Signage form — the photo control', () => {
  it('shows the stored photo as a thumbnail with Replace and Remove', () => {
    const dlg = open([rec({ status: 'Planned', photo })])
    expect(within(dlg).getByTestId('stored').getAttribute('src')).toBe(photo.path)
    expect(within(dlg).getByText('Replace photo')).toBeTruthy()
    expect(within(dlg).getByText('Remove photo')).toBeTruthy()
  })

  it('Remove clears the photo, so a Deployed-bound record loses its evidence again', () => {
    const dlg = open([rec({ status: 'Planned', photo, lastChecked: '2026-09-01' })])
    fireEvent.change(status(dlg), { target: { value: 'Deployed' } })
    expect(save(dlg).disabled).toBe(false)
    fireEvent.click(within(dlg).getByText('Remove photo'))
    expect(within(dlg).getByText('Add a photo before marking as deployed')).toBeTruthy()
    expect(within(dlg).getByText('Add photo')).toBeTruthy()
    expect(save(dlg).disabled).toBe(true)
  })

  it('refuses a non-image file', () => {
    const dlg = open([rec()])
    fireEvent.change(dlg.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
    })
    expect(compress).not.toHaveBeenCalled()
  })
})
