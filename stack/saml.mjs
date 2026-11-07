// Company SAML. The assertion is checked by the IdP certificate on the host.
// An unsigned response is not an identity. The certificate is a secret-store
// value, not a field on the provisioning request.

import { SAML } from '@node-saml/node-saml'

// A password input keeps one line. A PEM pasted there loses its breaks, and
// node-saml will not read the certificate until they are put back.
export function idpCertPem(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('-----BEGIN CERTIFICATE-----') && text.includes('\n')) {
    return text.endsWith('\n') ? text : `${text}\n`
  }
  const body = text
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) return ''
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

export function samlClient({
  issuer,
  callbackUrl,
  idpCert,
  entryPoint,
  validateInResponseTo,
  forceAuthn = false,
  logoutUrl,
}) {
  const cert = idpCertPem(idpCert)
  if (!cert || !entryPoint) {
    throw new Error('saml: the IdP certificate and entry point are required')
  }
  return new SAML({
    issuer,
    callbackUrl,
    idpCert: cert,
    entryPoint,
    // The assertion is what this host treats as the identity. The library
    // also defaults to requiring a signature on the Response wrapper, which
    // rejects an IdP that signs the assertion and nothing else — the usual
    // case — before the certificate is consulted.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    // A leftover IdP cookie must not skip the password. Logout also sends
    // the browser to the IdP so that cookie is cleared. Both are required:
    // a redirect back to /login alone leaves the IdP session in place.
    forceAuthn: Boolean(forceAuthn),
    ...(logoutUrl ? { logoutUrl } : {}),
    ...(validateInResponseTo ? { validateInResponseTo } : {}),
  })
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
    sub: String(sub),
    email: String(email || ''),
    name: String(profile.displayName || email || sub),
  }
}
