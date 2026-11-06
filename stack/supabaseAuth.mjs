// Supabase Auth is an IdP. The call uses the anon key, which may be public,
// and the user's password once, on the host. The service-role key is not read
// here. A successful GoTrue user lookup is the identity; the access token is
// not stored.

export async function identityFromSupabase({
  issuer,
  anonKey,
  email,
  password,
  fetchImpl = fetch,
}) {
  const root = String(issuer || '').replace(/\/$/, '')
  if (!root || !anonKey || !email || !password) return { ok: false, reason: 'config' }
  const tokenRes = await fetchImpl(`${root}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!tokenRes.ok) return { ok: false, reason: 'denied' }
  const tokens = await tokenRes.json()
  if (!tokens?.access_token) return { ok: false, reason: 'denied' }
  const userRes = await fetchImpl(`${root}/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userRes.ok) return { ok: false, reason: 'denied' }
  const user = await userRes.json()
  if (!user?.id) return { ok: false, reason: 'denied' }
  return {
    ok: true,
    sub: String(user.id),
    email: String(user.email || email),
    name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || email),
  }
}
