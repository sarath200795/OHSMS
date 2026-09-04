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
// The rule belongs on the WRITE paths, which is why these test the shape that
// reaches storage rather than reinterpreting it on the way out. residualRisk is
// unchanged on purpose — see the note beside it.

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

describe('residualRisk is unchanged, and that is the point', () => {
  it('prefers a projected score when one is stored', () => {
    expect(residualRisk({ probability: 4, severity: 4, projectedProbability: 1, projectedSeverity: 1 }).score).toBe(1)
  })

  it('falls back to initial when there is none', () => {
    const h = { probability: 4, severity: 4, alarp: true }
    expect(residualRisk(h)).toEqual(initialRisk(h))
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
