import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  safeWaChatLink,
  TELEGRAM_SITE_LOOKUP_URL,
  TELEGRAM_SITE_LOOKUP_USERNAME,
} from './whatsappConnect'

describe('safeWaChatLink', () => {
  it('accepts only a wa.me link for a country-coded number', () => {
    expect(safeWaChatLink('https://wa.me/919000000001')).toBe('https://wa.me/919000000001')
    expect(safeWaChatLink('https://wa.me/9000000001')).toBeNull()
    expect(safeWaChatLink('javascript:alert(1)')).toBeNull()
    expect(safeWaChatLink('https://example.com/919000000001')).toBeNull()
    expect(safeWaChatLink('https://wa.me/919000000001?text=hi')).toBeNull()
  })
})

describe('the public Telegram bot', () => {
  it('is the site-lookup bot already named in the docs', () => {
    expect(TELEGRAM_SITE_LOOKUP_URL).toBe('https://t.me/WEEHS_Site_Lookup_bot')
    expect(TELEGRAM_SITE_LOOKUP_USERNAME).toBe('@WEEHS_Site_Lookup_bot')
  })
})

describe('the settings screen source', () => {
  const src = readFileSync(new URL('./WhatsAppConnect.jsx', import.meta.url), 'utf8')

  it('does not mention a WhatsApp or Telegram secret', () => {
    expect(src).not.toMatch(
      /WA_ACCESS_TOKEN|WA_APP_SECRET|WA_VERIFY_TOKEN|WA_PHONE_NUMBER_ID|TELEGRAM_BOT_TOKEN|TG_WEBHOOK_SECRET/
    )
  })

  it('uses the public Telegram link and does not offer Telegram management', () => {
    expect(src).toContain('TELEGRAM_SITE_LOOKUP_URL')
    expect(src).toContain('TELEGRAM_SITE_LOOKUP_USERNAME')
    expect(src).not.toMatch(/setTelegram|enableTelegram|TG_ENABLED/)
  })
})
