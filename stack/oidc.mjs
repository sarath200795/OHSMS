// Company OIDC. The client secret stays on the host. The browser only ever
// carries the authorization code and, after the callback, our own session
// token — which does not include the code or the secret.

function trim(url) {
  return String(url || '').replace(/\/$/, '')
}

// Every call to the provider refuses a redirect. The issuer is checked to be
// https; a followed redirect could land on http, or somewhere else entirely,
// and the document or tokens read there would be trusted as the provider's.
const NO_REDIRECT = { redirect: 'error' }

export async function discover(issuer, fetchImpl = fetch) {
  // OIDC Discovery §4: a trailing / on the issuer is removed before the path.
  const res = await fetchImpl(`${trim(issuer)}/.well-known/openid-configuration`, NO_REDIRECT)
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
  // Compared as written, trailing slash included: issuers are compared as
  // exact strings, and `https://idp/a` and `https://idp/a/` are two of them.
  const expected = String(issuer || '').trim()
  if (!endpointOk(expected, { allowLoopbackHttp })) throw new Error('oidc issuer is not https')
  const doc = await discover(expected, fetchImpl)
  if (doc?.issuer !== expected) throw new Error('oidc discovery names another issuer')
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
  acceptUnverifiedEmail = false,
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
    ...NO_REDIRECT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!tokenRes.ok) return { ok: false, reason: 'token' }
  const tokens = await tokenRes.json()
  if (!tokens.access_token) return { ok: false, reason: 'token' }
  const infoRes = await fetchImpl(userinfoEndpoint, {
    ...NO_REDIRECT,
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!infoRes.ok) return { ok: false, reason: 'userinfo' }
  const user = await infoRes.json()
  if (!user?.sub) return { ok: false, reason: 'userinfo' }
  // Invites are matched by email, so the address has to be one the provider
  // vouches for. An unverified one is one anyone could have typed, and would
  // take an invite meant for someone else. A missing claim is not a yes.
  //
  // Microsoft Entra sends no email_verified at all. Its `email` is set by the
  // tenant's administrators, so an operator whose IdP is their own Entra
  // tenant can say so with OIDC_ACCEPT_UNVERIFIED_EMAIL; an explicit false is
  // refused even then.
  const verified = user.email_verified === true || user.email_verified === 'true'
  const absent = user.email_verified === undefined || user.email_verified === null
  if (!verified && !(absent && acceptUnverifiedEmail)) {
    return { ok: false, reason: 'email-unverified' }
  }
  return {
    ok: true,
    sub: String(user.sub),
    email: String(user.email || ''),
    name: String(user.name || ''),
    groups: groupsOf(user, tokens.id_token),
  }
}

/**
 * Groups, for roles from groups (directory.mjs). Okta and Keycloak can put
 * them in userinfo; Microsoft Entra puts them only in the ID token. The ID
 * token came straight from the token endpoint over TLS, in exchange for this
 * client's secret and PKCE verifier, so it is read here without checking its
 * signature (OIDC Core 3.1.3.7); only its groups are used, never its
 * identity, which comes from userinfo as before.
 */
function groupsOf(user, idToken) {
  const out = new Set()
  const take = (v) => {
    for (const one of Array.isArray(v) ? v : []) {
      if (typeof one === 'string' && one.trim() && one.length <= 256) out.add(one.trim())
    }
  }
  take(user?.groups)
  if (typeof idToken === 'string' && idToken.split('.').length === 3) {
    try {
      take(JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))?.groups)
    } catch {
      // Not a JWT we can read: groups from userinfo only.
    }
  }
  return [...out].slice(0, 200)
}
