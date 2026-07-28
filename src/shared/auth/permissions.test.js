import { describe, it, expect } from 'vitest'
import { can, isReadOnly, rankOf } from './permissions'

describe('RBAC capability matrix', () => {
  it('admin can do everything', () => {
    expect(can('admin', 'user.manage')).toBe(true)
    expect(can('admin', 'org.settings')).toBe(true)
    expect(can('admin', 'record.delete')).toBe(true)
  })

  it('member can create/edit but not manage users or delete', () => {
    expect(can('member', 'record.create')).toBe(true)
    expect(can('member', 'record.edit')).toBe(true)
    expect(can('member', 'record.delete')).toBe(false)
    expect(can('member', 'user.manage')).toBe(false)
  })

  it('manager can close and delete records', () => {
    expect(can('manager', 'record.close')).toBe(true)
    expect(can('manager', 'record.delete')).toBe(true)
    expect(can('manager', 'site.manage')).toBe(true)
  })

  it('auditor is read-only: can view but not mutate', () => {
    expect(isReadOnly('auditor')).toBe(true)
    expect(can('auditor', 'record.view')).toBe(true)
    expect(can('auditor', 'audit.view')).toBe(true)
    expect(can('auditor', 'record.create')).toBe(false)
    expect(can('auditor', 'record.edit')).toBe(false)
  })

  it('ranks roles by privilege', () => {
    expect(rankOf('admin')).toBeGreaterThan(rankOf('manager'))
    expect(rankOf('manager')).toBeGreaterThan(rankOf('member'))
    expect(rankOf('member')).toBeGreaterThan(rankOf('auditor'))
  })
})
