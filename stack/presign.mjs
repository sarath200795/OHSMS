// Presign decision. The bearer token is not the authority for a delete.
// storage.rules could only see the token, which stays valid for up to an hour
// after a suspension (S-19). This reads the profile the caller passes in from
// a live query. mayDeleteFile is the same predicate the Firebase callable uses.

import { mayDeleteFile, ownedByOrg } from '../functions/lib/fileDelete.js'

const MEDICAL = '/medical-records/'
const MAILED = '/mailed-reports/'

// storage.rules allow-list. SVG is refused there because it is a document
// that can carry script. octet-stream stays, because sealed uploads are
// stored as that on purpose.
const BLOB_TYPE =
  /^(image\/(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf|text\/csv|application\/octet-stream|application\/msword|application\/vnd\.ms-(excel|powerpoint)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/

export const MAX_BLOB_BYTES = 20 * 1024 * 1024

function approved(profile) {
  return Boolean(profile) && profile.status === 'approved' && profile.mustChangePassword !== true
}

export function allowedBlobType(contentType) {
  const type = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!type || type.includes('svg')) return false
  return BLOB_TYPE.test(type)
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

/**
 * Who may read an object. storage.rules grants a tenant read and then takes
 * medical-records and mailed-reports back out of that grant. A second, narrower
 * allow would not have removed them: the rules OR together.
 */
export function decideBlobRead({ path, profile }) {
  if (!approved(profile)) return { ok: false, reason: 'profile' }
  const p = String(path || '')
  if (!ownedByOrg(p, profile.orgId)) return { ok: false, reason: 'path' }
  if (p.includes(MAILED)) return { ok: false, reason: 'mailed' }
  if (p.includes(MEDICAL) && profile.role !== 'admin' && profile.role !== 'manager') {
    return { ok: false, reason: 'medical' }
  }
  return { ok: true }
}
