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
  matchesBinSearch,
  canOpenRecycleBin,
  countRestorable,
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

describe('searching the bin', () => {
  const row = (over = {}) => ({
    kind: 'extinguisher',
    serialNo: 'FE-0001',
    qrToken: 'tok-alpha',
    centerName: 'North Depot',
    location: 'Plant room',
    zone: 'Loop 2',
    type: 'ABC',
    capacity: '6 Kg',
    region: 'South',
    entity: 'COCO',
    deletedBy: 'Site lead',
    ...over,
  })

  it('matches every row when the box is empty', () => {
    expect(matchesBinSearch(row(), '')).toBe(true)
    expect(matchesBinSearch(row(), '   ')).toBe(true)
    expect(matchesBinSearch(null, '')).toBe(true)
  })

  it('matches a partial serial, asset id, device id, label, or QR token regardless of case', () => {
    expect(matchesBinSearch(row(), 'fe-000')).toBe(true)
    expect(matchesBinSearch(row({ kind: 'aed', serialNo: '', assetId: 'AED-42' }), 'aed-4')).toBe(
      true
    )
    expect(matchesBinSearch(row({ kind: 'fas', serialNo: '', deviceId: 'PNL-7' }), 'pnl')).toBe(
      true
    )
    expect(matchesBinSearch(row({ label: 'QR-STICKER-9' }), 'sticker')).toBe(true)
    expect(matchesBinSearch(row(), 'TOK-AL')).toBe(true)
  })

  it('matches site, location, type, capacity, region, entity, and who deleted it', () => {
    expect(matchesBinSearch(row(), 'north dep')).toBe(true)
    expect(matchesBinSearch(row({ siteName: 'Harbour' }), 'harbour')).toBe(true)
    expect(matchesBinSearch(row({ centerName: '', site: 'Wharf' }), 'wharf')).toBe(true)
    expect(matchesBinSearch(row(), 'plant')).toBe(true)
    expect(matchesBinSearch(row(), 'loop 2')).toBe(true)
    expect(matchesBinSearch(row(), 'abc')).toBe(true)
    expect(matchesBinSearch(row(), '6 kg')).toBe(true)
    expect(matchesBinSearch(row(), 'south')).toBe(true)
    expect(matchesBinSearch(row(), 'coco')).toBe(true)
    expect(matchesBinSearch(row(), 'site lea')).toBe(true)
    expect(matchesBinSearch(row({ kind: 'aed', brand: 'Philips', model: 'FRx' }), 'philips')).toBe(
      true
    )
    expect(matchesBinSearch(row({ kind: 'fas', deviceType: 'Smoke detector' }), 'smoke')).toBe(true)
  })

  it('matches the equipment kind, and not a different kind', () => {
    expect(matchesBinSearch(row(), 'fire extinguisher')).toBe(true)
    expect(matchesBinSearch(row({ serialNo: 'X' }), 'aed')).toBe(false)
    expect(matchesBinSearch(row({ kind: 'aed', serialNo: '', assetId: 'Z' }), 'aed')).toBe(true)
    expect(matchesBinSearch(row({ kind: 'fas', serialNo: '', deviceId: 'P1' }), 'fire alarm')).toBe(
      true
    )
    expect(
      matchesBinSearch(row({ kind: 'fas', serialNo: '', deviceId: 'P1' }), 'extinguisher')
    ).toBe(false)
  })

  it('refuses an unrelated query, and a sparse row does not throw', () => {
    expect(matchesBinSearch(row(), 'no-such-unit')).toBe(false)
    expect(matchesBinSearch({ kind: 'extinguisher' }, 'fe')).toBe(false)
    expect(matchesBinSearch(null, 'fe')).toBe(false)
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

describe('canOpenRecycleBin', () => {
  it('opens for an org admin whatever their grant', () => {
    expect(canOpenRecycleBin({ role: 'admin' }, { isAdmin: true, isManager: true })).toBe(true)
    expect(canOpenRecycleBin(null, { isAdmin: true })).toBe(true)
  })

  it('opens for a manager with a site, region, entity or posting', () => {
    const flags = { isManager: true }
    expect(canOpenRecycleBin(mgr({ sites: ['s1'] }), flags)).toBe(true)
    expect(canOpenRecycleBin(mgr({ regions: ['South'] }), flags)).toBe(true)
    expect(canOpenRecycleBin(mgr({ entities: ['COCO'] }), flags)).toBe(true)
    expect(canOpenRecycleBin(mgr({}, 's9'), flags)).toBe(true)
  })

  it('stays shut for a manager with an empty grant, a member and nobody', () => {
    expect(canOpenRecycleBin(mgr({ sites: [], regions: [''] }), { isManager: true })).toBe(false)
    expect(canOpenRecycleBin({ role: 'member', siteId: 's1' }, {})).toBe(false)
    expect(canOpenRecycleBin(null, { isManager: true })).toBe(false)
  })
})

describe('countRestorable', () => {
  const gone = new Date('2026-09-20T08:00:00Z')
  const rows = [
    unit({ id: 'a', deletedAt: gone }),
    unit({ id: 'b', siteId: 's2', region: '', entity: '', deletedAt: gone }),
    unit({ id: 'c' }),
  ]

  it('counts deleted rows an admin can reach and ignores live ones', () => {
    expect(countRestorable(rows, { role: 'admin' }, { isAdmin: true })).toBe(2)
  })

  it('counts only a manager’s own units', () => {
    expect(countRestorable(rows, mgr({ sites: ['s1'] }), { isManager: true })).toBe(1)
  })

  it('treats a missing slice as empty', () => {
    expect(countRestorable(undefined, { role: 'admin' }, { isAdmin: true })).toBe(0)
  })
})
