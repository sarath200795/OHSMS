import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { validDomain, buildEnv, readEnv, allowedRequest } = require('../../../installer/core.cjs')
const example = readFileSync(new URL('../../../selfhost/.env.example', import.meta.url), 'utf8')

describe('WEEHS Installer: the settings it writes', () => {
  it('fills every value the kit needs, in the forms the app accepts', () => {
    const env = readEnv(
      buildEnv(example, {
        domain: 'ehs.northwind.test',
        image: 'ghcr.io/o/weehs-dedicated@sha256:ab',
      })
    )
    expect(env.DOMAIN).toBe('ehs.northwind.test')
    expect(env.WEEHS_IMAGE).toBe('ghcr.io/o/weehs-dedicated@sha256:ab')
    // The app refuses anything but 32 bytes of base64 for these two.
    expect(Buffer.from(env.STATE_KEY, 'base64')).toHaveLength(32)
    expect(Buffer.from(env.DATA_KEY_MASTER, 'base64')).toHaveLength(32)
    // Hex: safe inside the database connection URL.
    expect(env.APP_DB_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(env.DB_ADMIN_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(env.CONTROL_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    expect(env.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(env.SMTP_HOST).toBe('')
  })

  it('makes new secrets every time', () => {
    const a = readEnv(buildEnv(example, { domain: 'a.test', image: 'i' }))
    const b = readEnv(buildEnv(example, { domain: 'a.test', image: 'i' }))
    expect(a.STATE_KEY).not.toBe(b.STATE_KEY)
    expect(a.CONTROL_TOKEN).not.toBe(b.CONTROL_TOKEN)
  })

  it('refuses a value that would start another line of settings', () => {
    expect(() =>
      buildEnv(example, {
        domain: 'a.test',
        image: 'i',
        mail: { host: 'smtp.a.test', pass: 'x\nCONTROL_TOKEN=chosen-by-me' },
      })
    ).toThrow(/SMTP_PASS/)
  })

  it('takes a host name and nothing else for the address', () => {
    expect(validDomain('ehs.northwind.com')).toBe(true)
    expect(validDomain('ehs.northwind.internal')).toBe(true)
    for (const bad of [
      'https://ehs.a.com',
      'ehs',
      'ehs.a.com/x',
      'ehs.a.com:8443',
      'a..com',
      '-a.com',
      '',
    ]) {
      expect(validDomain(bad)).toBe(false)
    }
  })
})

describe('WEEHS Installer: who may drive it', () => {
  const ok = {
    host: '127.0.0.1:47100',
    token: 'a'.repeat(48),
    expectedHost: '127.0.0.1:47100',
    expectedToken: 'a'.repeat(48),
  }
  it('answers its own page, with its own token', () => {
    expect(allowedRequest(ok)).toBe(true)
  })
  it('refuses another site’s request, a rebound host name, and a missing token', () => {
    expect(allowedRequest({ ...ok, token: 'b'.repeat(48) })).toBe(false)
    expect(allowedRequest({ ...ok, token: '' })).toBe(false)
    expect(allowedRequest({ ...ok, host: 'evil.test:47100' })).toBe(false)
    expect(allowedRequest({ ...ok, host: 'localhost:47100' })).toBe(false)
  })
})
