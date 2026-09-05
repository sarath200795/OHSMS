// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { residualRisk, initialRisk } from './raStats'
import { parseCsv, CSV_COLUMNS } from './csv'

// ALARP is a decision to live with a risk as it stands: no further controls are
// planned, so there is nothing to project.
//
// CreateAssessment's own comment has always said additional controls and the
// projected score are dropped when it is set, and no branch ever did it. So an
// ALARP hazard kept its projected P×S — and residualRisk prefers projected over
// initial — meaning the register showed a LOWER residual for exactly the
// hazards somebody had decided to accept. lib/csv.js dropped them all along, so
// the same decision produced different data depending on how it arrived.
//
// The rule is enforced on BOTH sides. The write paths stop storing a projected
// score for an ALARP hazard; residualRisk stops preferring one that is already
// stored, because closing the write path closes nothing already written and
// those assessments exist.
//
// The stored records are deliberately not rewritten — reading them correctly
// costs nothing and changes no history, where a migration would alter what a
// risk register says about a hazard somebody signed off.

const toCsv = (rows) =>
  [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => r[c] ?? '').join(','))].join('\n')
const file = (rows) => new File([toCsv(rows)], 'hira.csv', { type: 'text/csv' })

const base = {
  'Assessment Name': 'Welding bay',
  Activity: 'Welding',
  'Hazard Type': 'Arc flash',
  Probability: 4,
  Severity: 4,
  Region: 'North',
  Entity: 'Acme',
  Site: 'HYD8',
  Members: 'Jane Doe',
  'Additional Control Description': 'Fit screens',
  'Additional Control Hierarchy': 'Engineering Control',
}

const hazardOf = async (row) => {
  const { assessments, errors } = await parseCsv(file([row]))
  if (errors.length) throw new Error(JSON.stringify(errors))
  return assessments[0].activities[0].hazards[0]
}

describe('residualRisk reports what an ALARP hazard actually carries', () => {
  it('prefers a projected score on an ordinary hazard', () => {
    expect(residualRisk({ probability: 4, severity: 4, projectedProbability: 1, projectedSeverity: 1 }).score).toBe(1)
  })

  it('IGNORES a projected score on an ALARP hazard', () => {
    // The defect, on the read side: a hazard nobody is going to control further
    // was reported at the reduced score anyway — understating exactly the risks
    // somebody had decided to live with.
    const h = { probability: 4, severity: 4, alarp: true, projectedProbability: 1, projectedSeverity: 1 }
    expect(residualRisk(h).score).toBe(16)
    expect(residualRisk(h)).toEqual(initialRisk(h))
  })

  it('does so for records saved before the write paths were fixed', () => {
    // These are the only hazards that can still be in this state, and they are
    // the whole reason this reads on the way out as well as the way in.
    const stored = { probability: 3, severity: 5, alarp: true, projectedProbability: 1, projectedSeverity: 2 }
    expect(residualRisk(stored)).toEqual(initialRisk(stored))
  })

  it('falls back to initial for an ALARP hazard with no projection at all', () => {
    const h = { probability: 4, severity: 4, alarp: true }
    expect(residualRisk(h)).toEqual(initialRisk(h))
  })

  it('leaves an ordinary hazard with no projection on its initial score', () => {
    expect(residualRisk({ probability: 2, severity: 3 }).score).toBe(6)
  })

  it('treats alarp: false exactly as an ordinary hazard', () => {
    // That is what the form writes when the box is unticked, so it must not be
    // read as "flagged".
    const h = { probability: 4, severity: 4, alarp: false, projectedProbability: 1, projectedSeverity: 1 }
    expect(residualRisk(h).score).toBe(1)
  })
})

describe('the CSV importer drops what ALARP makes meaningless', () => {
  it('keeps an additional control when the hazard is not ALARP', async () => {
    const h = await hazardOf({ ...base, ALARP: 'No' })
    expect(h.additionalControls).toHaveLength(1)
  })

  it('drops it when the hazard IS ALARP', async () => {
    const h = await hazardOf({ ...base, ALARP: 'Yes' })
    expect(h.alarp).toBe(true)
    expect(h.additionalControls).toHaveLength(0)
  })

  it('leaves the hazard scoring on its initial values either way', async () => {
    const h = await hazardOf({ ...base, ALARP: 'Yes' })
    expect(h.probability).toBe(4)
    expect(h.severity).toBe(4)
  })
})
