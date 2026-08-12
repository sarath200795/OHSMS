import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsPDF's bundled saveAs is a no-op outside a real browser, so a test cannot
// observe the finished file through it. Swap only `save` on the instance: every
// draw, autoTable and addImage call still runs against the real library, and
// serialising here proves the document actually assembled.
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

const {
  generateProcedurePdf,
  generateRegisterPdf,
  generateActivityLogPdf,
  generateTagsPdf,
} = await import('./pdf')

// A 1x1 PNG. Stands in for an uploaded isolation photo so addImage runs for
// real — that call site is the one the jsPDF advisory actually reached.
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

beforeEach(() => {
  saved.length = 0
})

const procedure = {
  id: 'proc-1',
  orgName: 'Acme Manufacturing',
  equipment: 'Hydraulic Press #4',
  site: 'Plant 2 — Bay C',
  procedureCode: 'ACME-PLANT-2-HYDRAULIC-PRESS-4',
  revision: 3,
  createdAt: { seconds: 1700000000 },
  updatedAt: new Date('2026-01-15'),
  lockSummary: { status: 'partial' },
  isolationPoints: [
    {
      key: 'p1',
      energySource: 'electrical',
      rating: '480V 3PH',
      isolationDetails: 'Open disconnect DS-04 on the north wall.',
      hazard: 'Arc flash — PPE category 2 required.',
      verification: 'Test dead with a rated meter.',
      device: 'breaker_lockout',
      photo: PHOTO,
      lockState: {
        locked: true,
        lockType: 'personal',
        techLockNo: '112',
        techName: 'R. Osei',
        lockedAt: '2026-01-20T08:15:00.000Z',
      },
    },
    {
      key: 'p2',
      energySource: 'hydraulic',
      isolationDetails: 'Close valve HV-11 and bleed the accumulator.',
      verification: 'Gauge reads zero.',
      lockState: { locked: false, unlockedAt: '2026-01-20T16:40:00.000Z' },
    },
    {
      key: 'p3',
      energySource: 'electrical',
      isolationDetails: 'Isolate control transformer.',
      lockState: {},
    },
  ],
}

describe('LOTO posted procedure PDF', () => {
  it('generates a document with the isolation photo embedded', async () => {
    await generateProcedurePdf(procedure)
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('LOTO_ACME-PLANT-2-HYDRAULIC-PRESS-4_R3.pdf')
    expect(saved[0].bytes).toBeGreaterThan(2000)
  })

  it('accepts photos supplied separately from the points', async () => {
    const bare = {
      ...procedure,
      isolationPoints: procedure.isolationPoints.map((p) => ({ ...p, photo: null })),
    }
    await generateProcedurePdf(bare, { p1: PHOTO, p2: PHOTO })
    expect(saved).toHaveLength(1)
    expect(saved[0].bytes).toBeGreaterThan(2000)
  })

  it('still produces a document when a point has no photo or details', async () => {
    await generateProcedurePdf({ ...procedure, isolationPoints: [{ energySource: 'chemical' }] })
    expect(saved).toHaveLength(1)
  })

  it('survives a procedure with no isolation points', async () => {
    await generateProcedurePdf({ id: 'empty' })
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('LOTO_empty_R0.pdf')
  })
})

describe('LOTO register PDF', () => {
  it('renders one row per isolation point', () => {
    generateRegisterPdf([procedure])
    expect(saved).toHaveLength(1)
    expect(saved[0].bytes).toBeGreaterThan(1000)
  })

  it('renders the empty-state row when there are no procedures', () => {
    generateRegisterPdf([])
    expect(saved).toHaveLength(1)
  })
})

describe('LOTO activity log PDF', () => {
  it('renders lock and unlock events', () => {
    generateActivityLogPdf([
      {
        at: { seconds: 1700000000 },
        equipment: 'Hydraulic Press #4',
        site: 'Plant 2',
        pointId: 'E-1',
        energy: 'Electrical Energy',
        action: 'lock',
        byName: 'R. Osei',
      },
      { at: new Date('2026-01-20'), pointId: 'H-1', action: 'group_join', byName: 'T. Bello' },
      { at: null, pointId: 'E-1', action: 'unlock', byName: 'R. Osei' },
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0].bytes).toBeGreaterThan(1000)
  })

  it('renders the empty-state row when there is no activity', () => {
    generateActivityLogPdf([])
    expect(saved).toHaveLength(1)
  })
})

describe('LOTO tag sheet PDF', () => {
  it('lays out one tag per isolation point', async () => {
    await generateTagsPdf(procedure)
    expect(saved).toHaveLength(1)
    expect(saved[0].bytes).toBeGreaterThan(1000)
  })

  it('paginates when the points overflow the sheet', async () => {
    const many = {
      ...procedure,
      isolationPoints: Array.from({ length: 24 }, () => ({ energySource: 'mechanical' })),
    }
    await generateTagsPdf(many)
    expect(saved).toHaveLength(1)
  })
})
