// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WeatherPrecautions from './WeatherPrecautions'

afterEach(cleanup)

describe('WeatherPrecautions', () => {
  it('shows the built-in sentence for a selected activity and keeps an edit', () => {
    const onChange = vi.fn()
    render(<WeatherPrecautions activityTypes={['Construction']} value={{}} onChange={onChange} />)
    const heat = screen.getByLabelText('Construction — Heat Stress')
    expect(heat.placeholder).toMatch(/at-height/)
    expect(heat.placeholder).toMatch(/hot work/i)
    fireEvent.change(heat, { target: { value: 'Custom shade rule for the yard crews.' } })
    expect(onChange).toHaveBeenCalledWith({
      Construction: { heat: 'Custom shade rule for the yard crews.' },
    })
  })

  it('says the mail stays general when no activity is selected', () => {
    render(<WeatherPrecautions activityTypes={[]} value={{}} onChange={() => {}} />)
    expect(screen.getByText(/No activities selected yet/)).toBeTruthy()
  })

  it('clears an edit back to the built-in wording', () => {
    const onChange = vi.fn()
    render(
      <WeatherPrecautions
        activityTypes={['Fitness & Recreation']}
        value={{ 'Fitness & Recreation': { heat: 'Bring the class indoors.' } }}
        onChange={onChange}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Use built-in wording for Fitness & Recreation' })
    )
    expect(onChange).toHaveBeenCalledWith({})
  })
})
