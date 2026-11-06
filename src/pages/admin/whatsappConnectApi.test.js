import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { safeWaChatLink } from './whatsappConnectApi.js'

describe('safeWaChatLink', () => {
  it('accepts only a wa.me link for a country-coded number', () => {
    expect(safeWaChatLink('https://wa.me/919000000001')).toBe('https://wa.me/919000000001')
    expect(safeWaChatLink('https://wa.me/9000000001')).toBeNull()
    expect(safeWaChatLink('javascript:alert(1)')).toBeNull()
    expect(safeWaChatLink('https://example.com/919000000001')).toBeNull()
    expect(safeWaChatLink('https://wa.me/919000000001?text=hi')).toBeNull()
  })
})

describe('the settings screen source', () => {
  const src = readFileSync(new URL('./WhatsAppConnect.jsx', import.meta.url), 'utf8')

  it('does not mention a WhatsApp secret or a Telegram bot', () => {
    expect(src).not.toMatch(
      /WA_ACCESS_TOKEN|WA_APP_SECRET|WA_VERIFY_TOKEN|WA_PHONE_NUMBER_ID|TELEGRAM|TG_|t\.me\//
    )
  })

  it('keeps the WhatsApp link and does not offer a Telegram control', () => {
    expect(src).toContain('safeWaChatLink')
    expect(src).not.toMatch(/Telegram|telegram/)
  })

  // OrgSettings imported './WhatsAppConnect' with no extension. On a
  // case-insensitive disk Vite probes '.js' first and bound whatsappConnect.js,
  // which has no default export, so the production build failed only on macOS.
  it('imports the helper under a name that does not collide with the component', () => {
    expect(src).toContain("from './whatsappConnectApi.js'")
    const settings = readFileSync(new URL('./OrgSettings.jsx', import.meta.url), 'utf8')
    expect(settings).toContain("from './WhatsAppConnect.jsx'")
  })
})
