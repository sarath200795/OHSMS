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

  // ── Second factor ──────────────────────────────────────────────────────────
  // A wrong code is the common case and must not read like a broken account —
  // codes rotate every 30 seconds and people routinely submit a stale one.
  'auth/invalid-verification-code': 'That code is not right. Check your authenticator app and try the current code.',
  'auth/missing-code': 'Enter the 6-digit code from your authenticator app.',
  'auth/code-expired': 'That code has expired. Enter the current one from your app.',
  'auth/totp-challenge-timeout': 'That took too long. Sign in again to get a fresh challenge.',
  'auth/second-factor-already-in-use': 'That authenticator is already enrolled on this account.',
  'auth/maximum-second-factor-count-exceeded': 'You have enrolled the maximum number of devices. Remove one first.',
  'auth/unsupported-first-factor': 'Two-factor cannot be added to this sign-in method.',
  'auth/requires-recent-login': 'For your security, please confirm your password and try again.',
  'auth/unverified-email': 'Verify your email address before turning on two-factor authentication.',

  // ── Single sign-on ─────────────────────────────────────────────────────────
  // The provider-id mistakes are the ones an operator will actually hit, and
  // the default message for them is unreadable.
  'auth/invalid-provider-id': 'That single sign-on provider is not configured for this project.',
  'auth/operation-not-supported-in-this-environment': 'This browser cannot complete single sign-on here.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups, or try again to be redirected.',
  'auth/unauthorized-domain': 'This address is not authorised for single sign-on. Ask an administrator to add it.',
  'auth/account-exists-with-different-credential':
    'An account with that email already exists using a different sign-in method. Sign in that way instead.',
}

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong. Please try again.'
  if (typeof err === 'string') return err
  return MESSAGES[err.code] || err.message || 'Something went wrong. Please try again.'
}
