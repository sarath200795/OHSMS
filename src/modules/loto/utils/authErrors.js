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
