import { describe, it, expect } from 'vitest'
import {
  REGISTERS, nameKey, nameVariants, registerGapSummary, siteRegisters,
} from './siteRegisters'

const at = (...names) => names.map((centerName) => ({ centerName }))

describe('siteRegisters', () => {
  // The 116-vs-104 question, in miniature: three sites across the registers,
  // two of them on the extinguisher register.
  it('counts each register separately and the union across them', () => {
    const r = siteRegisters({
      extinguishers: at('Alpha', 'Beta'),
      signages: at('Alpha', 'Beta', 'Gamma'),
    })
    expect(r.totals.any).toBe(3)
    expect(r.totals.ext).toBe(2)
    expect(r.totals.signage).toBe(3)
  })

  it('names the sites a register has never heard of', () => {
    const r = siteRegisters({
      extinguishers: at('Alpha'),
      aeds: at('Gamma'),
      signages: at('Alpha', 'Beta'),
    })
    expect(r.missing.ext).toEqual(['Beta', 'Gamma'])
    expect(r.missing.aed).toEqual(['Alpha', 'Beta'])
  })

  it('records which registers each site appears in', () => {
    const r = siteRegisters({ extinguishers: at('Alpha'), mockDrills: at('Alpha') })
    const alpha = r.rows.find((x) => x.site === 'Alpha')
    expect(alpha).toMatchObject({ ext: true, drill: true, signage: false, aed: false, fas: false })
  })

  it('sorts sites by name, because the list is worked through by hand', () => {
    const r = siteRegisters({ signages: at('Zulu', 'Alpha', 'Mike') })
    expect(r.rows.map((x) => x.site)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  // A record with no centre name belongs to no site; counting it as one would
  // invent a site called "".
  it('ignores records carrying no centre name', () => {
    const r = siteRegisters({
      extinguishers: [{ centerName: '' }, { centerName: '   ' }, {}, null, { centerName: 'Alpha' }],
    })
    expect(r.totals.any).toBe(1)
    expect(r.totals.ext).toBe(1)
  })

  it('trims, so trailing whitespace does not invent a second site', () => {
    const r = siteRegisters({ extinguishers: at('Alpha '), signages: at(' Alpha') })
    expect(r.totals.any).toBe(1)
    expect(r.rows[0]).toMatchObject({ site: 'Alpha', ext: true, signage: true })
  })

  it('is empty, not broken, with nothing to read', () => {
    const r = siteRegisters()
    expect(r.rows).toEqual([])
    expect(r.totals.any).toBe(0)
    expect(r.variants).toEqual([])
    for (const reg of REGISTERS) expect(r.missing[reg.key]).toEqual([])
  })
})

// The phantom case, and the one that actually costs something: a second copy of
// a real site sits in the signage denominator at 0 % forever, so it understates
// compliance rather than merely miscounting sites.
describe('nameVariants', () => {
  it('groups names differing only by case, punctuation or spacing', () => {
    const r = siteRegisters({
      extinguishers: at('Kochi Hub'),
      signages: at('Kochi HUB', 'kochi-hub'),
    })
    expect(r.variants).toHaveLength(1)
    // Compared as a set: the group is sorted with localeCompare, whose ordering
    // of two spellings that differ only in case is an ICU detail, not a
    // promise this makes. Asserting it would make the test fail on a machine
    // with a different collation while the diagnostic worked perfectly.
    expect([...r.variants[0].names].sort()).toEqual(['Kochi HUB', 'Kochi Hub', 'kochi-hub'].sort())
    expect(r.variants[0].registers).toEqual(['ext', 'signage'])
  })

  // A diagnostic that cries wolf gets switched off, so the match is exact after
  // normalising and never fuzzy.
  it('does not pair two sites that merely look similar', () => {
    const r = siteRegisters({ extinguishers: at('Depot 1', 'Depot 2', 'Depot 3') })
    expect(r.variants).toEqual([])
  })

  it('says nothing when every name is already consistent', () => {
    const r = siteRegisters({ extinguishers: at('Alpha', 'Beta'), signages: at('Alpha', 'Beta') })
    expect(r.variants).toEqual([])
  })

  it('reports several groups, first name first', () => {
    const r = siteRegisters({
      extinguishers: at('Zulu Base', 'Alpha Hub'),
      signages: at('zulu base', 'ALPHA HUB'),
    })
    // By normalised key, for the same reason: which spelling leads a group is
    // collation-dependent, but which GROUPS exist is the actual finding.
    expect(r.variants.map((v) => v.key)).toEqual(['alphahub', 'zulubase'])
    expect(r.variants).toHaveLength(2)
    expect(r.variants.every((v) => v.names.length === 2)).toBe(true)
  })

  it('normalises to letters and digits only', () => {
    expect(nameKey('  Kochi–Hub (Main) ')).toBe(nameKey('kochi hub main'))
    expect(nameKey('')).toBe('')
    expect(nameKey(null)).toBe('')
  })

  it('never groups names that normalise to nothing', () => {
    expect(nameVariants([{ site: '---' }, { site: '///' }])).toEqual([])
  })
})

describe('registerGapSummary', () => {
  it('says why the two counts differ', () => {
    const r = siteRegisters({ extinguishers: at('Alpha'), signages: at('Alpha', 'Beta', 'Gamma') })
    expect(registerGapSummary(r, 'ext'))
      .toBe('3 sites appear across the five registers; 1 are on the extinguishers register. The other 2 are named somewhere else and not there.')
  })

  // Silent while there is nothing to explain, so the caller can render it
  // unconditionally.
  it('says nothing when a register knows every site', () => {
    const r = siteRegisters({ extinguishers: at('Alpha'), signages: at('Alpha') })
    expect(registerGapSummary(r, 'ext')).toBe('')
    expect(registerGapSummary(null, 'ext')).toBe('')
    expect(registerGapSummary(r, 'nonsense')).toBe('')
  })
})
