// Turn a provisioning request plus a secret intake into a dedicated environment.
//
// The browser never sees this. Status is written through `admin.update`, which
// is the server-side path: firestore.rules refuses the same write from every
// client, operator included. Secrets stay in `secretStore`. The object handed
// to admin.update is statusPatch(), which has no room for them.
//
// stack/server.mjs calls this as soon as POST /intake accepts the secrets.
// POST /fulfill is the same call, kept for an operator retry when the secrets
// are already stored and the request is not live yet.

import { randomBytes } from 'node:crypto'
import { applySchema } from './engine.mjs'
import { newSessionSecret } from './session.mjs'
import { statusPatch, takeSecrets } from './intake.mjs'

const WORKER = { role: 'ohsms_worker', uid: '' }

function orgIdFor(requestId) {
  const clean = String(requestId || '').replace(/[^A-Za-z0-9]/g, '')
  return `org${clean.slice(0, 20)}`
}

function publicEnv({ request, gatewayUrl, presignUrl }) {
  return {
    VITE_DATA_DRIVER: 'postgres',
    VITE_DATA_GATEWAY: gatewayUrl,
    VITE_STORAGE_DRIVER: 's3',
    VITE_S3_PRESIGN_ENDPOINT: presignUrl,
    VITE_AUTH_METHOD: request.authMethod,
    VITE_AUTH_ISSUER: request.authIssuer || '',
    VITE_AUTH_CLIENT_ID: request.authClientId || '',
    VITE_AUTH_TOTP: 'off',
    ...(request.authMethod === 'supabase' && request.supabaseAnonKey
      ? { VITE_SUPABASE_ANON_KEY: request.supabaseAnonKey }
      : {}),
  }
}

function assertPublic(env, secrets) {
  const blob = JSON.stringify(env)
  for (const value of Object.values(secrets)) {
    if (value && blob.includes(value)) {
      throw new Error('public env contains a secret')
    }
  }
  if (/postgres(ql)?:\/\//i.test(blob) || /service[-_]?role/i.test(blob)) {
    throw new Error('public env contains a credential')
  }
}

/**
 * @param {object} input
 * @param {object} input.request  the non-secret provisioning request
 * @param {object} input.secrets  the intake, already off the request
 * @param {object} input.engine   document engine bound to the company's database
 * @param {object} input.db       the same database, for schema and invites
 * @param {object} input.admin    `{ update(id, patch) }` server-side writer
 * @param {Function} [input.mail] `(message) => Promise<{sent}>`
 * @param {string} input.dedicatedUrl
 * @param {string} input.gatewayUrl
 */
export async function fulfillRequest({
  request,
  secrets,
  engine,
  db,
  admin,
  mail,
  dedicatedUrl,
  gatewayUrl,
}) {
  if (!request?.id || request.status === 'live') {
    return { ok: false, reason: request?.status === 'live' ? 'already-live' : 'request' }
  }
  const taken = takeSecrets(secrets)
  if (!taken.ok) return { ok: false, reason: taken.reason }
  const secret = taken.value
  if (request.engine !== 'postgres' && request.engine !== 'supabase') {
    const patch = statusPatch({ status: 'failed', secretsReceived: true })
    await admin.update(request.id, patch)
    return { ok: false, reason: 'engine', detail: `${request.engine} has no adapter` }
  }
  if (request.mode === 'bring' && request.engine !== 'postgres' && request.engine !== 'supabase') {
    return { ok: false, reason: 'engine' }
  }
  if (
    (request.mode === 'bring' || secret.databaseUrl) &&
    request.engine === 'postgres' &&
    !secret.databaseUrl &&
    !db
  ) {
    return { ok: false, reason: 'database' }
  }

  await applySchema(db)
  const orgId = orgIdFor(request.id)
  const sessionSecret = secret.sessionSecret || newSessionSecret()
  await engine.commit(WORKER, [
    {
      type: 'set',
      path: 'organizations',
      id: orgId,
      merge: false,
      data: {
        name: request.orgName,
        address: request.address || '',
        createdBy: 'provisioning',
        stack: 'own',
      },
    },
  ])
  await db.query(
    `INSERT INTO invites (email, org_id, role, name) VALUES ($1, $2, 'admin', $3)
     ON CONFLICT (email) DO UPDATE SET org_id = EXCLUDED.org_id, role = 'admin', name = EXCLUDED.name`,
    [
      String(request.contactEmail).trim().toLowerCase(),
      orgId,
      request.contactName || request.orgName,
    ]
  )

  const presignUrl = request.presignUrl || `${gatewayUrl}/presign`
  const anon = request.authMethod === 'supabase' ? secret.supabaseAnonKey || '' : ''
  const env = publicEnv({
    request: { ...request, supabaseAnonKey: anon },
    gatewayUrl,
    presignUrl,
  })
  const secretBlob = { ...secret, sessionSecret }
  delete secretBlob.supabaseAnonKey
  assertPublic(env, secretBlob)
  if (anon) {
    // The anon key is public by construction. The service-role key is not,
    // and assertPublic already rejected it if it was copied into env.
  }

  const patch = statusPatch({
    status: 'live',
    dedicatedUrl,
    secretsReceived: true,
  })
  await admin.update(request.id, patch)
  let mailed = { sent: false, reason: 'no-mail' }
  if (mail) {
    mailed = await mail({
      to: request.contactEmail,
      subject: `${request.orgName} is ready`,
      text: `Your organization is live at ${dedicatedUrl}. Sign in with your company's identity provider. Request ${request.id}.`,
    })
  }
  return {
    ok: true,
    orgId,
    dedicatedUrl,
    publicEnv: env,
    sessionSecret,
    mailed,
    patch,
  }
}

export function newOrgToken() {
  return randomBytes(18).toString('base64url')
}
