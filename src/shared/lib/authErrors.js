// Map Firebase Auth error codes to friendly, actionable messages.
const MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with that email already exists. Try signing in.',
  'auth/weak-password': 'Please choose a stronger password (at least 6 characters).',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this project.',
}

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong. Please try again.'
  if (typeof err === 'string') return err
  return MESSAGES[err.code] || err.message || 'Something went wrong. Please try again.'
}
