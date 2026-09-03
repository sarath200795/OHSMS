import { describe, it, expect, vi, beforeEach } from 'vitest'

// Editing a test record must not delete the certificate attached to it.
//
// submitHpt and submitQuotation store a document ONE of two ways: small files
// inline as `fileData`, anything larger uploaded to Storage — which sets
// `fileData: null` and keeps a `fileUrl` and a `filePath`.
//
// Both modals rehydrated from `fileData` alone. So an UPLOADED document came
// back to the form as "no file attached", and saving again ran the replace
// path: removeFile(prev.filePath) then a write with an empty file reference.
// Correcting a typo in the vendor name destroyed the certificate a pressure
// vessel's compliance rests on, and nothing on screen said so — the chip that
// would have shown the document missing did not exist either.
//
// These pin the contract the fix introduced: `keepFile` means the form handed
// back the document it was given, so touch neither the stored object nor the
// fields pointing at it.

const batchUpdate = vi.fn()
const removeFile = vi.fn()
const putFile = vi.fn()
const getDocResult = { exists: () => true, data: () => ({}) }

vi.mock('../../../shared/firebase', () => ({ db: {} }))
vi.mock('../../../shared/monitoring', () => ({ reportError: vi.fn() }))
vi.mock('../../../shared/storage', () => ({
  putFile: (...a) => putFile(...a),
  removeFile: (...a) => removeFile(...a),
  MAX_INLINE_BYTES: 1024 * 1024,
  tooLargeForInline: () => 'too large',
}))
vi.mock('../../../shared/docId/reserve', () => ({ reserveDocId: vi.fn(async () => 'DOC-1') }))
vi.mock('../../../shared/org/orgData', () => ({ logAudit: vi.fn(), subscribeSites: vi.fn(), COLLECTION_READ_CAP: 5000 }))
vi.mock('../../../shared/crypto', () => ({
  sealDoc: vi.fn(async (o, f, d) => d),
  openDocs: vi.fn(async (o, f, d) => d),
  openSnapshots: vi.fn((o, f, cb) => cb),
}))
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  getDoc: vi.fn(async () => getDocResult),
  getDocs: vi.fn(async () => ({ docs: [] })),
  addDoc: vi.fn(async () => ({ id: 'r1' })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  serverTimestamp: () => 'ts',
  runTransaction: vi.fn(),
  writeBatch: () => ({ set: vi.fn(), update: (...a) => batchUpdate(...a), delete: vi.fn(), commit: vi.fn(async () => {}) }),
  increment: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  documentId: vi.fn(),
}))

const { submitHpt, submitQuotation } = await import('./firestore')

// A certificate that went to Storage: no inline bytes, a URL and a path.
const UPLOADED = {
  fileName: 'hpt-2026.pdf',
  fileType: 'application/pdf',
  fileData: null,
  fileUrl: 'https://storage/hpt-2026.pdf',
  filePath: 'orgA/hpt-certificates/hpt-2026.pdf',
}

/**
 * The object written to the extinguisher doc by the call under test.
 *
 * updateExtinguisher writes through a writeBatch, not updateDoc — reading the
 * wrong one is a test that passes for the wrong reason.
 */
const written = (key) => {
  const call = batchUpdate.mock.calls.find((c) => c[1] && key in c[1])
  return call?.[1]?.[key]
}

beforeEach(() => {
  vi.clearAllMocks()
  putFile.mockResolvedValue(null)
})

describe('re-recording an HPT keeps the certificate already on file', () => {
  beforeEach(() => {
    getDocResult.data = () => ({ hpt: { ...UPLOADED, testedOn: '2026-01-05', vendor: 'Acme NDT' } })
  })

  it('does not delete the stored object', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-01-05', result: 'pass', nextDueOn: '2031-01-05', vendor: 'Acme NDT Ltd', keepFile: true,
    }, 'Alex')
    expect(removeFile).not.toHaveBeenCalled()
  })

  it('carries every file field forward untouched', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-01-05', result: 'pass', nextDueOn: '2031-01-05', vendor: 'Acme NDT Ltd', keepFile: true,
    }, 'Alex')
    const hpt = written('hpt')
    expect(hpt.fileName).toBe(UPLOADED.fileName)
    expect(hpt.fileUrl).toBe(UPLOADED.fileUrl)
    expect(hpt.filePath).toBe(UPLOADED.filePath)
  })

  it('still saves the edit that prompted the re-record', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-01-05', result: 'pass', nextDueOn: '2031-01-05', vendor: 'Acme NDT Ltd', keepFile: true,
    }, 'Alex')
    expect(written('hpt').vendor).toBe('Acme NDT Ltd')
  })

  it('does not upload anything, because nothing new was picked', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-01-05', result: 'pass', nextDueOn: '2031-01-05', vendor: 'Acme NDT', keepFile: true,
    }, 'Alex')
    expect(putFile).not.toHaveBeenCalled()
  })
})

describe('replacing the certificate still replaces it', () => {
  beforeEach(() => {
    getDocResult.data = () => ({ hpt: { ...UPLOADED } })
  })

  // The other half of the contract: without keepFile the old object must go, or
  // it is orphaned in Storage with nothing left remembering its path.
  it('removes the previous stored object when new bytes arrive', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-02-01', result: 'pass', nextDueOn: '2031-02-01', vendor: 'Acme',
      fileName: 'new.pdf', fileType: 'application/pdf', fileData: 'data:application/pdf;base64,QQ==',
    }, 'Alex')
    expect(removeFile).toHaveBeenCalledWith(UPLOADED.filePath)
    expect(putFile).toHaveBeenCalled()
  })

  it('clears the certificate when the user removed it', async () => {
    await submitHpt('orgA', 'Acme', 'ext1', {
      testedOn: '2026-02-01', result: 'pass', nextDueOn: '2031-02-01', vendor: 'Acme',
    }, 'Alex')
    expect(removeFile).toHaveBeenCalledWith(UPLOADED.filePath)
    const hpt = written('hpt')
    expect(hpt.fileName).toBe('')
    expect(hpt.fileUrl).toBeNull()
    expect(hpt.filePath).toBeNull()
  })
})

// The quotation carried the identical defect, found while fixing the HPT one.
describe('re-submitting a quotation keeps its document', () => {
  const QUOTE_FILE = { ...UPLOADED, fileName: 'quote.pdf', filePath: 'orgA/quotations/quote.pdf' }

  beforeEach(() => {
    getDocResult.data = () => ({ quotation: { ...QUOTE_FILE, amount: 100, vendor: 'Vend' } })
  })

  it('keeps the file and applies the corrected amount', async () => {
    await submitQuotation('orgA', 'Acme', 'ext1', { amount: 250, vendor: 'Vend', keepFile: true }, 'Alex')
    expect(removeFile).not.toHaveBeenCalled()
    const q = written('quotation')
    expect(q.filePath).toBe(QUOTE_FILE.filePath)
    expect(q.amount).toBe(250)
  })
})
