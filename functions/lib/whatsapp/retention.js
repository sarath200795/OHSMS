// ─────────────────────────────────────────────────────────────────────────────
// How long the WhatsApp collections keep anything.
//
//   waQueryLog   90 days. Enough to answer "who looked at what" for an audit
//                quarter; long enough to spot abuse; no longer, because each
//                row ties a person to a site at a time.
//   waInbound     7 days past its own expiresAt stamp. Meta retries for at most
//                a few days; a dedupe ledger older than that dedupes nothing.
//   waLinkCodes  as soon as the code has expired (ten minutes).
//   waRate        3 days without activity. The counters are hour and day
//                windows; a dormant row holds nothing a limit still needs.
//
// waLinks is NOT here: a link lives until the user unlinks (STOP / UNLINK or
// the Security page) or an erasure request removes it. waSiteSnapshots holds no
// personal data and is overwritten every half hour.
// ─────────────────────────────────────────────────────────────────────────────
export const DAY_MS = 24 * 60 * 60 * 1000

export const WA_RETENTION = [
  { collection: 'waQueryLog', field: 'at', keepMs: 90 * DAY_MS, kind: 'timestamp' },
  { collection: 'waInbound', field: 'expiresAt', keepMs: 0, kind: 'timestamp' },
  { collection: 'waLinkCodes', field: 'expiresAtMs', keepMs: 0, kind: 'millis' },
  { collection: 'waRate', field: 'updatedAt', keepMs: 3 * DAY_MS, kind: 'timestamp' },
]

export const WA_PURGE_BATCH = 400
export const WA_PURGE_MAX_BATCHES = 25

/** The instant before which a row of `entry` is deleted. */
export function cutoffFor(entry, now = new Date()) {
  return new Date(now.getTime() - entry.keepMs)
}
