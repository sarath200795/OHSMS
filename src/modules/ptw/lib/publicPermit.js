import { STATUS, derivePermitStatus } from './permitStatus'

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
  return isTerminal(derivePermitStatus(permit, now)) ? withdrawnFields() : liveFields(permit)
}
