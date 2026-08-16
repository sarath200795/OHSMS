import { STATUS, derivePermitStatus, effectiveValidTo } from './permitStatus'

/**
 * What a scanned permit QR tells a stranger.
 *
 * The mirror published the crew: every participant's name and employer, the
 * fire watchers, the confined-space watcher and whoever raised the permit — to
 * an unauthenticated URL, for the life of the job and then forever after it.
 * Anyone who photographed the code at the barrier kept indefinite access to who
 * was on that crew and who they work for.
 *
 * The LOTO mirror had already answered this: publish WHETHER, not WHO. Someone
 * standing at a barrier needs to know the work is authorised, what it is, what
 * the hazards are, who holds the permit, and until when. They do not need the
 * roster. So the crew becomes counts — the count is the safety-relevant fact
 * ("four people are meant to be in there") and carries no identity.
 *
 * issuedToName stays. It is the one name that does work on a public page:
 * challenging the job means asking whether the person in front of you is the
 * person the permit was issued to, and the physical permit at the barrier
 * carries it anyway.
 */

/** Statuses after which the job is over and the detail should stop being served. */
export const TERMINAL_STATUSES = [STATUS.CLOSED, STATUS.CLOSED_NONCOMPLIANCE]

export const isTerminal = (status) => TERMINAL_STATUSES.includes(status)

/**
 * How long an EXPIRED permit keeps serving its detail.
 *
 * Expiry is deliberately not terminal: a permit that lapsed while work carried
 * on is exactly the one a person at the barrier should be able to read and
 * challenge, and blanking it would remove the means to do that. That reasoning
 * is sound and it is why `isTerminal` does not include NOT_CLOSED.
 *
 * But it is an argument with a clock in it. Somebody may need to challenge
 * yesterday's lapsed permit; nobody needs to challenge one from 2023. The
 * reasoning was written without a bound, so in practice the detail — the job,
 * the location, the hazards, and the name it was issued to — stayed on an
 * unauthenticated URL forever, for exactly the permits nobody ever came back to
 * close. The failure selected for neglect: a permit closed properly was
 * withdrawn, and one everybody forgot was published indefinitely.
 *
 * A week covers any plausible challenge and ends the indefinite half.
 */
export const STALE_AFTER_DAYS = 7

/**
 * Has an expired permit outlived the window in which challenging it makes sense?
 *
 * Uses the EFFECTIVE end date, so an approved extension moves the clock — a
 * permit extended to Friday is not stale on Wednesday.
 *
 * A permit with no usable end date is never stale. That is the safe direction:
 * such a permit is treated as in-progress everywhere else, and withdrawing the
 * detail of something the system still considers live would remove a barrier
 * check on live work to fix a privacy problem it does not have.
 */
export function isStale(permit = {}, now = Date.now(), days = STALE_AFTER_DAYS) {
  const to = effectiveValidTo(permit)
  const end = to ? Date.parse(to) : NaN
  if (Number.isNaN(end)) return false
  return now > end + days * 24 * 60 * 60 * 1000
}

/** The crew, as counts. */
export function crewSummary(permit = {}) {
  const participants = Array.isArray(permit.participants) ? permit.participants : []
  const fireWatchers = Array.isArray(permit.fireWatchers) ? permit.fireWatchers : []
  return {
    participantCount: participants.length,
    fireWatcherCount: fireWatchers.length,
    hasConfinedWatcher: Boolean(permit.confinedWatcher),
  }
}

/**
 * The fields withdrawn once a permit reaches a terminal state.
 *
 * Blanked rather than deleted, and merged over the existing document, because
 * the mirror is updated with merge:true from a path that does not carry the
 * orgId a full replace would need for the security rule. Blanking achieves the
 * same thing: nothing describing the job survives the job.
 *
 * The permit number, site, type and status stay. A scan after the fact should
 * say "this permit is closed" — not 404, which reads as "wrong code" and sends
 * someone looking for a permit that did its job properly.
 */
export function withdrawnFields() {
  return {
    jobDescription: '',
    jobLocation: '',
    issuingDepartment: '',
    issuedToName: '',
    hazards: [],
    ppe: [],
    precautions: [],
    jsa: [],
    participantCount: 0,
    fireWatcherCount: 0,
    hasConfinedWatcher: false,
    withdrawn: true,
  }
}

/** The display half of the mirror for a permit that is still live. */
export function liveFields(permit = {}) {
  return {
    typeOfWork: permit.typeOfWork || '',
    jobLocation: permit.jobLocation || '',
    jobDescription: permit.jobDescription || '',
    issuingDepartment: permit.issuingDepartment || '',
    issuedToName: permit.issuedToName || '',
    hazards: permit.hazards || [],
    ppe: permit.ppe || [],
    precautions: permit.precautions || [],
    jsa: permit.jsa || [],
    ...crewSummary(permit),
    withdrawn: false,
  }
}

/**
 * Which half to write, given the permit's state right now.
 *
 * Used by the update path, which merges — so a permit that closes has its
 * detail actively blanked rather than left behind by a merge that only ever
 * touched the status fields. That was the "never withdrawn" half of the
 * finding: the status went to Closed and everything else stayed exactly where
 * it was.
 */
export function mirrorDisplayFields(permit = {}, now = Date.now()) {
  const over = isTerminal(derivePermitStatus(permit, now)) || isStale(permit, now)
  return over ? withdrawnFields() : liveFields(permit)
}
