import { describe, it, expect, vi, beforeEach } from 'vitest'

const saved = []
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal()
  const Real = actual.jsPDF
  function Recording(...args) {
    const doc = new Real(...args)
    doc.save = (filename) => {
      saved.push({ filename, bytes: doc.output('arraybuffer').byteLength, pages: doc.getNumberOfPages() })
      return doc
    }
    return doc
  }
  return { ...actual, jsPDF: Recording, default: Recording }
})

const {
  buildQrLabels,
  buildQrLabelPdf,
  exportQrLabelPdf,
  qrLabelFilename,
  LABELS_PER_PAGE,
} = await import('./qrLabelSheet')

beforeEach(() => {
  saved.length = 0
})

const panel = (n, over = {}) => ({
  id: `f${n}`,
  qrToken: `tokfas${n}`,
  deviceId: `FAS-${String(n).padStart(4, '0')}`,
  deviceType: 'Control Panel',
  zone: 'Zone 1',
  centerName: 'Plant 2',
  location: 'Main gate',
  ...over,
})
const aed = (n, over = {}) => ({
  id: `a${n}`,
  qrToken: `tokaed${n}`,
  assetId: `AED-${String(n).padStart(4, '0')}`,
  brand: 'Philips',
  model: 'HS1',
  centerName: 'HQ',
  location: 'Reception',
  ...over,
})

describe('buildQrLabels', () => {
  it('encodes the public /qr/:token landing URL and carries id, site and location', () => {
    const { labels, skipped } = buildQrLabels('fas', [panel(1)])
    expect(skipped).toEqual([])
    expect(labels).toHaveLength(1)
    expect(labels[0].url).toMatch(/\/qr\/tokfas1$/)
    expect(labels[0]).toMatchObject({
      title: 'FAS-0001',
      site: 'Plant 2',
      location: 'Main gate',
      detail: 'Control Panel · Zone 1',
    })
  })

  it('labels AEDs by asset id with brand and model', () => {
    const { labels } = buildQrLabels('aed', [aed(7)])
    expect(labels[0]).toMatchObject({ title: 'AED-0007', detail: 'Philips HS1', site: 'HQ', location: 'Reception' })
    expect(labels[0].url).toMatch(/\/qr\/tokaed7$/)
  })

  it('leaves out rows with no QR token instead of inventing a code', () => {
    const rows = [panel(1), panel(2, { qrToken: '', deviceType: 'Smoke Detector' }), panel(3, { qrToken: undefined })]
    const { labels, skipped } = buildQrLabels('fas', rows)
    expect(labels.map((l) => l.id)).toEqual(['f1'])
    expect(skipped.map((s) => s.id)).toEqual(['f2', 'f3'])
  })

  it('falls back to the type when a panel has no device id', () => {
    const { labels } = buildQrLabels('fas', [panel(1, { deviceId: '' })])
    expect(labels[0].title).toBe('Control Panel')
  })

  it('rejects an unknown kind', () => {
    expect(() => buildQrLabels('ext', [])).toThrow(/Unknown/)
  })
})

describe('qrLabelFilename', () => {
  it('is dated and per-kind', () => {
    const d = new Date('2026-09-30T05:00:00Z')
    expect(qrLabelFilename('fas', d)).toBe('fire-marshal-fas-qr-labels-2026-09-30.pdf')
    expect(qrLabelFilename('aed', d)).toBe('fire-marshal-aed-qr-labels-2026-09-30.pdf')
  })
})

describe('buildQrLabelPdf', () => {
  it('paginates and reports progress per slice for a large set', async () => {
    const rows = Array.from({ length: LABELS_PER_PAGE * 2 + 3 }, (_, i) => aed(i + 1))
    const { labels } = buildQrLabels('aed', rows)
    const calls = []
    const doc = await buildQrLabelPdf(labels, { chunkSize: 10, onProgress: (d, t) => calls.push([d, t]) })
    expect(doc.getNumberOfPages()).toBe(3)
    expect(calls.length).toBe(Math.ceil(labels.length / 10))
    expect(calls[calls.length - 1]).toEqual([labels.length, labels.length])
    expect(calls.map((c) => c[0])).toEqual([...calls.map((c) => c[0])].sort((a, b) => a - b))
  })
})

describe('exportQrLabelPdf', () => {
  it('saves a PDF containing only the rows that have a QR code', async () => {
    const res = await exportQrLabelPdf('fas', [panel(1), panel(2, { qrToken: '' }), panel(3)])
    expect(res).toEqual({ exported: 2, skipped: 1 })
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toMatch(/^fire-marshal-fas-qr-labels-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(saved[0].pages).toBe(1)
    expect(saved[0].bytes).toBeGreaterThan(1000)
  })

  it('saves nothing when no row has a QR code', async () => {
    const res = await exportQrLabelPdf('aed', [aed(1, { qrToken: '' })])
    expect(res).toEqual({ exported: 0, skipped: 1 })
    expect(saved).toHaveLength(0)
  })
})
