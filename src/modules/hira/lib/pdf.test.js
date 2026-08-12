import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsPDF's bundled saveAs is a no-op outside a real browser, so a test cannot
// observe the finished file through it. Swap only `save` on the instance: every
// draw and autoTable call still runs against the real library, and serialising
// here proves the document actually assembled.
const saved = []

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal()
  const Real = actual.jsPDF
  function Recording(...args) {
    const doc = new Real(...args)
    doc.save = (filename) => {
      saved.push({ filename, bytes: doc.output('arraybuffer').byteLength })
      return doc
    }
    return doc
  }
  return { ...actual, jsPDF: Recording, default: Recording }
})

const { exportAssessmentPdf } = await import('./pdf')

beforeEach(() => {
  saved.length = 0
})

const hazard = (over = {}) => ({
  hazardCategory: 'mechanical',
  hazardType: 'Entanglement',
  description: 'Unguarded drive shaft on the conveyor head pulley.',
  probability: 4,
  severity: 4,
  controls: [{ hierarchy: 'Engineering', description: 'Fixed mesh guard over the pulley.' }],
  additionalControls: [
    {
      hierarchy: 'Administrative',
      description: 'Add the guard check to the weekly inspection.',
      responsibleMemberId: 'm1',
      status: 'Planned',
      dueDate: '2026-03-01',
    },
  ],
  projectedProbability: 2,
  projectedSeverity: 3,
  ...over,
})

const assessment = {
  id: 'a1b2c3d4e5',
  name: 'Conveyor Line 3 — Routine Operation',
  status: 'ACTIVE',
  assessmentDate: '2026-02-10',
  siteName: 'Plant 2',
  location: 'Bay C',
  createdByName: 'A. Mensah',
  members: [
    { id: 'm1', name: 'A. Mensah', role: 'HSE Lead', type: 'internal' },
    { id: 'm2', name: 'K. Owusu', role: 'Maintenance', type: 'external' },
  ],
  activities: [
    {
      title: 'Belt tracking adjustment',
      nature: 'routine',
      hazards: [hazard(), hazard({ alarp: true, additionalControls: [] })],
    },
    { title: 'Blockage clearing', nature: 'non-routine', hazards: [hazard({ probability: 1, severity: 1 })] },
  ],
}

describe('HIRA assessment PDF', () => {
  it('generates a document for a populated assessment', () => {
    exportAssessmentPdf(assessment)
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('Conveyor_Line_3_Routine_Operation.pdf')
    expect(saved[0].bytes).toBeGreaterThan(2000)
  })

  it('renders the empty state when there are no activities', () => {
    exportAssessmentPdf({ ...assessment, activities: [] })
    expect(saved).toHaveLength(1)
  })

  it('renders an activity that has no hazards', () => {
    exportAssessmentPdf({ ...assessment, activities: [{ title: 'Idle', hazards: [] }] })
    expect(saved).toHaveLength(1)
  })

  it('tolerates an assessment with almost nothing on it', () => {
    exportAssessmentPdf({})
    expect(saved).toHaveLength(1)
  })

  it('paginates a long assessment without throwing', () => {
    const many = {
      ...assessment,
      activities: Array.from({ length: 12 }, (_, i) => ({
        title: `Activity ${i + 1}`,
        hazards: [hazard(), hazard(), hazard()],
      })),
    }
    exportAssessmentPdf(many)
    expect(saved).toHaveLength(1)
    expect(saved[0].bytes).toBeGreaterThan(5000)
  })

  it('accepts a caller-supplied generation timestamp', () => {
    exportAssessmentPdf(assessment, new Date('2026-02-11T00:00:00.000Z'))
    expect(saved).toHaveLength(1)
  })
})
