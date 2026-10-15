import { describe, it, expect } from 'vitest'
import {
  validateClosure,
  closureFields,
  extinguisherCloseUpdate,
  assetClosureDoc,
  hptSuppressed,
  cleanClosurePhoto,
} from './defectClosure'

describe('validateClosure', () => {
  it('requires remarks and a closed date that is not in the future', () => {
    expect(validateClosure({ remarks: '  ', closedOn: '2026-10-15' })).toMatch(/remarks/)
    expect(validateClosure({ remarks: 'Recharged', closedOn: '' })).toMatch(/date/)
    expect(validateClosure({ remarks: 'Recharged', closedOn: '2099-01-01' })).toMatch(/future/)
    expect(validateClosure({ remarks: 'Recharged', closedOn: '2026-10-15' })).toBe('')
  })
})

describe('extinguisherCloseUpdate', () => {
  const ext = { dateOfNextHPT: '2020-06-01', physicalDefects: ['empty', 'pin'] }

  it('suppresses HPT against the due date and does not move that date', () => {
    expect(extinguisherCloseUpdate(ext, 'hpt_due')).toEqual({ hptClosedFor: '2020-06-01' })
    expect(hptSuppressed({ ...ext, hptClosedFor: '2020-06-01' })).toBe(true)
  })

  it('removes one defect and leaves the others', () => {
    expect(extinguisherCloseUpdate(ext, 'empty').physicalDefects).toEqual(['pin'])
    expect(extinguisherCloseUpdate(ext, 'pin').physicalDefects).toEqual(['empty'])
  })
})

describe('closure documents', () => {
  it('attributes the close to the signed-in person and keeps a photo pointer', () => {
    const fields = closureFields({
      remarks: ' Pads replaced ',
      closedOn: '2026-10-01',
      closedBy: 'Ravi',
      closedByUid: 'u1',
      source: 'manual',
      photo: {
        url: 'https://example.test/a.jpg',
        path: 'orgs/o/defect-evidence/a.jpg',
        extra: 'no',
      },
    })
    expect(fields.remarks).toBe('Pads replaced')
    expect(fields.photo).toEqual({
      url: 'https://example.test/a.jpg',
      path: 'orgs/o/defect-evidence/a.jpg',
    })
    expect(cleanClosurePhoto(null)).toBeNull()

    expect(
      assetClosureDoc(
        {
          assetKind: 'fas',
          reportId: 'r9',
          assetRefId: 'f1',
          defectLabel: 'Fault light',
          centerName: 'Depot',
        },
        fields
      )
    ).toMatchObject({
      kind: 'fas',
      defectKey: 'r9',
      assetRefId: 'f1',
      reportId: 'r9',
      defectLabel: 'Fault light',
      centerName: 'Depot',
      closedBy: 'Ravi',
    })
  })
})
