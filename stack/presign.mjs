// Presign decision. The bearer token is not the authority for a delete.
// storage.rules could only see the token, which stays valid for up to an hour
// after a suspension (S-19). This reads the profile the caller passes in from
// a live query. mayDeleteFile is the same predicate the Firebase callable uses.

import { mayDeleteFile, ownedByOrg } from '../functions/lib/fileDelete.js'

const MEDICAL = '/medical-records/'

function approved(profile) {
  return Boolean(profile) && profile.status === 'approved' && profile.mustChangePassword !== true
}

/**
 * @param {{ op: string, path: string, profile: object | null }} input
 * `profile` is the live row. A role stamped on the token is not an argument.
 */
export function decidePresign({ op, path, profile }) {
  if (op !== 'put' && op !== 'delete') return { ok: false, reason: 'op' }
  if (!approved(profile)) return { ok: false, reason: 'profile' }
  const p = String(path || '')
  if (!ownedByOrg(p, profile.orgId)) return { ok: false, reason: 'path' }
  if (op === 'delete') return mayDeleteFile(profile, p)
  if (profile.role === 'auditor') return { ok: false, reason: 'role' }
  if (p.includes(MEDICAL) && profile.role !== 'admin' && profile.role !== 'manager') {
    return { ok: false, reason: 'medical' }
  }
  return { ok: true }
}
