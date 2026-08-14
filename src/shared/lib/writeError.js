/**
 * What to tell someone when a write did not land.
 *
 * "You do not have permission" and "your connection dropped" are the same event
 * from the UI's point of view — a rejected promise — and they were being
 * reported interchangeably. They are opposite instructions: one means stop and
 * find an administrator, the other means try again in a minute. A bulk import
 * that failed because the office wifi went down told the person running it they
 * were not allowed to do their job, and they believed it.
 *
 * Firestore's own message for a transport failure names a WebChannel stream,
 * which tells a safety officer nothing at all.
 */

// Codes Firestore raises when it could not reach the server, as opposed to
// reaching it and being refused.
const OFFLINE_CODES = ['unavailable', 'deadline-exceeded', 'cancelled', 'aborted']

const isOfflineText = (s) =>
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|Failed to fetch|transport errored|network error/i.test(s)

/**
 * `online` is injected rather than read from navigator so this stays testable
 * and so a caller can pass what it actually knows. navigator.onLine is only
 * ever trustworthy when it says FALSE — true merely means an interface is up,
 * which a captive portal or a dead DNS resolver also satisfies.
 */
export function writeErrorMessage(err, { online = true, action = 'save' } = {}) {
  const code = String(err?.code || '')
  const text = String(err?.message || '')

  if (!online || OFFLINE_CODES.includes(code) || isOfflineText(text)) {
    return `Could not ${action} — your connection dropped before this reached the server. Nothing was lost; try again once you are back online.`
  }

  if (code === 'permission-denied') {
    return `You do not have permission to ${action} this. If that is unexpected, ask an administrator to check your role and site access.`
  }

  if (code === 'resource-exhausted') {
    return `Could not ${action} — too many writes at once. Wait a moment and try again.`
  }

  return text || `Could not ${action}.`
}

/** True when this failure means "try again", not "you are not allowed". */
export function isTransient(err, { online = true } = {}) {
  return !online
    || OFFLINE_CODES.includes(String(err?.code || ''))
    || isOfflineText(String(err?.message || ''))
}
