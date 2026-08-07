// Map Firebase Auth error codes to friendly, actionable messages.
const MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
  // Deliberately identical to the wrong-password message. Saying "no account
  // found" tells an attacker which addresses are real, one guess at a time, and
  // for a workplace app those addresses are the staff list. Firebase's own
  // email-enumeration protection collapses these two codes when it is switched
  // on, but that is a console setting this repo cannot enforce — so do not
  // depend on it being on.
  'auth/user-not-found': 'Incorrect email or password.',
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
