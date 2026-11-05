import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(path, 'utf8')

describe('public legal pages', () => {
  const privacy = read('public/privacy.html')
  const terms = read('public/terms.html')
  const hosting = JSON.parse(read('firebase.json')).hosting
  const login = read('src/pages/auth/Login.jsx')

  it('serves /privacy and /terms as static files ahead of the app shell', () => {
    const rewrites = hosting.rewrites
    const catchAll = rewrites.findIndex((rule) => rule.source === '**')
    expect(catchAll).toBeGreaterThan(0)
    for (const [source, destination] of [
      ['/privacy', '/privacy.html'],
      ['/privacy/', '/privacy.html'],
      ['/terms', '/terms.html'],
      ['/terms/', '/terms.html'],
    ]) {
      const at = rewrites.findIndex((rule) => rule.source === source)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThan(catchAll)
      expect(rewrites[at].destination).toBe(destination)
    }
  })

  it('puts the privacy policy in the file a crawler receives, with no script', () => {
    expect(privacy).not.toMatch(/<script/i)
    expect(privacy).toContain('Privacy Policy')
    expect(privacy).toContain('WEEHS (weehs.org)')
    expect(privacy).toContain('Effective 25 October 2026')
    expect(privacy).toContain('info@weehs.org')
    expect(privacy).toContain('href="mailto:info@weehs.org"')
    expect(privacy).toContain('href="tel:+917793966625"')
    expect(privacy).toContain('+91 77939 66625')
    expect(privacy).toContain('Account information')
    expect(privacy).toContain('Phone numbers authorised for a bot')
    expect(privacy).toContain('Messages sent to a bot')
    expect(privacy).toContain('Site and safety records')
    expect(privacy).toContain('Location, if you share it')
    expect(privacy).toContain('Google Firebase and Google Cloud')
    expect(privacy).toContain('does not sell personal information')
    expect(privacy).toContain('How long we keep it')
    expect(privacy).toContain('How we protect it')
    expect(privacy).toContain('deletion')
  })

  it('puts the terms in the same kind of document', () => {
    expect(terms).not.toMatch(/<script/i)
    expect(terms).toContain('Terms of Use')
    expect(terms).toContain('WEEHS (weehs.org)')
    expect(terms).toContain('Effective 25 October 2026')
    expect(terms).toContain('info@weehs.org')
    expect(terms).toContain('href="mailto:info@weehs.org"')
    expect(terms).toContain('href="tel:+917793966625"')
    expect(terms).toContain('+91 77939 66625')
    expect(terms).toContain('Acceptable use')
    expect(terms).toContain('Accounts')
    expect(terms).toContain('Site-lookup bots')
    expect(terms).toContain('not a guarantee')
    expect(terms).toContain('Intellectual property')
    expect(terms).toContain('Liability')
    expect(terms).toContain('Ending access')
    expect(terms).toContain('laws of India')
    expect(terms).toContain('href="/privacy"')
  })

  it('links both documents from the sign-in footer', () => {
    expect(login).toContain('href="/privacy"')
    expect(login).toContain('Privacy Policy')
    expect(login).toContain('href="/terms"')
    expect(login).toContain('Terms of Use')
  })
})
