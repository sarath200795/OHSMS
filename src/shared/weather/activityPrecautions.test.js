import { describe, expect, it } from 'vitest'
import { ACTIVITY_TYPES } from '../org/orgConstants'
import {
  CATALOG,
  activityPickerOptions,
  builtInPrecaution,
  chooseActivities,
  precautionText,
} from './activityPrecautions'

describe('activity precautions', () => {
  it('covers every activity the org settings screen already offers', () => {
    for (const label of ACTIVITY_TYPES) {
      const entry = CATALOG.find((item) => item.label === label)
      expect(entry, label).toBeTruthy()
      expect(builtInPrecaution(label, 'heat').length).toBeGreaterThan(40)
      expect(builtInPrecaution(label, 'rain').length).toBeGreaterThan(40)
    }
  })

  it('offers the task-level work as well as the industry list', () => {
    const options = activityPickerOptions(['Night deliveries'])
    expect(options).toEqual(
      expect.arrayContaining([
        'Construction',
        'Hot work',
        'Kitchens',
        'Indoor gym',
        'Indoor pool',
        'Indoor court',
        'Warehouse',
        'Night deliveries',
      ])
    )
    expect(new Set(options).size).toBe(options.length)
  })

  it('keeps a construction sentence and a fitness sentence apart', () => {
    const construction = precautionText(
      'heat',
      chooseActivities({ orgActivityTypes: ['Construction'] })
    )
    const fitness = precautionText(
      'heat',
      chooseActivities({ orgActivityTypes: ['Fitness & Recreation'] })
    )
    expect(construction).toMatch(/at-height/)
    expect(fitness).toMatch(/hydration/i)
    expect(fitness).not.toMatch(/outdoor class/i)
    expect(construction).not.toBe(fitness)
  })
})
