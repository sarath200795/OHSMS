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
  return {
    ok: true,
    sub: String(user.sub),
    email: String(user.email || ''),
    name: String(user.name || ''),
  }
}
