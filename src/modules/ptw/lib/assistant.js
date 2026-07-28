// ─────────────────────────────────────────────────────────────────────────────
// Permit to Work Safety Bot ("Sam") — rule-based insight engine. Pure functions
// over the live org data (no LLM): per-page tips, suggested questions, and a
// scored-intent answer() that understands free-typed questions and reports
// counts/examples from permits, approvals, expiries, observations, sites, work
// types and the team. Falls back to a server-side AI proxy (askAI) only when no
// rule matches. Guidance is tailored to permit-to-work and cites HSE HSG250.
// ─────────────────────────────────────────────────────────────────────────────
import { derivePermitStatus, effectiveValidTo, isRejected, statusMeta, STATUS } from './permitStatus'

const HSE =
  'See HSE permit-to-work guidance (HSG250): https://www.hse.gov.uk/pubns/books/hsg250.htm.'

const pageOf = (pathname = '') => {
  if (pathname.includes('/permits/new')) return 'create'
  if (/\/permits\/[^/]+$/.test(pathname) && !pathname.endsWith('/permits')) return 'detail'
  if (pathname.includes('/permits')) return 'permits'
  if (pathname.includes('/approvals')) return 'approvals'
  if (pathname.includes('/observations')) return 'observations'
  if (pathname.includes('/sites')) return 'sites'
  if (pathname.includes('/users')) return 'users'
  if (pathname.includes('/audit')) return 'audit'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'Your live permit overview. Use the Site filter to focus the KPIs and charts.',
      '“In Progress / Extended / Not Closed” show what is live or lapsed right now.',
      'Safety observations track Safe vs Unsafe — an unsafe one closes a permit for non-compliance.',
    ],
  },
  permits: {
    title: 'Permits',
    tips: [
      'Every permit with its live status. Filter by status, work type or site, or search.',
      'Each row carries a QR — scan it on site to open the live permit and log an observation.',
      'Click a permit to view details, approve, extend, close, or print it.',
    ],
  },
  create: {
    title: 'New Permit',
    tips: [
      'Pick the work type — it seeds the right PPE, precautions and required documents.',
      'Complete the JSA (at least one step + hazard + precaution) — it is mandatory.',
      'Add participants, and a fire watcher (hot work) or standby attendant (confined space).',
      'It is raised as Draft and needs BOTH Engineering and Operations to approve.',
    ],
  },
  detail: {
    title: 'Permit',
    tips: [
      'Approvals from Engineering AND Operations are needed before work may begin.',
      'Request an extension if the 8-hour window will run out, then close it when done.',
      'Print/PDF carries the status watermark; the QR opens the public view.',
    ],
  },
  approvals: {
    title: 'Approvals',
    tips: [
      'Permits awaiting YOUR team’s decision appear here — approve or reject with a note.',
      'A permit goes live only when both Engineering and Operations approve.',
    ],
  },
  observations: {
    title: 'Observations',
    tips: [
      'Safety observations logged via QR scan or in-app, filterable Safe / Unsafe.',
      'An Unsafe observation immediately closes its permit for non-compliance.',
    ],
  },
  sites: { title: 'Sites', tips: ['Add your work sites — they power the Site dropdown on permits and the dashboard filter.'] },
  users: { title: 'Users', tips: ['Approve members and assign a role: Engineering, Operations or Technician.'] },
  audit: { title: 'Audit Log', tips: ['A permanent record of every permit action across your organization.'] },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}


const COMMON_QS = ['Give me a summary', 'What needs my attention?', "What's expired?"]
const PAGE_QS = {
  dashboard: ['Daily update', 'How many pending approval?', 'Which site is busiest?'],
  permits: ['Daily update', "What's in progress?", "What's expired?"],
  create: ['What PPE do I need for hot work?', 'What is a JSA?', 'When can work begin?'],
  detail: ['How do I extend a permit?', 'Who needs to approve?'],
  approvals: ['What needs my approval?', 'How many pending?'],
  observations: ['How many unsafe observations?', 'Recent observations?'],
  sites: ['Which site is busiest?', 'How many sites?'],
  users: ['How many on each team?'],
}
export function suggestedQuestions(pathname) {
  const p = pageOf(pathname)
  return [...(PAGE_QS[p] || []), ...COMMON_QS].slice(0, 5)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const list = (names, n = 3) => {
  const shown = names.slice(0, n)
  const extra = names.length - shown.length
  return shown.join(', ') + (extra > 0 ? ` and ${extra} more` : '')
}
function timeAgo(ts) {
  try {
    const d = ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null
    if (!d || Number.isNaN(d.getTime())) return ''
    const s = Math.floor((Date.now() - d.getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  } catch {
    return ''
  }
}

const hit = (text) => ({ text, matched: true })
const miss = (text) => ({ text, matched: false })
const nav = (text, to) => ({ text, matched: true, action: { type: 'navigate', to } })

const statusOf = (p) => p.status || derivePermitStatus(p)
const permitLabel = (p) => `${p.permitNo}${p.typeOfWork ? ` (${p.typeOfWork})` : ''}${p.site ? ` · ${p.site}` : ''}`

const isActive = (s) => s === STATUS.IN_PROGRESS || s === STATUS.EXTENDED || s === STATUS.EXTENDED_IN_PROGRESS
const isExtended = (s) => s === STATUS.EXTENDED || s === STATUS.EXTENDED_IN_PROGRESS

// ── Date helpers ─────────────────────────────────────────────────────────────
function toDate(ts) {
  if (!ts) return null
  if (typeof ts === 'object' && ts.seconds) return new Date(ts.seconds * 1000)
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d
}
const sameDay = (a, b) => Boolean(a && b && a.toDateString() === b.toDateString())
const fmtDateTime = (v) => { const d = toDate(v); return d ? d.toLocaleString() : '—' }
const fmtDate = (v) => { const d = toDate(v); return d ? d.toLocaleDateString() : '—' }
function remainingText(permit, now = Date.now()) {
  const to = Date.parse(effectiveValidTo(permit))
  if (Number.isNaN(to)) return '—'
  const ms = to - now
  if (ms <= 0) return 'time elapsed'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${String(m).padStart(2, '0')}m left`
}
const decisionDate = (block) => toDate(block?.at)
function approvedAt(p) {
  if (!(p.engineering?.status === 'approved' && p.operations?.status === 'approved')) return null
  const a = decisionDate(p.engineering); const b = decisionDate(p.operations)
  return a && b ? (a > b ? a : b) : (a || b)
}
function closedAt(p) {
  const c = p.closure
  if (!(c && c.engineering?.status === 'approved' && c.operations?.status === 'approved')) return null
  const a = decisionDate(c.engineering); const b = decisionDate(c.operations)
  return a && b ? (a > b ? a : b) : (a || b)
}

// ── Full permit details (for "details of <permit no>") ───────────────────────
function permitDetail(p, observations = []) {
  const meta = statusMeta(statusOf(p))
  const myObs = observations.filter((o) => o.permitId === p.id)
  const dec = (b) => `${b?.status || 'pending'}${b?.byName ? ` by ${b.byName}` : ''}`
  const lines = [
    `📋 ${p.permitNo} — ${meta.label}`,
    `Type: ${p.typeOfWork || '—'}${p.site ? ` · Site: ${p.site}` : ''}`,
    `Location: ${p.jobLocation || '—'}`,
    `Issued to: ${p.issuedToName || '—'}${p.issuedToPhone ? ` (${p.issuedToPhone})` : ''}`,
    `Valid: ${fmtDateTime(p.validFrom)} → ${fmtDateTime(p.validTo)} (${remainingText(p)})`,
    `Approvals — Engineering: ${dec(p.engineering)}; Operations: ${dec(p.operations)}`,
  ]
  if (p.extension) lines.push(`Extension: Eng ${p.extension.engineering?.status || 'pending'}, Ops ${p.extension.operations?.status || 'pending'}${p.extension.newValidTo ? ` → ${fmtDateTime(p.extension.newValidTo)}` : ''}`)
  if (p.closure) lines.push(`Closure: Eng ${p.closure.engineering?.status || 'pending'}, Ops ${p.closure.operations?.status || 'pending'}`)
  if (p.closedDueToObservation) lines.push(`⛔ Closed for non-compliance${p.closedDueToObservation.note ? ` — ${p.closedDueToObservation.note}` : ''}`)
  lines.push(`Hazards: ${(p.hazards || []).length ? list(p.hazards, 5) : 'none'}`)
  lines.push(`PPE ${(p.ppe || []).length} · Precautions ${(p.precautions || []).length} · JSA ${(p.jsa || []).length} step(s)`)
  const extras = []
  if ((p.participants || []).length) extras.push(`${p.participants.length} participant(s)`)
  if ((p.fireWatchers || []).length) extras.push(`fire watcher: ${p.fireWatchers.map((w) => w.name).join(', ')}`)
  if (p.confinedWatcher?.name) extras.push(`attendant: ${p.confinedWatcher.name}`)
  if (extras.length) lines.push(extras.join(' · '))
  if (myObs.length) lines.push(`Observations: ${myObs.filter((o) => o.type === 'safe').length} safe, ${myObs.filter((o) => o.type === 'unsafe').length} unsafe`)
  lines.push(`Raised by ${p.createdByName || '—'}${p.createdAt ? ` on ${fmtDate(p.createdAt)}` : ''}`)
  return lines.join('\n')
}

// ── Daily update / day-wise status digest ────────────────────────────────────
export function dailyDigest({ permits = [], observations = [], approvalQueue = [] }, now = new Date()) {
  const raised = permits.filter((p) => sameDay(toDate(p.createdAt), now))
  const approvedToday = permits.filter((p) => sameDay(approvedAt(p), now))
  const closedToday = permits.filter((p) => sameDay(closedAt(p), now) || (p.closedDueToObservation && sameDay(toDate(p.closedDueToObservation.at), now)))
  const obsToday = observations.filter((o) => sameDay(toDate(o.at), now))
  const unsafeToday = obsToday.filter((o) => o.type === 'unsafe').length

  let inProg = 0; let awaiting = 0; let expired = 0
  permits.forEach((p) => {
    const s = statusOf(p)
    if (s === STATUS.IN_PROGRESS || isExtended(s)) inProg++
    else if (s === STATUS.NOT_CLOSED) expired++
    else if (s === STATUS.DRAFT && !isRejected(p)) awaiting++
  })

  // Day-wise raised over the last 7 days.
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    const n = permits.filter((p) => sameDay(toDate(p.createdAt), d)).length
    days.push(`${d.toLocaleDateString(undefined, { weekday: 'short' })} ${n}`)
  }

  return [
    `📅 Daily update — ${now.toLocaleDateString()}`,
    `Today: ${raised.length} raised, ${approvedToday.length} approved, ${closedToday.length} closed, ${obsToday.length} observation(s)${unsafeToday ? ` (${unsafeToday} unsafe)` : ''}.`,
    `Right now: ${inProg} in progress, ${awaiting} awaiting approval (${approvalQueue.length} need yours), ${expired} expired needing action.`,
    `Raised (last 7 days): ${days.join(', ')}.`,
  ].join('\n')
}

/** Aggregate the live data into the figures the bot reasons over. */
export function buildStats({ permits = [], observations = [], users = [], sites = [] }) {
  const byStatus = { draft: 0, rejected: 0, in_progress: 0, extended: 0, not_closed: 0, closed: 0 }
  const bySite = {}
  const byType = {}
  permits.forEach((p) => {
    const s = statusOf(p)
    if (s === STATUS.CLOSED || s === STATUS.CLOSED_NONCOMPLIANCE) byStatus.closed += 1
    else if (s === STATUS.NOT_CLOSED) byStatus.not_closed += 1
    else if (isExtended(s)) byStatus.extended += 1
    else if (s === STATUS.IN_PROGRESS) byStatus.in_progress += 1
    else if (isRejected(p)) byStatus.rejected += 1
    else byStatus.draft += 1
    const site = p.site || 'Unspecified'
    bySite[site] = (bySite[site] || 0) + 1
    const t = p.typeOfWork || 'Other'
    byType[t] = (byType[t] || 0) + 1
  })
  const role = (r) => users.filter((u) => u.role === r && u.status === 'approved').length
  return {
    total: permits.length,
    byStatus,
    awaitingApproval: byStatus.draft,
    siteBreakdown: Object.entries(bySite).sort((a, b) => b[1] - a[1]),
    typeBreakdown: Object.entries(byType).sort((a, b) => b[1] - a[1]),
    sites: (sites || []).slice(),
    obs: {
      safe: observations.filter((o) => o.type === 'safe').length,
      unsafe: observations.filter((o) => o.type === 'unsafe').length,
      total: observations.length,
    },
    team: { admin: role('admin'), engineering: role('engineering'), operations: role('operations'), technician: role('technician'), pending: users.filter((u) => u.status === 'pending').length },
  }
}

const expiredList = (permits) => permits.filter((p) => statusOf(p) === STATUS.NOT_CLOSED)
const activeList = (permits) => permits.filter((p) => isActive(statusOf(p)))
const pendingList = (permits) => permits.filter((p) => statusOf(p) === STATUS.DRAFT && !isRejected(p))

// Concise permit-to-work / safety guidance, citing HSE. null when unrecognised.
function guidanceAnswer(qn) {
  if (qn.includes('hierarch') || qn.includes('control measure') || qn.includes('types of control'))
    return `Use the hierarchy of controls — Eliminate, Substitute, Engineering controls, Administrative controls, then PPE — and exhaust the higher levels before relying on PPE. ${HSE}`
  if (qn.includes('confined'))
    return `Confined space entry: test the atmosphere (O₂ 19.5–23.5%, plus LEL and toxic gases) before and during entry, force-ventilate, post a standby attendant outside with comms, and have a rescue plan and breathing apparatus ready. (HSE L101 / INDG258.) ${HSE}`
  if (qn.includes('hot work') || qn.includes('welding') || qn.includes('grinding') || qn.includes('fire watch'))
    return `Hot work: clear combustibles, screen sparks, gas/LEL test where flammables may be present, keep firefighting kit on hand and a fire watch on station — and maintain the fire watch for at least 30 minutes (up to 60) after work finishes. (HSE INDG297.) ${HSE}`
  if (qn.includes('height') || qn.includes('fall') || qn.includes('scaffold') || qn.includes('ladder') || qn.includes('harness'))
    return `Work at height: avoid it where you can; otherwise use inspected access (scaffold/MEWP), guardrails or a full harness to a sound anchor, exclusion zones for dropped objects, and don't work in high wind or poor visibility. (Work at Height Regulations 2005.) ${HSE}`
  if (qn.includes('excavat') || qn.includes('dig') || qn.includes('buried') || qn.includes('trench'))
    return `Excavation: locate buried services first (drawings + CAT-scan, hand-dig trial holes), support or batter the sides against collapse, provide safe access, and inspect daily. (HSE HSG185.) ${HSE}`
  if (qn.includes('electric') || qn.includes('isolat') || qn.includes('loto') || qn.includes('lockout') || qn.includes('live work'))
    return `Electrical work: work dead wherever possible — safely isolate, lock-off and tag, prove dead with an approved voltage tester, and use a competent/authorised person. (Electricity at Work Regulations 1989.) ${HSE}`
  if (qn.includes('jsa') || qn.includes('job safety') || qn.includes('risk assessment') || qn.includes('hira'))
    return `A Job Safety Analysis breaks the task into steps, names the hazard at each step, and assigns a control/precaution for it — complete it with the crew before work starts and keep it with the permit. ${HSE}`
  if (qn.includes('ppe'))
    return `PPE is the last line of defence — pick it for the specific hazard (welding shield for hot work, full harness for height, breathing apparatus for confined space) after higher-level controls are in place. ${HSE}`
  if ((qn.includes('what is') || qn.includes('whats') || qn.includes('explain')) && (qn.includes('permit') || qn.includes('ptw')))
    return `A permit to work is a formal, documented authorisation for high-risk work. It records the hazards, the controls/precautions, who may do it and for how long, and needs sign-off before work starts and again on completion. ${HSE}`
  if (qn.includes('extend') || qn.includes('extension'))
    return `If the 8-hour window will run out, open the permit and Request Extension (reason + a new end time). Both Engineering and Operations must approve it before the permit is valid again. ${HSE}`
  if (qn.includes('how') && (qn.includes('close') || qn.includes('closing')))
    return `When the work is finished, open the permit and Request Closure — both Engineering and Operations approve the closure and the status becomes Closed. ${HSE}`
  return null
}

function closest(qn, names = []) {
  const qset = new Set(qn.split(' ').filter((w) => w.length > 2))
  let best = null
  let bestScore = 0
  for (const n of names) {
    if (!n) continue
    const nt = norm(n).split(' ').filter((w) => w.length > 2)
    let s = 0
    for (const w of nt) if (qset.has(w)) s++
    if (qn.includes(norm(n)) && norm(n).length > 2) s += 3
    if (s > bestScore) { bestScore = s; best = n }
  }
  return bestScore > 0 ? best : null
}

/**
 * Answer a free-typed question from the live data context.
 * ctx = { permits, observations, users, sites, approvalQueue, profile, pathname }
 */
export function answer(question, ctx) {
  const { permits = [], observations = [], approvalQueue = [], pathname } = ctx || {}
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your permits — try “give me a summary” or “what needs my attention?”.')
  const tokens = new Set(qn.split(' '))
  const stats = buildStats(ctx || {})

  // ── 0. Navigation intents ──────────────────────────────────────────────────
  if (/\b(create|new|raise|start|make|begin|add)\b/.test(qn) && (qn.includes('permit') || qn.includes('ptw')))
    return nav('Sure — opening the New Permit form for you. 👷', '/permits/new')
  if (qn.includes('observation') && /\b(open|show|go|view|see)\b/.test(qn))
    return nav('Opening Observations.', '/permits/observations')
  if (qn.includes('approval') && /\b(open|show|go|view|see)\b/.test(qn))
    return nav('Opening Approvals.', '/permits/approvals')

  // Permit lookup → full details. Given a permit ID/number we always return the
  // full breakdown. A bare sequence number ("42") needs a detail-ish word so it
  // doesn't hijack questions like "last 7 days".
  const byFullNo = permits.find((p) => p.permitNo && qn.includes(norm(p.permitNo)))
  const detailWord = /detail|details|show|about|tell|info|status|give me|open|look up|lookup|permit/.test(qn)
  const bySeq = permits.find((p) => {
    const seq = (p.permitNo || '').split('-').pop()
    return seq && (tokens.has(seq) || tokens.has(String(Number(seq))))
  })
  const byLoc = permits.find((p) => p.jobLocation && norm(p.jobLocation).length >= 4 && qn.includes(norm(p.jobLocation)))
  const lookup = byFullNo || (detailWord && (bySeq || byLoc))
  if (lookup) return hit(permitDetail(lookup, observations))

  // ── 1. Scored intent registry ──────────────────────────────────────────────
  const INTENTS = [
    {
      // General permit-to-work / safety guidance — must win its topics
      keywords: ['hierarch', 'control measure', 'types of control', 'confined', 'hot work', 'welding', 'grinding', 'fire watch', 'height', 'fall', 'scaffold', 'ladder', 'harness', 'excavat', 'dig', 'buried', 'trench', 'electric', 'isolat', 'loto', 'lockout', 'live work', 'jsa', 'job safety', 'risk assessment', 'hira', 'ppe', 'what is permit', 'what is ptw', 'how do i extend', 'how to extend', 'how to close', 'guidance', 'best practice', 'hse'],
      run: () => guidanceAnswer(qn) || `For permit-to-work best practice, ${HSE}`,
    },
    {
      // Daily update / day-wise status digest
      keywords: ['daily update', 'daily', 'day wise', 'day-wise', 'today', 'todays', "today's", 'daily status', 'daily report', 'digest', 'this week', 'last 7 days', 'happened today', 'update for today'],
      run: () => dailyDigest(ctx || {}),
    },
    {
      keywords: ['attention', 'what should i', 'what do i do', 'what next', 'priorit', 'focus', 'urgent', 'where do i start', 'recommend', 'advice'],
      run: () => {
        const parts = []
        if (approvalQueue.length) parts.push(`${parts.length + 1}) ${approvalQueue.length} permit(s) awaiting YOUR approval — open Approvals.`)
        const ex = expiredList(permits)
        if (ex.length) parts.push(`${parts.length + 1}) ${ex.length} expired (Not Closed) — request an extension or close: ${list(ex.map((p) => p.permitNo), 2)}.`)
        const unsafe = observations.filter((o) => o.type === 'unsafe').length
        if (unsafe) parts.push(`${parts.length + 1}) ${unsafe} unsafe observation(s) closed permits for non-compliance — review them.`)
        if (stats.team.pending) parts.push(`${parts.length + 1}) ${stats.team.pending} user(s) awaiting approval in Users.`)
        if (!parts.length) return "You're in good shape — nothing awaiting your approval and nothing expired. 👍"
        return `Here’s where to focus:\n${parts.join('\n')}`
      },
    },
    {
      keywords: ['pending', 'awaiting approval', 'to approve', 'approval', 'approve', 'sign off', 'sign-off', 'my approval', 'need approval'],
      run: () => {
        const mine = approvalQueue.length
        const draft = pendingList(permits).length
        return `${mine} permit(s) awaiting YOUR team’s decision${mine ? ` — ${list(approvalQueue.map((p) => p.permitNo), 3)}` : ''}. Across the org, ${draft} permit(s) are still Draft (not yet both-approved).`
      },
    },
    {
      keywords: ['expired', 'not closed', 'lapsed', 'overdue', 'past', 'need extension', 'ran out', 'time elapsed'],
      run: () => {
        const ex = expiredList(permits)
        if (!ex.length) return 'No expired permits — nothing has lapsed its validity window. 👍'
        const detail = ex.slice(0, 4).map((p) => `• ${permitLabel(p)} — valid until ${p.validTo ? new Date(p.validTo).toLocaleString() : '—'}`)
        return `${ex.length} expired (Not Closed) permit(s) — request an extension or close them:\n${detail.join('\n')}`
      },
    },
    {
      keywords: ['in progress', 'active', 'live', 'ongoing', 'running', 'whats happening', 'current work', 'extended'],
      run: () => {
        const act = activeList(permits)
        if (!act.length) return 'No permits are active right now (in progress or extended).'
        return `${act.length} active permit(s): ${list(act.map((p) => permitLabel(p)))}. (${stats.byStatus.in_progress} in progress, ${stats.byStatus.extended} extended.)`
      },
    },
    {
      keywords: ['observation', 'unsafe', 'safe', 'non compliance', 'non-compliance', 'compliance'],
      run: () => {
        const recentUnsafe = observations.filter((o) => o.type === 'unsafe').slice(0, 3)
        const tail = recentUnsafe.length ? ` Recent unsafe: ${list(recentUnsafe.map((o) => `${o.permitNo || 'permit'}${o.note ? ` — ${o.note}` : ''}`), 2)}.` : ''
        return `${stats.obs.total} observation(s): ${stats.obs.safe} safe, ${stats.obs.unsafe} unsafe. An unsafe observation closes its permit for non-compliance.${tail}`
      },
    },
    {
      keywords: ['recent', 'history', 'lately', 'latest', 'new permit', 'just raised'],
      run: () => {
        const recent = [...permits].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 5)
        if (!recent.length) return 'No permits recorded yet — raise one from New Permit.'
        return `Recently raised:\n${recent.map((p) => `• ${permitLabel(p)} — ${statusMeta(statusOf(p)).label}${p.createdAt ? ` (${timeAgo(p.createdAt)})` : ''}`).join('\n')}`
      },
    },
    {
      keywords: ['which site', 'busiest', 'most permit', 'site with most', 'facility', 'plant', ' site'],
      run: () => {
        if (!stats.siteBreakdown.length) return 'No permits recorded yet.'
        const [top, n] = stats.siteBreakdown[0]
        return `Busiest site by permits: ${top} (${n}). ${stats.siteBreakdown.length > 1 ? `Next: ${stats.siteBreakdown.slice(1, 3).map(([s, c]) => `${s} (${c})`).join(', ')}.` : ''}`
      },
    },
    {
      keywords: ['how many site', 'number of site', 'sites'],
      run: () => `${stats.sites.length} site(s)${stats.sites.length ? `: ${list(stats.sites, 5)}` : ' — an admin can add them under Sites'}.`,
    },
    {
      keywords: ['type of work', 'work type', 'kinds of work', 'by type', 'what types'],
      run: () => {
        if (!stats.typeBreakdown.length) return 'No permits recorded yet.'
        return `By type of work: ${stats.typeBreakdown.map(([t, n]) => `${t} (${n})`).join(', ')}.`
      },
    },
    {
      keywords: ['team', 'how many engineer', 'how many operation', 'technician', 'who can approve', 'members', 'users'],
      run: () => `Team: ${stats.team.engineering} Engineering, ${stats.team.operations} Operations, ${stats.team.technician} Technician(s), ${stats.team.admin} Admin(s).${stats.team.pending ? ` ${stats.team.pending} awaiting approval.` : ''}`,
    },
    {
      keywords: ['closed', 'completed', 'finished'],
      run: () => `${stats.byStatus.closed} closed permit(s) (incl. any closed for non-compliance).`,
    },
    {
      keywords: ['rejected', 'declined', 'refused'],
      run: () => `${stats.byStatus.rejected} rejected permit(s) — a team declined them; they go back to Draft until re-submitted.`,
    },
    {
      keywords: ['how many permit', 'total permit', 'number of permit', 'permits'],
      run: () => `${stats.total} permit(s): ${stats.byStatus.in_progress} in progress, ${stats.byStatus.extended} extended, ${stats.byStatus.not_closed} not closed, ${stats.byStatus.closed} closed, ${stats.byStatus.draft} draft, ${stats.byStatus.rejected} rejected.`,
    },
    {
      keywords: ['summary', 'overview', 'overall', 'status', 'how are we', 'snapshot', 'brief', 'situation', 'dashboard', 'where do we stand', 'is it safe', 'safe'],
      run: () => `Snapshot: ${stats.total} permit(s) — ${stats.byStatus.in_progress} in progress, ${stats.byStatus.extended} extended, ${stats.byStatus.not_closed} not closed, ${stats.byStatus.closed} closed, ${stats.byStatus.draft} draft. ${approvalQueue.length} awaiting your approval. Observations: ${stats.obs.safe} safe, ${stats.obs.unsafe} unsafe.`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey', 'yo'],
      run: () => "Hi, I'm Sam — I read your live permit data. Ask me for a summary, what needs your attention, what's in progress or expired, pending approvals, observations, the busiest site, or “tell me about <permit no>”. I can also give HSE-based permit-to-work guidance (hot work, confined space, height, electrical…).",
    },
  ]

  let best = null
  let bestScore = 0
  for (const intent of INTENTS) {
    let s = 0
    for (const k of intent.keywords || []) if (qn.includes(k)) s++
    for (const k of intent.tokenKeywords || []) if (tokens.has(k)) s++
    if (s > bestScore) { bestScore = s; best = intent }
  }
  if (best && bestScore > 0) return hit(best.run())

  // ── 2. Nothing matched → clarify or defer to AI ────────────────────────────
  const guess = closest(qn, permits.map((p) => p.permitNo).filter(Boolean))
  if (guess && /permit|status|about|detail|show|tell/.test(qn))
    return hit(`Did you mean “${guess}”? Try “tell me about ${guess}”.`)

  const safetyish = /permit|approv|extend|close|hazard|safety|ppe|jsa|observ|site|hot work|confined|height|electric|excavat/.test(qn)
  if (safetyish)
    return miss(`Could you be more specific? Ask about permits in progress / expired, pending approvals, observations, sites — or for guidance, ${HSE}`)

  const qs = suggestedQuestions(pathname)
  return miss(`I’m not sure I follow — want a summary, what needs your attention, what's expired, or “tell me about <permit no>”? Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback ───────────────────────────────────────────────────────────────
/** Compact, data-only snapshot for the LLM (aggregate figures already in-app). */
export function buildAIContext(ctx) {
  const { permits = [], observations = [], approvalQueue = [] } = ctx || {}
  const stats = buildStats(ctx || {})
  const now = new Date()
  const today = {
    raised: permits.filter((p) => sameDay(toDate(p.createdAt), now)).length,
    approved: permits.filter((p) => sameDay(approvedAt(p), now)).length,
    closed: permits.filter((p) => sameDay(closedAt(p), now)).length,
    observations: observations.filter((o) => sameDay(toDate(o.at), now)).length,
  }
  const recent = [...permits]
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 30)
    .map((p) => ({
      permitNo: p.permitNo,
      typeOfWork: p.typeOfWork || '',
      site: p.site || '',
      jobLocation: p.jobLocation || '',
      status: statusMeta(statusOf(p)).label,
      validTo: p.validTo || '',
      engineering: p.engineering?.status || 'pending',
      operations: p.operations?.status || 'pending',
    }))
  return {
    totals: { permits: stats.total, awaitingMyApproval: approvalQueue.length },
    today,
    byStatus: stats.byStatus,
    observations: stats.obs,
    siteBreakdown: stats.siteBreakdown.slice(0, 8).map(([site, count]) => ({ site, count })),
    typeBreakdown: stats.typeBreakdown.map(([type, count]) => ({ type, count })),
    team: stats.team,
    sites: stats.sites,
    recentPermits: recent,
    recentObservations: observations.slice(0, 8).map((o) => ({ permitNo: o.permitNo, type: o.type, note: o.note, by: o.observedByName })),
  }
}

/** Ask the server-side AI proxy. Returns the answer string, or null on failure. */
export async function askAI(question, context) {
  try {
    const r = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
    })
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    const text = d?.answer ? String(d.answer).trim() : ''
    return text || null
  } catch {
    return null
  }
}
