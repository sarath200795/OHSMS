import { describe, it, expect } from 'vitest'
import {
  isRetired,
  daysRemaining,
  canManageAsset,
  restoreConflicts,
  restoreBlockMessage,
  holdRetiredImports,
  adoptionBlock,
  retiredQrCopy,
  PURGE_AFTER_DAYS,
} from './recycle'

const mgr = (access, siteId) => ({ role: 'manager', access, siteId })
const unit = (over = {}) => ({
  id: 'e1',
  serialNo: 'FE-0001',
  qrToken: 'tok',
  siteId: 's1',
  region: 'South',
  entity: 'COCO',
  ...over,
})

describe('a record without the new fields is still active', () => {
  it('treats a missing deletedAt, and an explicit null, as in service', () => {
    expect(isRetired({})).toBe(false)
    expect(isRetired({ deletedAt: null })).toBe(false)
    expect(isRetired({ deletedAt: undefined })).toBe(false)
    expect(isRetired(null)).toBe(false)
    expect(isRetired({ deletedAt: '2026-01-01' })).toBe(true)
  })
})

describe('the 30-day countdown', () => {
  const now = new Date('2026-09-27T12:00:00Z')

  it('gives a full window when the timestamp cannot be read', () => {
    expect(daysRemaining(null, now)).toBe(PURGE_AFTER_DAYS)
    expect(daysRemaining('not-a-date', now)).toBe(PURGE_AFTER_DAYS)
  })

  it('counts down and stops at zero', () => {
    expect(daysRemaining(new Date('2026-09-27T08:00:00Z'), now)).toBe(30)
    expect(daysRemaining(new Date('2026-09-17T12:00:00Z'), now)).toBe(20)
    expect(daysRemaining(new Date('2026-08-01T12:00:00Z'), now)).toBe(0)
  })
})

describe('who may delete and restore', () => {
  const flags = { isManager: true }

  it('lets an org admin reach a unit with no site at all', () => {
    expect(canManageAsset({ role: 'admin' }, { id: 'e' }, { isAdmin: true })).toBe(true)
  })

  it('lets a manager reach their site, their region, or their entity', () => {
    expect(canManageAsset(mgr({ sites: ['s1'] }), unit(), flags)).toBe(true)
    expect(canManageAsset(mgr({ regions: ['South'] }), unit({ siteId: 'other' }), flags)).toBe(true)
    expect(
      canManageAsset(mgr({ entities: ['COCO'] }), unit({ siteId: '', region: '' }), flags)
    ).toBe(true)
    expect(canManageAsset(mgr({ sites: [] }, 's1'), unit(), flags)).toBe(true)
  })

  it('refuses a manager outside the unit, a member, and an empty grant on unscoped stock', () => {
    expect(canManageAsset(mgr({ sites: ['s9'], regions: ['North'] }), unit(), flags)).toBe(false)
    expect(canManageAsset(mgr({}), unit({ siteId: '', region: '', entity: '' }), flags)).toBe(false)
    expect(
      canManageAsset({ role: 'member', access: { sites: ['s1'] } }, unit(), { isManager: false })
    ).toBe(false)
    // The equipment module maps manager → admin on profile.role. That must not
    // widen this check: isAdmin is the platform flag, passed separately.
    expect(
      canManageAsset({ role: 'admin', access: { sites: ['s9'] } }, unit(), {
        isAdmin: false,
        isManager: true,
      })
    ).toBe(false)
  })
})

describe('restore will not mint a second copy of a code or a QR', () => {
  it('blocks a serial or a token a live unit already holds', () => {
    const live = [unit({ id: 'live', serialNo: 'FE-0001', qrToken: 'other' })]
    const msg = restoreBlockMessage([unit({ deletedAt: 1 })], live, 'extinguisher')
    expect(msg).toMatch(/serial number FE-0001/)
    expect(msg).toMatch(/not applied/)
    expect(
      restoreConflicts(
        [unit({ id: 'd', qrToken: 'tok', serialNo: 'FE-9', deletedAt: 1 })],
        [unit({ qrToken: 'tok', serialNo: 'FE-8' })],
        'extinguisher'
      )
    ).toHaveLength(1)
  })

  it('blocks two deleted units that share a code, and allows a blank serial', () => {
    const rows = [
      unit({ id: 'a', serialNo: 'FE-2', qrToken: 't1' }),
      unit({ id: 'b', serialNo: 'FE-2', qrToken: 't2' }),
    ]
    expect(restoreConflicts(rows, [], 'extinguisher').map((c) => c.id)).toEqual(['b'])
    expect(
      restoreConflicts(
        [unit({ serialNo: '', qrToken: '' }), unit({ id: 'b', serialNo: '', qrToken: '' })],
        [],
        'extinguisher'
      )
    ).toEqual([])
  })

  it('ignores a live row that is itself deleted, and an unknown kind', () => {
    expect(restoreConflicts([unit()], [unit({ id: 'x', deletedAt: 1 })], 'extinguisher')).toEqual(
      []
    )
    expect(restoreConflicts([unit()], [], 'stretcher')).toEqual([])
  })
})

describe('adding a unit does not take a code the bin is holding', () => {
  const deleted = [unit({ deletedAt: 1, serialNo: 'FE-0004', qrToken: 'old' })]

  it("holds a create that reuses a deleted serial or anyone's QR token", () => {
    const { fresh, held } = holdRetiredImports(
      [
        { serialNo: 'FE-0004', qrToken: 'new' },
        { serialNo: 'FE-0009', qrToken: 'old' },
        { serialNo: 'FE-0010', qrToken: 'fresh' },
      ],
      { live: [unit({ qrToken: 'live-tok', serialNo: 'FE-0001' })], deleted }
    )
    expect(fresh.map((r) => r.serialNo)).toEqual(['FE-0010'])
    expect(held).toHaveLength(2)
    expect(held[0].reason).toMatch(/Recently deleted/)
    expect(held[1].reason).toMatch(/Recently deleted/)
  })

  it('says so on the add form, for a live code as well as a deleted one', () => {
    expect(adoptionBlock({ serial: 'fe-0004', live: [], deleted })).toMatch(/Recently deleted/)
    expect(adoptionBlock({ token: 'OLD', live: [], deleted })).toMatch(/Recently deleted/)
    expect(adoptionBlock({ serial: 'FE-0001', live: [unit()], deleted: [] })).toMatch(
      /already in the register/
    )
    expect(adoptionBlock({ serial: 'FE-0099', token: 'brand-new', live: [unit()], deleted })).toBe(
      ''
    )
  })
})

describe('the scan page names the deletion and nothing about who did it', () => {
  it("uses the extinguisher sentence, and does not carry a person's name", () => {
    const copy = retiredQrCopy({ serialNo: 'FE-0001', deletedBy: 'Sarath' })
    expect(copy.title).toBe('This fire extinguisher was deleted')
    expect(copy.detail).toMatch(/FE-0001/)
    expect(copy.detail).not.toMatch(/Sarath/)
    expect(retiredQrCopy({ assetKind: 'aed', label: 'AED-0002' }).title).toBe(
      'This AED was deleted'
    )
    expect(retiredQrCopy({ assetKind: 'fas' }).title).toBe('This fire alarm panel was deleted')
  })
})
