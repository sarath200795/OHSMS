import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { waWebhook, startWhatsAppLink, refreshSiteAuditCache, buildWhatsAppSnapshots } from '../index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

describe('Telegram is not part of the deployment this source describes', () => {
  const index = read('functions/index.js')
  const settings = read('src/pages/admin/WhatsAppConnect.jsx')
  const deploy = read('scripts/deploy-functions.sh')
  const prep = read('scripts/prepare-functions-deploy.sh')

  it('still exports the WhatsApp webhook and the jobs that feed it', () => {
    expect(typeof waWebhook).toBe('function')
    expect(typeof startWhatsAppLink).toBe('function')
    expect(typeof refreshSiteAuditCache).toBe('function')
    expect(typeof buildWhatsAppSnapshots).toBe('function')
    expect(index).toMatch(/export const waWebhook = onRequest/)
    expect(index).not.toMatch(/TG_ENABLED/)
    expect(index).not.toMatch(/export const tgWebhook/)
  })

  it('does not declare Telegram params or secrets', () => {
    expect(index).not.toMatch(/defineString\('TG_/)
    expect(index).not.toMatch(/defineSecret\('TELEGRAM_/)
    expect(index).not.toMatch(/defineSecret\('TG_/)
    expect(prep).not.toMatch(/^TG_/m)
    expect(prep).not.toMatch(/TELEGRAM_BOT_TOKEN|TG_WEBHOOK_SECRET/)
  })

  it('does not render a Telegram link or a Telegram setting', () => {
    expect(settings).not.toMatch(/Telegram|telegram|t\.me\//)
  })

  it('does not delete leftover Cloud Functions unless deletion is explicitly approved', () => {
    expect(deploy).toMatch(/APPROVE_FUNCTION_DELETION/)
    expect(deploy).toMatch(/functions:\$\{name\}/)
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/APPROVE_FUNCTION_DELETION:\s*yes/)
    expect(read('.github/workflows/deploy-staging.yml')).not.toMatch(/APPROVE_FUNCTION_DELETION:\s*yes/)
    expect(read('.github/workflows/deploy.yml')).toMatch(/scripts\/deploy-functions\.sh/)
    expect(read('.github/workflows/deploy-staging.yml')).toMatch(/scripts\/deploy-functions\.sh/)
  })
})
