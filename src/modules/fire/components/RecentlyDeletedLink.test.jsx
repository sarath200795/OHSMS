// @vitest-environment jsdom
//
// Recently deleted was reachable only from the last pill of a sideways-scrolling
// tab strip, off-screen on a phone, and no register linked to it. These pin the
// header button: who is offered it, that it shows with an empty bin, and that
// its count is only what this person could restore.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = { value: null }
const fleet = { value: null }

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../context/FleetContext', () => ({ useFleet: () => fleet.value }))

const { default: RecentlyDeletedLink } = await import('./RecentlyDeletedLink')

const gone = new Date('2026-09-20T08:00:00Z')
const admin = { profile: { uid: 'a', role: 'admin' }, isAdmin: true, isManager: true }
const manager = (access, siteId) => ({
  profile: { uid: 'm', role: 'manager', access, siteId },
  isAdmin: false,
  isManager: true,
})
const member = { profile: { uid: 'x', role: 'member' }, isAdmin: false, isManager: false }

beforeEach(() => {
  fleet.value = {
    deletedExtinguishers: [
      { id: 'e1', siteId: 's1', deletedAt: gone },
      { id: 'e2', siteId: 's2', deletedAt: gone },
    ],
    deletedAeds: [{ id: 'a1', siteId: 's1', deletedAt: gone }],
    deletedFas: [],
  }
})
afterEach(cleanup)

const show = (props = {}) =>
  render(
    <MemoryRouter>
      <RecentlyDeletedLink {...props} />
    </MemoryRouter>
  )
const link = () => screen.queryByRole('link', { name: /Recently deleted/ })

describe('Recently deleted header link', () => {
  it('gives an org admin a link to the bin with the count for that register', () => {
    auth.value = admin
    show({ kinds: ['extinguisher'] })
    expect(link().getAttribute('href')).toBe('/equipment/recycle')
    expect(screen.getByTestId('recycle-count').textContent).toBe('2')
  })

  it('counts every kind when no register is named', () => {
    auth.value = admin
    show()
    expect(screen.getByTestId('recycle-count').textContent).toBe('3')
  })

  it('still shows the link with an empty bin, without a badge', () => {
    auth.value = admin
    fleet.value = { deletedExtinguishers: [], deletedAeds: undefined, deletedFas: [] }
    show()
    expect(link()).toBeTruthy()
    expect(screen.queryByTestId('recycle-count')).toBeNull()
  })

  it('counts only the units inside a manager’s grant', () => {
    auth.value = manager({ sites: ['s1'] })
    show({ kinds: ['extinguisher'] })
    expect(link()).toBeTruthy()
    expect(screen.getByTestId('recycle-count').textContent).toBe('1')
  })

  it('offers it to a manager whose only grant is their own posting', () => {
    auth.value = manager({}, 's2')
    show({ kinds: ['extinguisher'] })
    expect(screen.getByTestId('recycle-count').textContent).toBe('1')
  })

  it('hides it from a manager with no grant and from a member', () => {
    auth.value = manager({ sites: [], regions: [], entities: [] })
    show()
    expect(link()).toBeNull()
    cleanup()
    auth.value = member
    show()
    expect(link()).toBeNull()
  })
})
