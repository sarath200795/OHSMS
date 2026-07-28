import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the title and subtitle', () => {
    render(<EmptyState title="All caught up" subtitle="Nothing to review" />)
    expect(screen.getByText('All caught up')).toBeInTheDocument()
    expect(screen.getByText('Nothing to review')).toBeInTheDocument()
  })

  it('uses the default title when none is given', () => {
    render(<EmptyState />)
    expect(screen.getByText('All caught up')).toBeInTheDocument()
  })
})
