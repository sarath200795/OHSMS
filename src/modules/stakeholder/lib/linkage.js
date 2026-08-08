// ─────────────────────────────────────────────────────────────────────────────
// The join between a customer escalation and a legal issue.
//
// The link is stored once, on the legal issue (`escalationId`), because that is
// the direction it is created in: a complaint exists first and an authority
// turns up afterwards. Storing it on both sides would mean two records that can
// disagree, and they would — someone edits one screen and not the other.
//
// So the escalation's view of its legal issues is DERIVED here rather than
// stored. That costs a pass over the list and buys a link that cannot rot.
//
// Pure: lists in, lists out. No Firestore.
// ─────────────────────────────────────────────────────────────────────────────

import { NOTICE_BY_KEY, SEVERE_NOTICES } from './constants'

const clean = (v) => String(v ?? '').trim()

/** legalIssues grouped by the escalation they came from. */
export function legalByEscalation(legalIssues = []) {
  const map = new Map()
  for (const l of legalIssues) {
    const id = clean(l?.escalationId)
    if (!id) continue
    if (!map.has(id)) map.set(id, [])
    map.get(id).push(l)
  }
  return map
}

/**
 * An escalation with what it turned into.
 *
 * `escalated` is the fact worth surfacing on a list: this complaint did not
 * stay a complaint. A resolved escalation that produced an FIR is not resolved
 * in any sense the business cares about, and a status column alone would say it
 * was.
 */
export function withLegal(escalations = [], legalIssues = []) {
  const byEsc = legalByEscalation(legalIssues)
  return escalations.map((e) => {
    const linked = byEsc.get(clean(e.id)) || []
    const severe = linked.filter((l) => SEVERE_NOTICES.includes(clean(l.noticeType)))
    return {
      ...e,
      legalIssues: linked,
      legalCount: linked.length,
      escalated: linked.length > 0,
      // Open means somebody still has to do something about it.
      openLegal: linked.filter((l) => clean(l.status) !== 'closed').length,
      severeNotices: severe.map((l) => clean(l.noticeType)),
      worstNotice: worstNotice(linked.map((l) => l.noticeType)),
    }
  })
}

/**
 * The most serious notice in a set.
 *
 * Ordered by position in NOTICE_TYPES, which runs least to most serious, so
 * adding a notice type in the right place is all it takes to rank it — there is
 * no second severity table to keep in step.
 */
export function worstNotice(keys = []) {
  const order = Object.keys(NOTICE_BY_KEY)
  let worst = null
  let rank = -1
  for (const k of keys) {
    const i = order.indexOf(clean(k))
    if (i > rank) { rank = i; worst = clean(k) }
  }
  return worst
}

/** A legal issue with the escalation it came from attached, if any. */
export function withEscalation(legalIssues = [], escalations = []) {
  const byId = new Map(escalations.map((e) => [clean(e.id), e]))
  return legalIssues.map((l) => {
    const source = clean(l.escalationId) ? byId.get(clean(l.escalationId)) : null
    return {
      ...l,
      escalation: source || null,
      // A link pointing at a record that no longer exists is worth showing as
      // broken rather than as absent: "no customer complaint" and "the
      // complaint was deleted" are different facts.
      brokenLink: Boolean(clean(l.escalationId)) && !source,
    }
  })
}

/** Headline counts for the overview. */
export function summarise(escalations = [], legalIssues = []) {
  const joined = withLegal(escalations, legalIssues)
  const openEsc = escalations.filter((e) => ['open', 'in_progress'].includes(clean(e.status)))
  const openLegal = legalIssues.filter((l) => clean(l.status) !== 'closed')
  const severe = legalIssues.filter((l) => SEVERE_NOTICES.includes(clean(l.noticeType)))

  return {
    escalations: {
      total: escalations.length,
      open: openEsc.length,
      // The number that matters more than the total: complaints that became a
      // regulatory matter.
      escalatedToLegal: joined.filter((e) => e.escalated).length,
    },
    legal: {
      total: legalIssues.length,
      open: openLegal.length,
      severe: severe.length,
      fromEscalation: legalIssues.filter((l) => clean(l.escalationId)).length,
    },
  }
}

/**
 * Which members appear across escalations, and how often.
 *
 * A member raising their fourth complaint is a different conversation from one
 * raising their first, and nothing on a single record can show that.
 */
export function repeatMembers(escalations = [], minimum = 2) {
  const byMember = new Map()
  for (const e of escalations) {
    for (const m of Array.isArray(e?.members) ? e.members : []) {
      const id = clean(m?.memberId) || clean(m?.name)
      if (!id) continue
      const entry = byMember.get(id) || { memberId: clean(m.memberId), name: clean(m.name), count: 0, escalationIds: [] }
      entry.count += 1
      entry.escalationIds.push(e.id)
      if (!entry.name && clean(m.name)) entry.name = clean(m.name)
      byMember.set(id, entry)
    }
  }
  return [...byMember.values()].filter((m) => m.count >= minimum).sort((a, b) => b.count - a.count)
}
