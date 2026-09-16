/**
 * Was this failure Firestore (or a callable) refusing the caller?
 *
 * Expected on a live session: a module the org is not licensed for, a
 * collection the role cannot list, a site the viewer cannot see. Those are
 * access checks, not faults — treating them as errors is how a portal page
 * painted "could not be loaded" in amber every time a licensed-off module's
 * collection was still subscribed, and how HIRA toasted "You don't have access"
 * on an ordinary member opening the module.
 */
export function isPermissionDenied(err) {
  if (err == null) return false
  const code = String(err?.code || '')
  if (
    code === 'permission-denied' ||
    code === 'functions/permission-denied' ||
    code.endsWith('/permission-denied')
  ) {
    return true
  }
  return /missing or insufficient permissions|PERMISSION_DENIED/i.test(String(err?.message || err))
}
