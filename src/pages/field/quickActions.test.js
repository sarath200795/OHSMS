import { describe, expect, it } from 'vitest'
import { assetCard, fieldQuickActions, validateNextDue } from './quickActions'
import { AED_STATUS, FAS_STATUS, STATUS } from '../../modules/fire/lib/constants'

const ext = {
  orgId: 'org-1',
  serialNo: 'FE-10',
  type: 'ABC',
  capacity: '6kg',
  centerName: 'Plant',
  status: STATUS.ACTIVE,
  physicalDefects: [],
}

describe('fieldQuickActions', () => {
  it('lets a member inspect and raise a defect, and nothing that closes one', () => {
    const { state, actions } = fieldQuickActions(ext, { role: 'member', orgId: 'org-1' })
    expect(state).toBe('ready')
    expect(actions.map((a) => a.key)).toEqual(['inspect', 'defect'])
  })

  it('offers mark received only while the cylinder is with the vendor', () => {
    const away = { ...ext, status: STATUS.IN_PROCESS_REFILLING }
    expect(
      fieldQuickActions(away, { role: 'member', orgId: 'org-1' }).actions.map((a) => a.key)
    ).toContain('receive')
    expect(
      fieldQuickActions(ext, { role: 'member', orgId: 'org-1' }).actions.map((a) => a.key)
    ).not.toContain('receive')
  })

  it('offers close to a manager when the unit has an open physical defect', () => {
    const open = { ...ext, physicalDefects: ['pin'] }
    expect(
      fieldQuickActions(open, { role: 'manager', orgId: 'org-1' }).actions.map((a) => a.key)
    ).toContain('close')
    expect(
      fieldQuickActions(open, { role: 'member', orgId: 'org-1' }).actions.map((a) => a.key)
    ).not.toContain('close')
  })

  it('offers close on an AED or panel that is out of service, to a manager only', () => {
    const aed = {
      orgId: 'org-1',
      assetKind: 'aed',
      status: AED_STATUS.OUT_OF_SERVICE,
      assetRefId: 'a1',
    }
    expect(
      fieldQuickActions(aed, { role: 'manager', orgId: 'org-1' }).actions.map((a) => a.key)
    ).toContain('close')
    const fas = { orgId: 'org-1', assetKind: 'fas', status: FAS_STATUS.FAULTY, assetRefId: 'f1' }
    expect(
      fieldQuickActions(fas, { role: 'admin', orgId: 'org-1' }).actions.map((a) => a.key)
    ).toContain('close')
    const ready = { ...aed, status: AED_STATUS.READY }
    expect(
      fieldQuickActions(ready, { role: 'manager', orgId: 'org-1' }).actions.map((a) => a.key)
    ).not.toContain('close')
  })

  it('shows an auditor the unit and no buttons', () => {
    expect(fieldQuickActions(ext, { role: 'auditor', orgId: 'org-1' }).actions).toEqual([])
  })

  it('refuses a code that belongs to another organisation', () => {
    const result = fieldQuickActions(
      { ...ext, orgId: 'org-2', orgName: 'Other' },
      {
        role: 'admin',
        orgId: 'org-1',
      }
    )
    expect(result.state).toBe('foreign')
    expect(result.actions).toEqual([])
  })

  it('refuses a mirror that never recorded an organisation', () => {
    const unstamped = { ...ext }
    delete unstamped.orgId
    expect(fieldQuickActions(unstamped, { role: 'admin', orgId: 'org-1' }).state).toBe('unscoped')
  })

  it('does not offer actions on a retired unit', () => {
    expect(
      fieldQuickActions({ ...ext, deletedAt: '2026-10-01' }, { role: 'admin', orgId: 'org-1' })
        .state
    ).toBe('retired')
  })
})

describe('validateNextDue', () => {
  it('requires a date after today', () => {
    expect(validateNextDue('', '2026-10-24')).toMatch(/next due date/)
    expect(validateNextDue('2026-10-24', '2026-10-24')).toMatch(/after today/)
    expect(validateNextDue('2026-10-23', '2026-10-24')).toMatch(/after today/)
    expect(validateNextDue('2026-11-01', '2026-10-24')).toBe('')
  })
})

describe('assetCard', () => {
  it('describes an extinguisher from the mirror fields a sticker carries', () => {
    const card = assetCard({ ...ext, physicalDefects: ['pin'] })
    expect(card.eyebrow).toBe('Fire extinguisher')
    expect(card.title).toBe('ABC · 6kg')
    expect(card.subtitle).toBe('Serial FE-10')
    expect(card.defects).toEqual(['PIN'])
  })

  it('does not describe an AED as an extinguisher', () => {
    const card = assetCard({ assetKind: 'aed', brand: 'Philips', model: 'FRx', label: 'AED-4' })
    expect(card.eyebrow).toBe('AED')
    expect(card.title).toBe('Philips FRx')
    expect(card.subtitle).toBe('Asset AED-4')
  })
})
