import { describe, it, expect, beforeEach, vi } from 'vitest'

// jsPDF's saveAs does nothing outside a browser, so swap only `save`: every
// draw and autoTable call still runs for real and serialising proves the
// document assembled. The text and QR payloads are recorded to check what the
// printout says rather than how many bytes it weighs.
const saved = []
const texts = []
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
    const text = doc.text.bind(doc)
    doc.text = (...a) => {
      texts.push(...(Array.isArray(a[0]) ? a[0] : [a[0]]).map(String))
      return text(...a)
    }
    doc.save = (filename) => {
      saved.push({
        filename,
        bytes: doc.output('arraybuffer').byteLength,
        pages: doc.getNumberOfPages(),
      })
      return doc
    }
    return doc
  }
  return { ...actual, jsPDF: Recording, default: Recording }
})

const { generatePermitPdf, permitPdfName, permitScanUrl } = await import('./permitPdf')

const NOW = Date.UTC(2026, 9, 5, 10, 0)
const permit = {
  id: 'LP-2026-0042',
  permitNo: 'LP-2026-0042',
  status: 'returned',
  workType: 'electrical_work',
  reason: 'Replace the contactor',
  equipment: 'Press 4',
  site: 'Plant 2',
  procedureCode: 'ACME-PRESS-4',
  procedureRevision: 1,
  windowStart: NOW,
  windowEnd: NOW + 8 * 3600 * 1000,
  requestedByName: 'Asha Rao',
  approval: { byName: 'Kiran Admin', at: NOW },
  internalPersonnel: [{ uid: 'u2', name: 'Dev Patel' }],
  vendorWorkers: [{ name: 'Tom Hill', company: 'Hydro Co' }],
  isolationPoints: [{ key: 'a', pointId: 'E-1', energySource: 'electrical', devices: [] }],
  locks: [{ pointKey: 'a', lockNo: '112', lockType: 'personal' }],
  isolation: { at: NOW, scans: { a: { at: NOW, method: 'camera' } } },
  returnChecks: {
    toolsRemoved: true,
    guardsReplaced: true,
    personnelClear: true,
    affectedNotified: true,
  },
  closure: { byName: 'Kiran Admin' },
  closedAt: NOW + 3600 * 1000,
  extensions: [
    { at: NOW, byName: 'Kiran Admin', from: NOW, to: NOW + 1, reason: 'Seal on back-order' },
  ],
}

beforeEach(() => {
  saved.length = 0
  texts.length = 0
  qrCalls.length = 0
})

describe('LOTO permit PDF', () => {
  it('produces a named document', async () => {
    await generatePermitPdf(permit, { orgName: 'Acme' })
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('LOTO_Permit_LP-2026-0042.pdf')
    expect(saved[0].bytes).toBeGreaterThan(2000)
  })

  it('cites OSHA 1910.147 in the header and the declaration', async () => {
    await generatePermitPdf(permit)
    expect(texts).toContain('OSHA 29 CFR 1910.147')
    expect(texts.join(' ')).toMatch(/OSHA 29 CFR 1910\.147 — The control of hazardous energy/)
  })

  it('encodes the link to the permit in its QR, not a copy of its contents', async () => {
    await generatePermitPdf(permit)
    expect(qrCalls).toEqual([permitScanUrl('LP-2026-0042')])
    expect(qrCalls[0]).toMatch(/\/loto\/permits\/LP-2026-0042$/)
  })

  it('prints the permit number and the people on the job', async () => {
    await generatePermitPdf(permit)
    const all = texts.join('\n')
    expect(all).toContain('LP-2026-0042')
    expect(all).toContain('Asha Rao')
    expect(all).toContain('Kiran Admin')
  })

  it('handles a permit that was never started, with no points', async () => {
    await generatePermitPdf({ id: 'LP-2026-0001', status: 'requested', workType: 'other' })
    expect(saved).toHaveLength(1)
  })

  it('prints an emergency removal', async () => {
    await generatePermitPdf({
      ...permit,
      status: 'emergency_removed',
      returnChecks: undefined,
      emergency: {
        byName: 'Kiran Admin',
        at: NOW,
        reason: 'Owner unreachable overnight',
        attest: { ownerUnavailable: true, equipmentInspected: true, ownerWillBeTold: true },
      },
    })
    expect(saved).toHaveLength(1)
  })

  it('names the file even without a number', () => {
    expect(permitPdfName('')).toBe('LOTO_Permit_permit.pdf')
  })
})
