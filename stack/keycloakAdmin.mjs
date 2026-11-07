// Keycloak admin calls for the self-hosted IdP.
//
// The browser never receives the admin password or the user's password.
// Callers pass them in, the request body carries them to Keycloak on
// localhost, and this module does not log either value. The certificate
// it returns is the public IdP signing certificate.

function trim(url) {
  return String(url || '').replace(/\/$/, '')
}

async function token({ internalUrl, adminUser, adminPassword, fetchImpl }) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUser,
    password: adminPassword,
  })
  const res = await fetchImpl(`${trim(internalUrl)}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`keycloak admin login failed (${res.status})`)
  const json = await res.json()
  if (!json.access_token) throw new Error('keycloak admin login returned no token')
  return json.access_token
}

async function api(fetchImpl, internalUrl, access, method, path, body) {
  const res = await fetchImpl(`${trim(internalUrl)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res
}

export function certificateFromMetadata(xml) {
  const text = String(xml)
  const signing =
    text.match(/use="signing"[\s\S]*?<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/) ||
    text.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)
  if (!signing) throw new Error('keycloak metadata has no signing certificate')
  const body = signing[1].replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

const PROFILE_ACTIONS = new Set(['VERIFY_PROFILE', 'UPDATE_PROFILE'])

function personName(value, email) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] }
  const local = String(email || '').split('@')[0] || 'member'
  return { firstName: local, lastName: local }
}

async function settleProfile(fetchImpl, internalUrl, access, realm, summary, fallbackName) {
  const actions = Array.isArray(summary?.requiredActions) ? summary.requiredActions : []
  const missingName =
    !String(summary?.firstName || '').trim() || !String(summary?.lastName || '').trim()
  const blocking = actions.some((action) => PROFILE_ACTIONS.has(action))
  if (!missingName && !blocking) return
  const full = await api(
    fetchImpl,
    internalUrl,
    access,
    'GET',
    `/admin/realms/${realm}/users/${encodeURIComponent(summary.id)}`
  )
  if (!full.ok) throw new Error(`keycloak profile lookup failed (${full.status})`)
  const user = await full.json()
  const current = Array.isArray(user.requiredActions) ? user.requiredActions : []
  const names = personName(
    fallbackName || `${user.firstName || ''} ${user.lastName || ''}`,
    user.email
  )
  const body = {
    ...user,
    firstName: String(user.firstName || '').trim() || names.firstName,
    lastName: String(user.lastName || '').trim() || names.lastName,
    requiredActions: current.filter((action) => !PROFILE_ACTIONS.has(action)),
  }
  delete body.credentials
  const updated = await api(
    fetchImpl,
    internalUrl,
    access,
    'PUT',
    `/admin/realms/${realm}/users/${encodeURIComponent(summary.id)}`,
    body
  )
  if (!updated.ok) throw new Error(`keycloak profile was not updated (${updated.status})`)
}

export async function configureKeycloak({
  internalUrl,
  publicUrl,
  adminUser,
  adminPassword,
  realm,
  clientId,
  acsUrl,
  sloUrl,
  userEmail,
  userPassword,
  userName = '',
  fetchImpl = fetch,
}) {
  const access = await token({ internalUrl, adminUser, adminPassword, fetchImpl })
  const existing = await api(fetchImpl, internalUrl, access, 'GET', `/admin/realms/${realm}`)
  if (existing.status === 404) {
    const created = await api(fetchImpl, internalUrl, access, 'POST', '/admin/realms', {
      realm,
      enabled: true,
    })
    if (!created.ok && created.status !== 409) {
      throw new Error(`keycloak realm was not created (${created.status})`)
    }
  } else if (!existing.ok) {
    throw new Error(`keycloak realm lookup failed (${existing.status})`)
  }

  const clients = await api(
    fetchImpl,
    internalUrl,
    access,
    'GET',
    `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`
  )
  if (!clients.ok) throw new Error(`keycloak client lookup failed (${clients.status})`)
  const list = await clients.json()
  if (!list.length) {
    const client = await api(
      fetchImpl,
      internalUrl,
      access,
      'POST',
      `/admin/realms/${realm}/clients`,
      {
        clientId,
        protocol: 'saml',
        enabled: true,
        frontchannelLogout: true,
        redirectUris: [acsUrl],
        baseUrl: acsUrl,
        attributes: {
          saml_assertion_consumer_url_post: acsUrl,
          saml_single_logout_service_url_post: sloUrl,
          'saml.force.post.binding': 'true',
          'saml.server.signature': 'true',
          'saml.client.signature': 'false',
          'saml.signature.algorithm': 'RSA_SHA256',
          saml_name_id_format: 'email',
          saml_force_name_id_format: 'true',
          'saml.assertion.signature': 'true',
        },
      }
    )
    if (!client.ok && client.status !== 409) {
      throw new Error(`keycloak client was not created (${client.status})`)
    }
  }

  if (userEmail && userPassword) {
    const found = await api(
      fetchImpl,
      internalUrl,
      access,
      'GET',
      `/admin/realms/${realm}/users?email=${encodeURIComponent(userEmail)}&exact=true`
    )
    if (!found.ok) throw new Error(`keycloak user lookup failed (${found.status})`)
    const users = await found.json()
    if (!users.length) {
      const made = await api(
        fetchImpl,
        internalUrl,
        access,
        'POST',
        `/admin/realms/${realm}/users`,
        {
          username: userEmail,
          email: userEmail,
          enabled: true,
          emailVerified: true,
          ...personName(userName, userEmail),
          requiredActions: [],
          credentials: [{ type: 'password', value: userPassword, temporary: false }],
        }
      )
      if (!made.ok && made.status !== 409) {
        throw new Error(`keycloak user was not created (${made.status})`)
      }
    } else {
      await settleProfile(fetchImpl, internalUrl, access, realm, users[0], userName)
    }
  }

  // Keycloak 26 asks for a first and last name when they are empty, then
  // ForceAuthn treats the session from that form as stale. Clearing the
  // profile action after the name exists lets the next password finish
  // the SAML response. The password is not sent again.
  const listed = await api(
    fetchImpl,
    internalUrl,
    access,
    'GET',
    `/admin/realms/${realm}/users?max=50`
  )
  if (listed.ok) {
    const realmUsers = await listed.json()
    for (const realmUser of Array.isArray(realmUsers) ? realmUsers : []) {
      if (!realmUser?.id) continue
      await settleProfile(fetchImpl, internalUrl, access, realm, realmUser, '')
    }
  }

  const metadata = await fetchImpl(`${trim(internalUrl)}/realms/${realm}/protocol/saml/descriptor`)
  if (!metadata.ok) throw new Error(`keycloak metadata failed (${metadata.status})`)
  return {
    cert: certificateFromMetadata(await metadata.text()),
    entryPoint: `${trim(publicUrl)}/realms/${realm}/protocol/saml`,
  }
}
