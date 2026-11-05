import { describe, it, expect } from 'vitest'
import { diffSummary } from './audit'

describe('diffSummary', () => {
  it('names an exposure change and does not copy the agent', () => {
    const summary = diffSummary(
      { exposedToAgent: 'solvent', location: 'Bay 3' },
      { exposedToAgent: 'acid', location: 'Bay 4' },
    )
    expect(summary).toContain('exposedToAgent: changed')
    expect(summary).not.toMatch(/solvent|acid/)
    expect(summary).toContain('location: Bay 3 → Bay 4')
  })

  it('does not mention an exposure that did not change', () => {
    expect(diffSummary({ exposedToAgent: 'solvent' }, { exposedToAgent: 'solvent' })).toBe('')
  })
})
