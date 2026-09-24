// Private Email rejects a burst with
// 554 5.7.1 Reject: too many messages from sender in last 60 minutes
// on mail.privateemail.com. The ledger used to store that refusal as
// status:failed, and the next delivery treats any existing row as already
// sent. The message was not accepted, so that claim must not stick.
//
// Sends stay serial. A short gap stops a fan-out opening a socket per
// recipient in the same second, which is what trips the cap when several
// people share one mailbox's hourly quota. The gap cannot spread a
// 60-minute quota across the function's own timeout, so a refusal stops
// the rest of the list instead of claiming them as failed.
//
// Vitest sets VITEST. The suite mails several recipients per case, and a
// real gap would spend a second on each. Production does not set VITEST.
// A test that wants to observe the gap passes gapMs itself.

export const MAIL_SEND_GAP_MS = 1000
export const MAIL_RATE_LIMIT_BACKOFF_MS = 5000
export const MAIL_RATE_LIMIT_RETRIES = 1

/** The Private Email hourly refusal. A bare 554 is some other reject. */
export function isSmtpRateLimit(err) {
  if (!err || typeof err !== 'object') return false
  const text = `${err.response || ''} ${err.message || ''}`.toLowerCase()
  return text.includes('too many messages')
}

export function fanoutGapMs(explicit) {
  if (typeof explicit === 'number' && explicit >= 0) return explicit
  if (process.env.VITEST) return 0
  return MAIL_SEND_GAP_MS
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One recipient, then a backoff retry when Private Email refused the burst.
 * `stop` means the claim was released and the caller must not claim anyone
 * further down the list.
 */
export async function sendPaced({ attempt, sleep, gapMs, first }) {
  const wait = typeof sleep === 'function' ? sleep : defaultSleep
  const gap = fanoutGapMs(gapMs)
  if (!first && gap > 0) await wait(gap)
  let result = await attempt()
  for (let n = 1; result?.reason === 'rate-limited' && n <= MAIL_RATE_LIMIT_RETRIES; n += 1) {
    await wait(MAIL_RATE_LIMIT_BACKOFF_MS * n)
    result = await attempt()
  }
  return { result, stop: result?.reason === 'rate-limited' }
}
