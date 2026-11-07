// Company SAML. The assertion is checked by the IdP certificate on the host.
// An unsigned response is not an identity. The certificate is a secret-store
// value, not a field on the provisioning request.

import { SAML } from '@node-saml/node-saml'
import { inflateRawSync } from 'node:zlib'

/**
 * The certificate as node-saml accepts it whatever shape it arrived in.
 *
 * The handoff page collects it in a single-line field, and an <input> drops
 * line breaks, so a pasted PEM arrives as one line. node-saml rejects that
 * form, and the failure surfaced as nothing more than every sign-in being
 * refused. The base64 body alone is accepted, so that is what is kept.
 */
export function normalizeIdpCert(cert) {
  return String(cert || '')
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

export function samlClient({ issuer, callbackUrl, idpCert, entryPoint }) {
  const cert = normalizeIdpCert(idpCert)
  if (!cert || !entryPoint) {
    throw new Error('saml: the IdP certificate and entry point are required')
  }
  return new SAML({
    issuer,
    callbackUrl,
    idpCert: cert,
    entryPoint,
    wantAssertionsSigned: true,
    identifierFormat: null,
    // A response is accepted only as the answer to an AuthnRequest this host
    // issued, once. The library default is 'never', under which a signed
    // response captured from one sign-in can be posted again, or posted
    // without anyone having started a sign-in, until its timestamps expire.
    // The request ids live in this client's in-memory cache, so the host must
    // keep one client for both legs (stack/server.mjs does).
    validateInResponseTo: 'always',
  })
}

/** The ID of the AuthnRequest carried in a redirect-binding authorize URL. */
export function authnRequestId(authorizeUrl) {
  try {
    const raw = new URL(authorizeUrl).searchParams.get('SAMLRequest') || ''
    const xml = inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8')
    return xml.match(/\sID="([^"]+)"/)?.[1] || ''
  } catch {
    return ''
  }
}

export async function identityFromSaml(client, samlResponse) {
  let profile
  try {
    const checked = await client.validatePostResponseAsync({ SAMLResponse: samlResponse })
    profile = checked.profile
  } catch {
    return { ok: false, reason: 'assertion' }
  }
  const sub = profile?.nameID
  if (!sub) return { ok: false, reason: 'assertion' }
  const email = profile.email || profile.mail || (String(sub).includes('@') ? sub : '')
  return {
    ok: true,
    inResponseTo: String(profile.inResponseTo || ''),
    sub: String(sub),
    email: String(email || ''),
    name: String(profile.displayName || email || sub),
  }
}
