// An own-stack build has no Firebase project by design. It used to be sent to
// the setup screen unless it carried a placeholder Firebase id.
import { describe, it, expect } from 'vitest'
import { isAppConfigured } from './appConfigured'

describe('isAppConfigured', () => {
  it('lets an own-stack build with a gateway through without any Firebase config', () => {
    expect(
      isAppConfigured({ ownStack: true, gateway: 'https://northwind.example', firebase: false })
    ).toBe(true)
  })

  it('still stops an own-stack build that has no gateway, Firebase config or not', () => {
    expect(isAppConfigured({ ownStack: true, gateway: '', firebase: false })).toBe(false)
    expect(isAppConfigured({ ownStack: true, gateway: '', firebase: true })).toBe(false)
  })

  it('leaves the shared build gated on Firebase exactly as before', () => {
    expect(isAppConfigured({ ownStack: false, gateway: '', firebase: true })).toBe(true)
    expect(isAppConfigured({ ownStack: false, gateway: '', firebase: false })).toBe(false)
  })
})
