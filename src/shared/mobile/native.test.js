import { describe, expect, it } from 'vitest'
import { persistenceForPlatform } from './native'

describe('persistenceForPlatform', () => {
  it('keeps a browser session from surviving a closed window', () => {
    expect(persistenceForPlatform('web')).toBe('session')
  })

  it('keeps the installed app signed in across a locked phone', () => {
    expect(persistenceForPlatform('android')).toBe('local')
    expect(persistenceForPlatform('ios')).toBe('local')
  })
})
