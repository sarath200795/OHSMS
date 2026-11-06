// Company SAML. The assertion is checked by the IdP certificate on the host.
// An unsigned response is not an identity. The certificate is a secret-store
// value, not a field on the provisioning request.

import { SAML } from '@node-saml/node-saml'

export function samlClient({ issuer, callbackUrl, idpCert, entryPoint }) {
  if (!idpCert || !entryPoint) {
    throw new Error('saml: the IdP certificate and entry point are required')
  }
  return new SAML({
    issuer,
    callbackUrl,
    idpCert,
    entryPoint,
    wantAssertionsSigned: true,
    identifierFormat: null,
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
