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

const ENDPOINT = String(import.meta.env.VITE_S3_PRESIGN_ENDPOINT || '').trim()

async function presign(body) {
  // Forward the Firebase ID token so the endpoint can authenticate the caller.
  // When auth itself migrates off Firebase, swap this header for the new session.
  const token = await auth?.currentUser?.getIdToken?.().catch(() => null)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`presign failed: ${res.status}`)
  return res.json()
}

export default {
  name: 's3',

  async put(path, blob) {
    if (!ENDPOINT) return null // not configured — caller falls back to inline
    const { uploadUrl, publicUrl } = await presign({
      op: 'put',
      path,
      contentType: blob.type || 'application/octet-stream',
    })
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    return { url: publicUrl }
  },

  async remove(path) {
    if (!ENDPOINT) return
    const { deleteUrl } = await presign({ op: 'delete', path })
    if (deleteUrl) await fetch(deleteUrl, { method: 'DELETE' })
  },
}
