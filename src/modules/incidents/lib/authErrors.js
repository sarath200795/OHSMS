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
  'auth/network-request-failed': "Couldn't reach the sign-in service. This is usually a VPN, antivirus HTTPS scanning, an ad-blocker, or a network firewall. Run the connection check below for details.",
}

// True when the error is the "can't reach Google" network failure — the auth
// pages use this to surface the connection-check banner.
export function isNetworkError(err) {
  return err?.code === 'auth/network-request-failed'
}

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong.'
  if (err.code && MAP[err.code]) return MAP[err.code]
  return err.message || 'Something went wrong.'
}
