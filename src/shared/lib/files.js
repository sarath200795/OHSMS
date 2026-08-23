import { MAX_UPLOAD_BYTES, formatSize } from '../storage'

/** Read a File/Blob as a data URL, with no validation. Small inline attachments. */
export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })

// ─────────────────────────────────────────────────────────────────────────────
// The validating read.
//
// This was two byte-identical files — src/modules/fire/lib/fileToDataUrl.js and
// src/modules/incidents/lib/fileToDataUrl.js — sitting either side of the same
// limit. A size cap that exists twice is a size cap that can be raised once.
//
// The cap used to be 700KB because every file was embedded directly in a
// Firestore document, and those are capped at 1MB. Files now go to cloud
// storage, so the limit is the product one. The old ceiling still applies to
// the INLINE FALLBACK path, and that check lives with the write — see
// MAX_INLINE_BYTES in shared/storage.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES

export const ACCEPTED_ATTACHMENT_TYPES = ['application/pdf'] // + any image/*

/** True if the file's MIME type is allowed (PDF or any image). */
export function isAcceptedAttachmentType(type = '') {
  return type === 'application/pdf' || type.startsWith('image/')
}

/**
 * Validate a file's type and size. Pure — takes a { type, size } shape so it is
 * unit-testable without a real File. Returns an error message, or null when
 * valid.
 */
export function validateAttachment(file, max = MAX_ATTACHMENT_BYTES) {
  if (!file) return 'No file selected'
  if (!isAcceptedAttachmentType(file.type)) return 'Only PDF or image files are allowed'
  if (file.size > max) {
    return `File is too large (${formatSize(file.size)}). Max ${formatSize(max)} — please compress it.`
  }
  return null
}

/** Read a validated File into a base64 data URL. Rejects on validation failure. */
export function readFileAsDataUrl(file, max = MAX_ATTACHMENT_BYTES) {
  return new Promise((resolve, reject) => {
    const err = validateAttachment(file, max)
    if (err) return reject(new Error(err))
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}
