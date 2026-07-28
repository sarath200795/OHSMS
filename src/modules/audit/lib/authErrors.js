// Maps Firebase Auth error codes to friendly, human-readable messages.
const MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled. Contact your admin.',
  'auth/user-not-found': 'No account found with those details.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists for this email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests':
    'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed':
    'Network error. Check your connection and try again.',
  'auth/operation-not-allowed':
    'Email/password sign-in is not enabled for this project.',
  'auth/requires-recent-login':
    'Please sign in again before making this change.',
}

export function friendlyAuthError(error) {
  if (!error) return 'Something went wrong. Please try again.'
  const code = typeof error === 'string' ? error : error.code
  return (
    MESSAGES[code] ||
    error.message?.replace('Firebase: ', '') ||
    'Something went wrong. Please try again.'
  )
}
