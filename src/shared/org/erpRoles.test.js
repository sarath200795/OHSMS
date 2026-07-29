import { describe, it, expect } from 'vitest'
import {
  ERP_ROLES, ERP_ROLE_KEYS, ALL_EMPLOYEES,
  normalizeErpRoleLabels, erpRoleLabel, renderRoleTokens,
} from './erpRoles'

describe('ERP_ROLES', () => {
  it('keeps the stored keys stable — existing plans and contacts depend on them', () => {
    expect(ERP_ROLE_KEYS).toEqual(
      ['CM', 'CLM', 'Safety L1', 'Safety L2', 'Security', 'First Aider', 'HR', 'Legal', 'Other']
    )
  })

  it('ships a generic default label for every role', () => {
    for (const r of ERP_ROLES) {
      expect(r.label).toBeTruthy()
      expect(r.label).not.toMatch(/amazon|centre manager/i)
    }
  })
})

describe('normalizeErpRoleLabels', () => {
  it('falls back to defaults when nothing is saved', () => {
    const l = normalizeErpRoleLabels(undefined)
    expect(l.CM).toBe('Site Head')
    expect(l.Legal).toBe('Legal Lead')
  })

  it('applies an organization override', () => {
    const l = normalizeErpRoleLabels({ CM: 'Plant Head' })
    expect(l.CM).toBe('Plant Head')
    expect(l.CLM).toBe('Operations Lead') // untouched
  })

  it('ignores blank overrides rather than erasing a label', () => {
    expect(normalizeErpRoleLabels({ CM: '   ' }).CM).toBe('Site Head')
  })

  it('ignores unknown keys so a stale setting cannot invent a role', () => {
    const l = normalizeErpRoleLabels({ Wizard: 'Gandalf' })
    expect(l.Wizard).toBeUndefined()
    expect(Object.keys(l)).toEqual(ERP_ROLE_KEYS)
  })
})

describe('erpRoleLabel', () => {
  const labels = normalizeErpRoleLabels({ CM: 'Plant Head' })

  it('returns the organization label', () => {
    expect(erpRoleLabel('CM', labels)).toBe('Plant Head')
  })

  it('passes the everyone-audience through untouched', () => {
    expect(erpRoleLabel(ALL_EMPLOYEES, labels)).toBe(ALL_EMPLOYEES)
  })

  it('falls back to the key for a role stored before this existed', () => {
    expect(erpRoleLabel('Fire Marshal', labels)).toBe('Fire Marshal')
  })

  it('returns empty for a missing key', () => {
    expect(erpRoleLabel('', labels)).toBe('')
    expect(erpRoleLabel(null, labels)).toBe('')
  })
})

describe('renderRoleTokens', () => {
  const labels = normalizeErpRoleLabels({ CM: 'Plant Head', 'Safety L1': 'EHS Officer' })

  it('substitutes a placeholder with the organization title', () => {
    expect(renderRoleTokens('Brief the {{role:CM}} on arrival', labels))
      .toBe('Brief the Plant Head on arrival')
  })

  it('substitutes several placeholders in one step', () => {
    expect(renderRoleTokens('{{role:CM}} briefs the {{role:Safety L1}}', labels))
      .toBe('Plant Head briefs the EHS Officer')
  })

  it('tolerates spacing inside the placeholder', () => {
    expect(renderRoleTokens('{{role: CM }}', labels)).toBe('Plant Head')
  })

  it('leaves an unknown role visible rather than blanking it', () => {
    // A rescue plan step with no responsible party must be obvious, not silent.
    expect(renderRoleTokens('Call the {{role:Chaplain}}', labels)).toBe('Call the Chaplain')
  })

  it('leaves text without placeholders alone', () => {
    expect(renderRoleTokens('Walk, do not run.', labels)).toBe('Walk, do not run.')
  })

  it('handles empty input', () => {
    expect(renderRoleTokens('', labels)).toBe('')
    expect(renderRoleTokens(null, labels)).toBe('')
  })
})
