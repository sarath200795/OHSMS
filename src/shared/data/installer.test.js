import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  validDomain,
  buildEnv,
  readEnv,
  makeInstallerCode,
  normalizeCode,
  createLockout,
  actionAllowed,
} = require('../../../installer/core.cjs')
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
  it('makes a code that is easy to read off one screen and type on another', () => {
    const code = makeInstallerCode()
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    expect(makeInstallerCode()).not.toBe(code)
    expect(normalizeCode(` ${code.toLowerCase().replace('-', ' ')} `)).toBe(code)
    expect(normalizeCode('ABC')).toBe('')
  })

  it('never puts the code in the page visitors to the address see', () => {
    // installer.cjs fills __CODE__ in both pages; only the server's own screen
    // may carry it.
    const visitor = readFileSync(new URL('../../../installer/ui.html', import.meta.url), 'utf8')
    const server = readFileSync(new URL('../../../installer/code.html', import.meta.url), 'utf8')
    expect(visitor).not.toContain('__CODE__')
    expect(server).toContain('__CODE__')
  })

  it('locks after ten wrong codes, and opens again when the window passes', () => {
    let t = 0
    const lockout = createLockout({ now: () => t })
    for (let i = 0; i < 9; i += 1) lockout.fail()
    expect(lockout.locked()).toBe(false)
    lockout.fail()
    expect(lockout.locked()).toBe(true)
    t = 15 * 60 * 1000 + 1
    expect(lockout.locked()).toBe(false)
  })

  it('acts only with the session cookie and the header a form cannot send', () => {
    const session = 'a'.repeat(48)
    const cookie = `other=1; weehs_installer=${session}`
    expect(actionAllowed({ cookie, header: '1', session })).toBe(true)
    expect(actionAllowed({ cookie, header: undefined, session })).toBe(false)
    expect(
      actionAllowed({ cookie: 'weehs_installer=' + 'b'.repeat(48), header: '1', session })
    ).toBe(false)
    expect(actionAllowed({ cookie: '', header: '1', session })).toBe(false)
  })
})
