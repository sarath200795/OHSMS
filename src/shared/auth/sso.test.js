import { describe, it, expect } from 'vitest'
import { parseSsoProviders } from './sso'

const ids = (raw) => parseSsoProviders(raw).providers.map((p) => p.id)

describe('parseSsoProviders', () => {
  it('reads an id and a label', () => {
    const { providers } = parseSsoProviders('saml.acme:Acme SSO')
    expect(providers).toEqual([{ id: 'saml.acme', kind: 'saml', label: 'Acme SSO' }])
  })

  it('reads several, separated by commas', () => {
    expect(ids('saml.acme:Acme,oidc.okta:Okta')).toEqual(['saml.acme', 'oidc.okta'])
  })

  it('tolerates whitespace around entries', () => {
    expect(ids('  saml.acme:Acme ,  oidc.okta:Okta  ')).toEqual(['saml.acme', 'oidc.okta'])
  })

  // A label with a colon in it — "Acme: Staff SSO" — must not be truncated.
  it('splits on the FIRST colon only', () => {
    expect(parseSsoProviders('saml.acme:Acme: Staff SSO').providers[0].label).toBe('Acme: Staff SSO')
  })

  it('derives a readable label when none is given', () => {
    expect(parseSsoProviders('saml.acme-corp').providers[0].label).toBe('Acme Corp')
    expect(parseSsoProviders('oidc.okta_prod').providers[0].label).toBe('Okta Prod')
  })

  it('records the kind so callers need not re-parse the prefix', () => {
    expect(parseSsoProviders('saml.a,oidc.b').providers.map((p) => p.kind)).toEqual(['saml', 'oidc'])
  })
})

// The whole point of dropping rather than throwing: a bad value must not take
// down the login page, because without the password form there is no way in.
describe('parseSsoProviders rejects what Firebase would reject', () => {
  it('is empty for unset, empty and whitespace', () => {
    expect(ids(undefined)).toEqual([])
    expect(ids(null)).toEqual([])
    expect(ids('')).toEqual([])
    expect(ids('   ,  , ')).toEqual([])
  })

  it('drops an id with no saml. or oidc. prefix', () => {
    const { providers, problems } = parseSsoProviders('google.com:Google')
    expect(providers).toEqual([])
    expect(problems[0]).toContain('must start with')
  })

  it('drops an id that is only the prefix', () => {
    expect(ids('saml.')).toEqual([])
    expect(ids('oidc.')).toEqual([])
  })

  it('drops a duplicate rather than rendering two identical buttons', () => {
    const { providers, problems } = parseSsoProviders('saml.acme:First,saml.acme:Second')
    expect(providers).toHaveLength(1)
    expect(providers[0].label).toBe('First')
    expect(problems[0]).toContain('more than once')
  })

  it('keeps the good entries when one is bad', () => {
    const { providers, problems } = parseSsoProviders('nonsense,saml.acme:Acme')
    expect(providers.map((p) => p.id)).toEqual(['saml.acme'])
    expect(problems).toHaveLength(1)
  })
})
