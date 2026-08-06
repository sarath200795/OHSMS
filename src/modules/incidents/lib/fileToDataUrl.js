// ─────────────────────────────────────────────────────────────────────────────
// Read an uploaded file (PDF/image) into a base64 data URL.
//
// The cap used to be 700KB because every file was embedded directly in a
// Firestore document, and those are capped at 1MB. Files now go to cloud
// storage, so the limit is the product one (10MB). The old ceiling still
// applies to the INLINE FALLBACK path, and that check lives with the write —
// see MAX_INLINE_BYTES in shared/storage.
// ─────────────────────────────────────────────────────────────────────────────
import { MAX_UPLOAD_BYTES, formatSize } from '../../../shared/storage'

export const MAX_QUOTE_FILE_BYTES = MAX_UPLOAD_BYTES

export const ACCEPTED_QUOTE_TYPES = ['application/pdf'] // + any image/*

/** True if the file's MIME type is allowed (PDF or any image). */
export function isAcceptedQuoteType(type = '') {
  return type === 'application/pdf' || type.startsWith('image/')
}

/**
 * Validate a file's type + size against the quote limits. Pure (takes a
 * { type, size } shape so it's unit-testable without a real File). Returns an
 * error message string, or null when valid.
 */
export function validateQuoteFile(file, max = MAX_QUOTE_FILE_BYTES) {
  if (!file) return 'No file selected'
  if (!isAcceptedQuoteType(file.type)) return 'Only PDF or image files are allowed'
  if (file.size > max) {
    return `File is too large (${formatSize(file.size)}). Max ${formatSize(max)} — please compress it.`
  }
  return null
}

/** Read a validated File into a base64 data URL. Rejects on validation failure. */
export function readFileAsDataUrl(file, max = MAX_QUOTE_FILE_BYTES) {
  return new Promise((resolve, reject) => {
    const err = validateQuoteFile(file, max)
    if (err) return reject(new Error(err))
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}
