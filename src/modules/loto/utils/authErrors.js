// Maps Firebase Auth / custom error codes to friendly messages.
const MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'hecp/invalid-join-code': 'No organization found for that join code.',
}

export function friendlyAuthError(error) {
  if (!error) return 'Something went wrong. Please try again.'
  return MESSAGES[error.code] || error.message || 'Something went wrong.'
}

const STORAGE_NOT_ENABLED =
  "Firebase Storage isn't enabled for this project yet. In the Firebase console go to Build → Storage → Get started (Blaze plan), then publish storage.rules."

const STORAGE_MESSAGES = {
  'storage/unauthorized':
    'Upload not allowed. Make sure Storage rules (storage.rules) are published.',
  'storage/unauthenticated': 'Please sign in again, then retry the upload.',
  'storage/retry-limit-exceeded': STORAGE_NOT_ENABLED,
  'storage/unknown': STORAGE_NOT_ENABLED,
  'storage/object-not-found': STORAGE_NOT_ENABLED,
  'storage/bucket-not-found': STORAGE_NOT_ENABLED,
  'storage/project-not-found': STORAGE_NOT_ENABLED,
  'storage/quota-exceeded': 'Storage quota exceeded for this project.',
  'storage/canceled': 'Upload canceled.',
}

export function friendlyStorageError(error) {
  if (!error) return 'Upload failed. Please try again.'
  // A missing bucket often surfaces as a 404 / network-style failure.
  if (STORAGE_MESSAGES[error.code]) return STORAGE_MESSAGES[error.code]
  if (/404|not found|bucket/i.test(error.message || '')) return STORAGE_NOT_ENABLED
  return error.message || 'Upload failed. Please try again.'
}
