// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SiteTypeBackfill from './SiteTypeBackfill'

afterEach(cleanup)

const sites = [
  { id: '1', name: 'North', entity: 'COCO', facility: '' },
  { id: '2', name: 'Market', entity: 'Market Place', facility: '' },
  { id: '3', name: 'Shop', entity: 'EBO', facility: '' },
  { id: '4', name: 'Dock', entity: 'd2c', facility: '' },
  { id: '5', name: 'Head office', entity: 'COCO', facility: 'Office' },
  { id: '6', name: 'Swim', entity: 'Fitso', facility: '' },
  { id: '7', name: 'Bare', entity: '', facility: '' },
]

describe('SiteTypeBackfill', () => {
  it('previews the ownership-model default and applies only that count', () => {
    const onChange = vi.fn()
    const onApply = vi.fn()
    render(
      <SiteTypeBackfill
        rows={[]}
        onChange={onChange}
        activityTypes={[]}
        sites={sites}
        busy={false}
        onApply={onApply}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load ownership-model default' }))
    const loaded = onChange.mock.calls[0][0]
    expect(loaded.map((row) => row.entity)).toEqual([
      'FOFO',
      'FOCO',
      'COCO',
      'Marketplace',
      'EBO',
      'D2C',
    ])
    cleanup()
    render(
      <SiteTypeBackfill
        rows={loaded}
        onChange={() => {}}
        activityTypes={[]}
        sites={sites}
        busy={false}
        onApply={onApply}
      />
    )
    expect(screen.getByRole('button', { name: 'Apply to empty sites' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByText(/Would fill: 4/)).toBeTruthy()
    expect(screen.getByText(/Already have a type: 1/)).toBeTruthy()
    expect(screen.getByText(/Fitso \(1\)/)).toBeTruthy()
    expect(screen.getByText(/Marketplace → Indoor gym \(1\)/)).toBeTruthy()
    expect(screen.getByText(/D2C → Warehouse \(1\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to empty sites' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const plan = onApply.mock.calls[0][0]
    expect(plan.updates.map((row) => row.id).sort()).toEqual(['1', '2', '3', '4'])
    expect(plan.updates.find((row) => row.id === '2').facility).toBe('Indoor gym')
    expect(plan.updates.find((row) => row.id === '4').facility).toBe('Warehouse')
  })
})
