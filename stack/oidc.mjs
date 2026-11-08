// Company OIDC. The client secret stays on the host. The browser only ever
// carries the authorization code and, after the callback, our own session
// token — which does not include the code or the secret.

function trim(url) {
  return String(url || '').replace(/\/$/, '')
}

export async function discover(issuer, fetchImpl = fetch) {
  const res = await fetchImpl(`${trim(issuer)}/.well-known/openid-configuration`)
  if (!res.ok) throw new Error(`oidc discovery failed (${res.status})`)
  return res.json()
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function endpointOk(value, { allowLoopbackHttp }) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK.has(url.hostname)
}

/**
 * The provider's own endpoints, from its discovery document.
 *
 * Sign-in used to call ISSUER/authorize, ISSUER/token and ISSUER/userinfo,
 * which is the shape of almost no real provider (Okta, Microsoft Entra,
 * Google, Keycloak all put them elsewhere), so company OIDC worked only
 * against the built-in demo issuer.
 *
 * The document's `issuer` must equal the configured issuer exactly (OIDC
 * Discovery §4.3): a document fetched from one place that names another
 * issuer is how one provider's tokens are accepted for another. Every
 * endpoint must be https; plain http only on loopback, for the local demo.
 */
export async function endpointsFor(issuer, { fetchImpl = fetch, allowLoopbackHttp = false } = {}) {
  const expected = trim(issuer)
  if (!endpointOk(expected, { allowLoopbackHttp })) throw new Error('oidc issuer is not https')
  const doc = await discover(expected, fetchImpl)
  if (trim(doc?.issuer) !== expected) throw new Error('oidc discovery names another issuer')
  const endpoints = {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    userinfoEndpoint: doc.userinfo_endpoint,
  }
  for (const [name, value] of Object.entries(endpoints)) {
    if (!endpointOk(value, { allowLoopbackHttp })) throw new Error(`oidc ${name} is not usable`)
  }
  return endpoints
}

export function authorizeUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  state,
  challenge,
  scope = 'openid email profile',
}) {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function identityFromCode({
  tokenEndpoint,
  userinfoEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  verifier,
  fetchImpl = fetch,
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  })
  if (clientSecret) body.set('client_secret', clientSecret)
  const tokenRes = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!tokenRes.ok) return { ok: false, reason: 'token' }
  const tokens = await tokenRes.json()
  if (!tokens.access_token) return { ok: false, reason: 'token' }
  const infoRes = await fetchImpl(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!infoRes.ok) return { ok: false, reason: 'userinfo' }
  const user = await infoRes.json()
  if (!user?.sub) return { ok: false, reason: 'userinfo' }
  // Invites are matched by email. A provider that says the address is not
  // verified is saying anyone could have typed it, and accepting it would let
  // them take an invite meant for someone else.
  if (user.email_verified === false || user.email_verified === 'false') {
    return { ok: false, reason: 'email-unverified' }
  }
  return {
    ok: true,
    sub: String(user.sub),
    email: String(user.email || ''),
    name: String(user.name || ''),
  }
}
