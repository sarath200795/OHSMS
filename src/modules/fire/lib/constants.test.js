import { describe, it, expect } from 'vitest'
import { ENTITIES, ENTITY_COLORS, LEGACY_ENTITIES, normalizeEntity, REGIONS, REGION_COLORS, TYPES, TYPE_COLORS } from './constants'

// The "By Entity" chart colours its bars by looking each entity up in
// ENTITY_COLORS. When the entity vocabulary moved from 1P/2P/3P to the site
// registry's COCO/FOCO/FOFO/... the palette was left behind, so five of seven
// bars fell through to an undefined fill and rendered in Recharts' default
// colour — the chart stopped segregating anything. These tests pin the palette
// to the vocabulary so the two cannot drift apart again.
describe('chart palettes cover their vocabularies', () => {
  it('gives every entity its own colour', () => {
    for (const en of ENTITIES) expect(ENTITY_COLORS[en], `no colour for entity ${en}`).toBeTruthy()
  })

  it('never reuses a colour between two entities', () => {
    const used = ENTITIES.map((en) => ENTITY_COLORS[en])
    expect(new Set(used).size).toBe(ENTITIES.length)
  })

  it('colours legacy entity labels as whatever they normalise to', () => {
    for (const [legacy, current] of Object.entries(LEGACY_ENTITIES)) {
      expect(normalizeEntity(legacy)).toBe(current)
      expect(ENTITY_COLORS[legacy], `no colour for legacy label ${legacy}`).toBe(ENTITY_COLORS[current])
    }
  })

  it('covers regions and types too', () => {
    for (const rg of REGIONS) expect(REGION_COLORS[rg], `no colour for region ${rg}`).toBeTruthy()
    for (const t of TYPES) expect(TYPE_COLORS[t], `no colour for type ${t}`).toBeTruthy()
  })
})
