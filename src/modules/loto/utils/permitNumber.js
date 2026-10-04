import { PERMIT_PREFIX } from '../constants/permits'

/** LP-2026-0007. Four digits minimum; wider sequences simply grow. */
export function formatPermitNo(year, seq) {
  const y = Math.floor(Number(year))
  const n = Math.floor(Number(seq))
  if (!(y >= 2000 && y <= 9999) || !(n >= 1)) throw new Error('A permit number needs a year and a positive sequence')
  return `${PERMIT_PREFIX}-${y}-${String(n).padStart(4, '0')}`
}

/** { year, seq } for a well-formed permit number, otherwise null. */
export function parsePermitNo(permitNo) {
  const m = /^LP-(\d{4})-(\d{4,})$/.exec(String(permitNo || ''))
  if (!m) return null
  return { year: Number(m[1]), seq: Number(m[2]) }
}

/**
 * The counter document a year's numbers come from: docSeq/lotoPermit-<year>.
 * One counter per year makes the number restart each January with no job
 * running, and the generic docSeq rule (strictly increasing, `{ n }` only)
 * already protects it.
 */
export const permitSeqKind = (year) => `lotoPermit-${Math.floor(Number(year))}`

/**
 * The year the SERVER will see. Rules compare the number against
 * request.time.year(), which is UTC, so the client must use UTC too — local
 * time would disagree for five and a half hours around New Year in India and
 * the first permit of the year would be refused.
 */
export const permitYearNow = (now = new Date()) => now.getUTCFullYear()
