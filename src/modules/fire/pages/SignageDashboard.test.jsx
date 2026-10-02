// @vitest-environment jsdom
//
// The Signage Compliance board's photo figures: uploaded vs required in the
// totals, per type / site, and the list of Deployed signage with fewer photos
// than required. Informational — nothing here blocks anything.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fleet = { value: null }
vi.mock('../context/FleetContext', () => ({ useFleet: () => fleet.value }))

const { default: SignageDashboard } = await import('./SignageDashboard')

const ph = (n) => Array.from({ length: n }, (_, i) => ({ path: `orgs/o/signage-photos/${i}.jpg` }))
const rec = (over) => ({ id: 'x', centerName: 'Alpha', region: 'North', entity: 'COCO', type: 'No Smoking', quantity: 1, status: 'Deployed', location: 'Gate', ...over })

describe('Signage Compliance board — photos', () => {
  it('shows uploaded / required in the totals and lists signage short of photos', () => {
    fleet.value = {
      loading: false, incomplete: null, sites: ['Alpha'], siteInventory: [],
      extinguishers: [], aeds: [], fas: [], firstAid: [], stretchers: [], mockDrills: [],
      signages: [
        rec({ id: 'e', type: 'Fire Extinguisher Sign', quantity: 5, location: 'Lobby', photos: ph(2) }),
        rec({ id: 'f', type: 'FERP Signage', allFloors: true, totalFloors: 3, location: 'Core', photos: ph(3) }),
        rec({ id: 'n', type: 'No Smoking', photos: ph(1) }),
        rec({ id: 'p', type: 'Fire Exit', status: 'Planned' }), // not deployed: not expected yet
      ],
    }
    render(<MemoryRouter><SignageDashboard /></MemoryRouter>)
    expect(screen.getByText('Photos: uploaded / required').parentElement.textContent).toContain('6 / 9')
    const card = screen.getByTestId('photo-shortfall')
    expect(card.textContent).toContain('fewer photos than required — 1')
    const row = within(card).getByText('Lobby').closest('tr')
    expect(row.textContent).toContain('Fire Extinguisher Sign')
    expect(row.textContent).toContain('2 / 5')
    expect(row.textContent).toContain('3 more (one per extinguisher)')
    expect(within(card).queryByText('Core')).toBeNull()
  })

  it('says so when every deployed sign has its photos', () => {
    fleet.value = {
      loading: false, incomplete: null, sites: ['Alpha'], siteInventory: [],
      extinguishers: [], aeds: [], fas: [], firstAid: [], stretchers: [], mockDrills: [],
      signages: [rec({ photos: ph(1) })],
    }
    render(<MemoryRouter><SignageDashboard /></MemoryRouter>)
    expect(screen.getByTestId('photo-shortfall').textContent).toContain('Every deployed sign has its full set of photos.')
  })
})
