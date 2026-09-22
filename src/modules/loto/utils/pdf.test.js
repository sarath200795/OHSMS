import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsPDF's bundled saveAs is a no-op outside a real browser, so a test cannot
// observe the finished file through it. Swap only `save` on the instance: every
// draw, autoTable and addImage call still runs against the real library, and
// serialising here proves the document actually assembled.
const saved = []
// Every image and stroked rect, so a QR that lost its frame fails here
// instead of only in a printout. Photos go through addImage too; the frame
// assertion matches a stroke that hugs one specific image.
const draws = []

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
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    )
  },
}))

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal()
  const Real = actual.jsPDF
  function Recording(...args) {
    const doc = new Real(...args)
    const addImage = doc.addImage.bind(doc)
    const rect = doc.rect.bind(doc)
    const text = doc.text.bind(doc)
    doc.addImage = (...a) => {
      draws.push({ op: 'image', args: a })
      return addImage(...a)
    }
    doc.rect = (...a) => {
      draws.push({
        op: 'rect',
        args: a,
        lineWidth: doc.getLineWidth(),
        page: doc.getCurrentPageInfo().pageNumber,
      })
      return rect(...a)
    }
    doc.text = (...a) => {
      const raw = a[0]
      const x = Number(a[1])
      const y = Number(a[2])
      const lines = Array.isArray(raw) ? raw.map(String) : [String(raw)]
      const scale = doc.internal.scaleFactor || 1
      const fontSize = doc.getFontSize() / scale
      const lineH = doc.getLineHeight() / scale
      const page = doc.getCurrentPageInfo().pageNumber
      lines.forEach((line, i) => {
        draws.push({
          op: 'text',
          text: line,
          x,
          y: y + i * lineH,
          width: doc.getTextWidth(line),
          fontSize,
          page,
        })
      })
      return text(...a)
    }
    doc.save = (filename) => {
      saved.push({ filename, bytes: doc.output('arraybuffer').byteLength })
      return doc
    }
    return doc
  }
  return { ...actual, jsPDF: Recording, default: Recording }
})

const { generateProcedurePdf, generateRegisterPdf, generateActivityLogPdf, generateTagsPdf } =
  await import('./pdf')

// A 1x1 PNG. Stands in for an uploaded isolation photo so addImage runs for
// real — that call site is the one the jsPDF advisory actually reached.
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

beforeEach(() => {
  saved.length = 0
  qrCalls.length = 0
  draws.length = 0
})

// A frame is a stroked rect whose path sits just outside one QR image. An
// inset rect would cover the quiet zone; a page-sized rule is not a frame.
function framesAround(size) {
  const images = draws.filter(
    (d) => d.op === 'image' && d.args[1] === 'PNG' && d.args[4] === size && d.args[5] === size
  )
  return images.map((image) => {
    const ix = image.args[2]
    const iy = image.args[3]
    const iw = image.args[4]
    const ih = image.args[5]
    const frame = draws.find((d) => {
      if (d.op !== 'rect' || d.args[4] !== 'S') return false
      const [x, y, w, h] = d.args
      const covers =
        x <= ix + 0.01 && y <= iy + 0.01 && x + w >= ix + iw - 0.01 && y + h >= iy + ih - 0.01
      return covers && w < iw + 4 && h < ih + 4
    })
    return { image, frame, ix, iy, iw, ih }
  })
}

// A line whose box crosses the frame (or the gutter beside it) is the overlap
// the procedure code had: one unbreakable token drawn through the modules.
function textCrowdingFrame(frame, gutter) {
  const [fx, fy, fw, fh] = frame.args
  return draws.filter((t) => {
    if (t.op !== 'text') return false
    const top = t.y - t.fontSize * 0.9
    const bottom = t.y + t.fontSize * 0.25
    if (t.page !== frame.page) return false
    const vertical = bottom > fy && top < fy + fh
    if (!vertical) return false
    const left = t.x
    const right = t.x + t.width
    return right > fx - gutter && left < fx + fw + gutter
  })
}

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

  // The posted procedure used to drop the QR on the page with no rule. A
  // kraft hairline is what the tables use, and it does not show on paper.
  it('strokes a solid frame around the header QR, outside the quiet zone', async () => {
    await generateProcedurePdf(procedure)
    const framed = framesAround(54)
    expect(framed).toHaveLength(1)
    const { frame, ix, iy, iw } = framed[0]
    expect(frame).toBeTruthy()
    expect(frame.lineWidth).toBeGreaterThanOrEqual(1)
    expect(ix - frame.args[0]).toBeGreaterThan(0.2)
    expect(iy - frame.args[1]).toBeGreaterThan(0.2)
    expect(frame.args[2]).toBeCloseTo(iw + frame.lineWidth, 2)
  })

  // "ACME-PLANT-2-HYDRAULIC-PRESS-4" has no spaces. maxWidth that still
  // reached the QR drew it as one line through the frame.
  it('wraps the procedure code clear of the header QR', async () => {
    await generateProcedurePdf(procedure)
    const framed = framesAround(54)
    expect(framed).toHaveLength(1)
    const crowding = textCrowdingFrame(framed[0].frame, 4)
    expect(crowding.map((t) => t.text)).toEqual([])
    const header = draws.filter((t) => t.op === 'text' && t.page === 1 && t.y < 160)
    expect(header.some((t) => t.text === procedure.procedureCode)).toBe(false)
    expect(header.some((t) => String(t.text).includes('ACME-PLANT'))).toBe(true)
    expect(header.some((t) => String(t.text).includes('PRESS-4'))).toBe(true)
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
  it('strokes a solid frame around every tag QR, outside the quiet zone', async () => {
    await generateTagsPdf(procedure)
    const framed = framesAround(22)
    expect(framed).toHaveLength(3)
    for (const { frame, ix, iy, iw } of framed) {
      expect(frame).toBeTruthy()
      expect(frame.lineWidth).toBeGreaterThanOrEqual(0.4)
      expect(ix - frame.args[0]).toBeGreaterThan(0.2)
      expect(iy - frame.args[1]).toBeGreaterThan(0.2)
      expect(frame.args[2]).toBeCloseTo(iw + frame.lineWidth, 2)
    }
  })

  it('keeps the procedure code and hardware out of each tag QR', async () => {
    await generateTagsPdf(procedure)
    const framed = framesAround(22)
    expect(framed).toHaveLength(3)
    for (const { frame } of framed) {
      expect(textCrowdingFrame(frame, 1).map((t) => t.text)).toEqual([])
    }
    const codes = draws.filter((t) => t.op === 'text' && String(t.text).includes('ACME-PLANT'))
    expect(codes.length).toBeGreaterThan(0)
  })

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
