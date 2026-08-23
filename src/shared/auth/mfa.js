// ─────────────────────────────────────────────────────────────────────────────
// Multi-factor authentication.
//
// TOTP — an authenticator app — rather than SMS. This app is used on plant
// floors and in warehouses where signal is unreliable, an SMS code that never
// arrives locks someone out of a safety system, and SIM swap defeats it anyway.
// TOTP works offline, costs nothing per login, and every enterprise already
// issues an authenticator.
//
// THE HALF THAT MATTERS MOST IS THE SIGN-IN CHALLENGE, NOT ENROLMENT.
//
// When a second factor is required, Firebase does not return a user — it throws
// `auth/multi-factor-auth-required` carrying a resolver, and sign-in is only
// finished by answering it. An app that does not catch that error shows
// "something went wrong" and the account is unreachable. So switching MFA on in
// the console for an app without this code does not secure it; it locks people
// out. That is why this file exists before anyone enables anything.
//
// Everything here is a thin, testable wrapper over the SDK so the branching
// lives somewhere a test can reach it.
// ─────────────────────────────────────────────────────────────────────────────
import {
  multiFactor,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
} from 'firebase/auth'
import { auth } from '../firebase'

export const MFA_REQUIRED = 'auth/multi-factor-auth-required'
export const NEEDS_RECENT_LOGIN = 'auth/requires-recent-login'

/**
 * Firebase refuses to enrol a second factor on an unverified email, and says so
 * only when you try. That is a reasonable rule — a second factor on an address
 * nobody has proven they own protects the wrong person — but it has to be
 * checked BEFORE offering the button, or the first thing a conscientious admin
 * sees when they try to secure their account is a raw SDK error.
 *
 * This app has never sent a verification email: accounts are created by signup
 * or provisioned by an admin, and nothing has needed a verified address until
 * now. So the security screen has to be able to send one.
 */
export const isEmailVerified = (user) => Boolean(user?.emailVerified)

export const sendVerification = (user) => sendEmailVerification(user)

/** The one error that means "not a failure — an unfinished sign-in". */
export const isMfaRequired = (err) => err?.code === MFA_REQUIRED

/** Enrolling and unenrolling are privileged, so Firebase wants a fresh login. */
export const needsRecentLogin = (err) => err?.code === NEEDS_RECENT_LOGIN

/**
 * The resolver that finishes a challenged sign-in.
 *
 * Deliberately not stored anywhere durable: it is a live handle to a
 * half-completed sign-in, it expires, and writing it to storage would leave a
 * partially-authenticated session lying around.
 */
export const resolverFor = (err) => getMultiFactorResolver(auth, err)

/**
 * Which factors this resolver will accept. Only TOTP is offered today, but the
 * resolver can carry SMS factors enrolled elsewhere, so the right one is picked
 * by looking rather than by assuming index 0.
 */
export function totpHintFrom(resolver) {
  const hints = resolver?.hints || []
  return hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) || null
}

/** Finish a challenged sign-in with a code from the authenticator app. */
export async function completeTotpSignIn(resolver, code) {
  const hint = totpHintFrom(resolver)
  if (!hint) {
    // Enrolled in something this build cannot answer — say so plainly rather
    // than failing with an SDK error nobody can act on.
    throw new Error('This account uses a second factor this app cannot complete. Ask an administrator to reset it.')
  }
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, cleanCode(code))
  return resolver.resolveSignIn(assertion)
}

/** Digits only: authenticator apps display "123 456" and people paste it that way. */
export const cleanCode = (code) => String(code ?? '').replace(/\D/g, '')

export const isCodeComplete = (code) => cleanCode(code).length === 6

/** What the user has enrolled, for the security screen. */
export function enrolledFactors(user) {
  if (!user) return []
  try {
    return multiFactor(user).enrolledFactors || []
  } catch {
    return []
  }
}

/**
 * Begin enrolment: returns the shared secret plus the otpauth:// URI that a QR
 * code is drawn from.
 *
 * The same secret object must be passed back to finishTotpEnrolment — it is not
 * reconstructible from the string, so the caller has to hold it across the two
 * steps.
 */
export async function startTotpEnrolment(user, issuer = 'WEHS') {
  const session = await multiFactor(user).getSession()
  const secret = await TotpMultiFactorGenerator.generateSecret(session)
  const accountName = user.email || user.uid
  return {
    secret,
    // Shown so someone can type it into an app that cannot scan a code.
    sharedSecretKey: secret.secretKey,
    uri: secret.generateQrCodeUrl(accountName, issuer),
  }
}

/** Finish enrolment by proving the app is generating the right codes. */
export async function finishTotpEnrolment(user, secret, code, label = 'Authenticator app') {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, cleanCode(code))
  await multiFactor(user).enroll(assertion, label)
}

/** Remove a factor. Also needs a recent login. */
export async function unenrolFactor(user, factorUid) {
  await multiFactor(user).unenroll(factorUid)
}

/**
 * Re-prove the password before a privileged change.
 *
 * Only for password accounts — an SSO user has no password to re-enter, and
 * Firebase wants the federated credential instead. Callers check `canReauth`
 * first and send SSO users back through their provider.
 */
export async function reauthWithPassword(user, password) {
  const cred = EmailAuthProvider.credential(user.email, password)
  await reauthenticateWithCredential(user, cred)
}

export const canReauthWithPassword = (user) =>
  Boolean(user?.email) && (user?.providerData || []).some((p) => p.providerId === 'password')
