import { describe, expect, it } from 'vitest'
import { isPermissionDenied } from './permissionDenied'

describe('isPermissionDenied', () => {
  it("recognises Firestore's code", () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true)
  })

  it("recognises a callable's namespaced code", () => {
    expect(isPermissionDenied({ code: 'functions/permission-denied' })).toBe(true)
  })

  it('recognises the message Firestore prints when the code is stripped', () => {
    expect(isPermissionDenied(new Error('Missing or insufficient permissions.'))).toBe(true)
  })

  it('does not swallow a real fault', () => {
    expect(isPermissionDenied(new Error('The query requires an index'))).toBe(false)
    expect(isPermissionDenied({ code: 'unavailable' })).toBe(false)
    expect(isPermissionDenied(null)).toBe(false)
  })
})
