import { describe, it, expect } from 'vitest'
import { answer, findClauseNumbers, findByKeywords, isoMap } from './brain'

const text = (parts) => parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ')
const modules = (parts) => parts.filter((p) => p.type === 'modules').flatMap((p) => p.modules.map((m) => m.path))

describe('findClauseNumbers', () => {
  it('detects clause numbers at all depths', () => {
    expect(findClauseNumbers('what is 8.2 about?')).toEqual(['8.2'])
    expect(findClauseNumbers('clause 6.1.2 please')).toEqual(['6.1.2'])
  })
  it('ignores numbers that are not clauses', () => {
    expect(findClauseNumbers('we have 42 sites and 3.9 issues')).toEqual([])
  })
})

describe('answer — clause questions', () => {
  it('answers 5.4 with the committee module', () => {
    const parts = answer('What is clause 5.4?')
    expect(text(parts)).toContain('Consultation and participation')
    expect(modules(parts)).toContain('/committee')
  })
  it('answers 8.2 with drills + equipment and live stats', () => {
    const parts = answer('8.2', { mockDrills: 3, extinguishers: 9 })
    expect(modules(parts)).toEqual(expect.arrayContaining(['/mock-drills', '/equipment']))
    expect(text(parts)).toContain('3 drill/emergency record(s)')
    expect(text(parts)).toContain('9 fire extinguisher(s)')
  })
})

describe('answer — keyword questions', () => {
  it('routes emergency drills to 8.2', () => {
    expect(findByKeywords('when is the next evacuation drill')[0].clause).toBe('8.2')
  })
  it('routes incident counts to 10.2 with live data', () => {
    const parts = answer('how many incidents do we have?', { incidents: 5, illnesses: 1 })
    expect(text(parts)).toContain('Clause 10.2')
    expect(text(parts)).toContain('5 incident report(s)')
    expect(modules(parts)).toContain('/incidents')
  })
  it('routes training competence to 7.2', () => {
    const parts = answer('how is our training compliance?', { trainingRecords: 12, trainingCourses: 3 })
    expect(text(parts)).toContain('Clause 7.2')
    expect(text(parts)).toContain('12 training record(s)')
  })
})

describe('answer — special commands & fallback', () => {
  it('returns the full map for "ISO map"', () => {
    const parts = answer('ISO map')
    expect(parts.some((p) => p.type === 'map')).toBe(true)
    expect(isoMap().length).toBeGreaterThan(20)
  })
  it('falls back helpfully on gibberish', () => {
    expect(text(answer('zzz qqq'))).toContain('ISO 45001 buddy')
  })
})
