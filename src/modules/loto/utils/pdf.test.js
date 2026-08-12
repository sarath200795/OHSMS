import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsPDF's bundled saveAs is a no-op outside a real browser, so a test cannot
// observe the finished file through it. Swap only `save` on the instance: every
// draw, autoTable and addImage call still runs against the real library, and
// serialising here proves the document actually assembled.
const saved = []

// What each QR actually encodes — the one thing about a printed tag that a byte
// count cannot tell you. A tag sheet with the wrong URL on every tag weighs
// exactly as much as a correct one, which is how tags that all opened the
// procedure instead of their own isolation point shipped past a green suite.
//
// The stub returns a real 1x1 PNG so addImage still runs against jsPDF. Inlined
// rather than shared with PHOTO below because vi.mock is hoisted and this
// factory runs during the import on line 28, before that const initialises.
const qrCalls = []

vi.mock('./qr', () => ({
  qrDataUrl: (value) => {
    qrCalls.push(value)
    return Promise.resolve(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    )
  },
}))

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
  qrCalls.length = 0
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

  // The tag is hung on one specific valve or breaker. Scanning it has to answer
  // "is THIS point still isolated", which only the live operation page knows —
  // so each tag carries its own code, not one procedure code copied across the
  // sheet. Every tag pointing at the procedure is precisely the bug this pins.
  it('gives every tag its own point code, not the procedure code', async () => {
    await generateTagsPdf(procedure)
    expect(qrCalls).toHaveLength(3)
    expect(qrCalls[0]).toContain('/t/proc-1/p1')
    expect(qrCalls[1]).toContain('/t/proc-1/p2')
    expect(qrCalls[2]).toContain('/t/proc-1/p3')
    expect(new Set(qrCalls).size).toBe(3)
  })

  it('never sends a tag to the procedure when the point can be identified', async () => {
    await generateTagsPdf(procedure)
    expect(qrCalls.some((u) => u.includes('/p/proc-1'))).toBe(false)
  })

  // A procedure written before points carried keys, and never revised since.
  // The procedure code is the old behaviour and still scans; /t/proc-1/undefined
  // would be a printed code that resolves to nothing.
  it('falls back to the procedure code for a point with no key', async () => {
    const legacy = {
      ...procedure,
      isolationPoints: [{ energySource: 'mechanical', isolationDetails: 'Chock the ram.' }],
    }
    await generateTagsPdf(legacy)
    expect(qrCalls).toEqual([expect.stringContaining('/p/proc-1')])
    expect(qrCalls[0]).not.toContain('undefined')
  })
})
