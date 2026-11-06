// ─────────────────────────────────────────────────────────────────────────────
// S3-compatible adapter — AWS S3, Cloudflare R2, MinIO, Backblaze B2, GCS…
//
// A browser must NEVER hold S3 credentials, so this adapter does not talk to
// the bucket directly. It talks to a small presign endpoint YOU host (Cloud
// Function, Lambda, one Express route) that checks the caller's auth and
// returns short-lived signed URLs:
//
//   POST  {VITE_S3_PRESIGN_ENDPOINT}
//   body  { op: 'put',    path, contentType }  ->  { uploadUrl, publicUrl }
//   body  { op: 'delete', path }               ->  { deleteUrl }
//
// The endpoint is the security boundary — it must verify the user's session
// and that `path` starts with the caller's own `orgs/<orgId>/` prefix, exactly
// what storage.rules enforces on Firebase today.
//
// Activate with:  VITE_STORAGE_DRIVER=s3  and  VITE_S3_PRESIGN_ENDPOINT=<url>
// ─────────────────────────────────────────────────────────────────────────────
import { auth } from '../../firebase'
import { currentAccessToken } from '../../auth/ownStackSession'
import { publicStackValue } from '../../stackPublicEnv'

// The dedicated host's presign URL ends in /presign and the bytes live at
// /blob on the same origin. A company that brings its own presigner is
// expected to serve the same pair. docs/CUSTOM-STACK.md.
function presignEndpoint() {
  return publicStackValue('VITE_S3_PRESIGN_ENDPOINT').replace(/\/$/, '')
}

function blobUrl(path) {
  const endpoint = presignEndpoint()
  if (!endpoint) return ''
  const base = endpoint.endsWith('/presign') ? endpoint.slice(0, -'/presign'.length) : endpoint
  return `${base}/blob?path=${encodeURIComponent(path)}`
}

async function sessionHeader() {
  const token = currentAccessToken() || (await auth?.currentUser?.getIdToken?.().catch(() => null))
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function presign(body) {
  // Own-stack sends the session token from the company's IdP host. The WEEHS
  // build still sends the Firebase ID token. Neither token is a bucket
  // credential, and a delete is not authorised from the token alone: the
  // presign host re-reads the live profile. docs/CUSTOM-STACK.md.
  const endpoint = presignEndpoint()
  if (!endpoint) return null
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await sessionHeader()),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`presign failed: ${res.status}`)
  return res.json()
}

export default {
  name: 's3',

  async put(path, blob) {
    const signed = await presign({
      op: 'put',
      path,
      contentType: blob.type || 'application/octet-stream',
    })
    if (!signed) return null
    const { uploadUrl, publicUrl } = signed
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    return { url: publicUrl }
  },

  // The session is what storage.rules would have checked. An <img src> does
  // not send it; fileUrl calls this and then builds an object URL.
  async resolveBlob(path) {
    const url = blobUrl(path)
    if (!url) return null
    try {
      const res = await fetch(url, { headers: await sessionHeader() })
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  },

  async resolve(path) {
    const blob = await this.resolveBlob(path)
    if (!blob || typeof URL === 'undefined' || !URL.createObjectURL) return null
    return URL.createObjectURL(blob)
  },

  async remove(path) {
    const signed = await presign({ op: 'delete', path })
    if (!signed?.deleteUrl) return
    await fetch(signed.deleteUrl, { method: 'DELETE' })
  },
}
