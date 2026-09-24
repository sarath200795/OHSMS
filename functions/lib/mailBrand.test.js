import { describe, it, expect } from 'vitest'
import { loadOrgDisplayName, mailSenderName } from './mailBrand.js'
import { memoryDb } from '../test-support/memoryDb.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('mailSenderName', () => {
  it('keeps an organisation name and drops a product name, a sealed value, or a header break', () => {
    expect(mailSenderName('Northwind Steel')).toBe('Northwind Steel')
    expect(mailSenderName('  Northwind Steel  ')).toBe('Northwind Steel')
    expect(mailSenderName('WEEHS')).toBe('')
    expect(mailSenderName('wehs')).toBe('')
    expect(mailSenderName('WEEHS OHSMS')).toBe('')
    expect(mailSenderName('Acme: Plant')).toBe('')
    expect(mailSenderName('Name <script>')).toBe('')
    expect(mailSenderName(SEALED)).toBe('')
    expect(mailSenderName('')).toBe('')
  })
})

describe('loadOrgDisplayName', () => {
  it('reads the organisation document name', async () => {
    const db = memoryDb({ 'organizations/orgA': { name: 'Northwind Steel' } })
    expect(await loadOrgDisplayName(db, 'orgA')).toBe('Northwind Steel')
  })

  it('returns empty when the document, the name, or the id cannot be used', async () => {
    expect(await loadOrgDisplayName(memoryDb({}), 'orgA')).toBe('')
    expect(
      await loadOrgDisplayName(memoryDb({ 'organizations/orgA': { name: SEALED } }), 'orgA')
    ).toBe('')
    expect(
      await loadOrgDisplayName(memoryDb({ 'organizations/orgA': { name: 'Northwind' } }), 'a/b')
    ).toBe('')
    expect(
      await loadOrgDisplayName(memoryDb({ 'organizations/orgA': { name: 'Northwind' } }), '..')
    ).toBe('')
  })
})
