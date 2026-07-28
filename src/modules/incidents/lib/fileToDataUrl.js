// ─────────────────────────────────────────────────────────────────────────────
// Read a small uploaded file (PDF/image) into a base64 data URL so it can be
// embedded directly in a Firestore document. Kept small on purpose — Firestore
// docs are capped at ~1 MB, so we cap the source file well below that.
// ─────────────────────────────────────────────────────────────────────────────

// Max source file size. Base64 inflates by ~33%, so 700 KB → ~930 KB encoded,
// which stays under Firestore's 1 MB document limit with room for other fields.
export const MAX_QUOTE_FILE_BYTES = 700 * 1024

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
    return `File is too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(max / 1024)} KB — please compress it.`
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
