// Translate Firebase Auth error codes (and our own thrown Errors) into
// friendly, human-readable messages.
const MAP = {
  'auth/email-already-in-use': 'That email is already registered. Try signing in instead.',
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
}

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong.'
  if (err.code && MAP[err.code]) return MAP[err.code]
  return err.message || 'Something went wrong.'
}
