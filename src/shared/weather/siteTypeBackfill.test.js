import { describe, expect, it } from 'vitest'
import { ENTITIES, LEGACY_ENTITIES } from '../../modules/fire/lib/constants'
import { LEGACY_ENTITY_LABELS, REGISTERED_ENTITY_NAMES } from './activityPrecautions'

// The equipment dropdown and the backfill have to name the same ownership
// codes. A code added to one list only would fill the wrong sites, or none.
describe('entity vocabulary', () => {
  it('matches the equipment module’s entity list and its legacy labels', () => {
    expect(REGISTERED_ENTITY_NAMES).toEqual([...ENTITIES])
    expect(LEGACY_ENTITY_LABELS).toEqual(LEGACY_ENTITIES)
  })
})
