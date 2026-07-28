// ─────────────────────────────────────────────────────────────────────────────
// Sam — Incident IRA guide. Pure, rule-based insight engine over the live org
// data (no LLM): per-page onboarding tips, suggested questions, and a free-text
// answer() that reports counts/next-steps from incidents, illnesses, injuries and
// actions. Mirrors the shape HIRA's assistant exposes so the shared Assistant
// component works unchanged. askAI is a graceful no-op (no AI endpoint).
// ─────────────────────────────────────────────────────────────────────────────

const pageOf = (pathname = '') => {
  if (pathname.includes('/incidents/new')) return 'incident-new'
  if (pathname.includes('/incidents/')) return 'incident-wizard'
  if (pathname.includes('/incidents')) return 'incidents'
  if (pathname.includes('/illness/new')) return 'illness-new'
  if (pathname.includes('/illness')) return 'illness'
  if (pathname.includes('/injuries')) return 'injuries'
  if (pathname.includes('/actions')) return 'actions'
  if (pathname.includes('/users')) return 'users'
  if (pathname.includes('/audit')) return 'audit'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'Your live safety overview — counts by severity, type, HSE category and location.',
      'Click any chart segment or a body-map region to cross-filter every tile.',
      'Watch the Action Status tile and overdue actions — click through to the Action Tracker.',
    ],
  },
  incidents: {
    title: 'Incidents',
    tips: [
      'Every reported incident lives here. Search or filter, then open one to continue its 5 steps.',
      'Use “Report Incident” to start a new one — it saves as you go and you can resume anytime.',
    ],
  },
  'incident-new': {
    title: 'Report an Incident',
    tips: [
      'Step 1 captures what happened — date/time, type, severity, HSE category, location, people.',
      'If the type is first-aid, lost-time or reportable, you’ll add a per-person Injury Report next.',
      'Save Step 1 to generate the printable Initial Incident Report.',
    ],
  },
  'incident-wizard': {
    title: 'Incident Investigation',
    tips: [
      '5 steps: Initial report → Team → Investigation → CAPA actions → Horizontal deployment.',
      'In Investigation you can build 5-Why, Fishbone, Bow-Tie, Fault-Tree or Event-Tree diagrams — add more than one.',
      'CAPA actions you assign here show up in the Action Tracker for follow-through.',
    ],
  },
  injuries: {
    title: 'Injury Reports',
    tips: [
      'Each affected person’s injury is saved here as its own record for easy verification.',
      'Investigators/Admins can mark each report Verified once the details are confirmed.',
      'Mark the injured area on the body map (front/back/internal, incl. fingers, wrists and joints).',
    ],
  },
  illness: {
    title: 'Illness Reports',
    tips: [
      'Log work-related illness — exposed agent (HSE), duration, PPE, health issue and body parts.',
      'Add corrective actions; they flow into the Action Tracker. Optionally link to an incident.',
    ],
  },
  'illness-new': { title: 'Report an Illness', tips: ['Capture who was affected, the agent and exposure, then add corrective actions and print the report.'] },
  actions: {
    title: 'Action Tracker',
    tips: [
      'Every CAPA + illness action across the org, with owner, due date and status.',
      'Overdue actions are flagged — update status to Open / In Progress / Closed inline.',
    ],
  },
  users: { title: 'Users', tips: ['Approve new sign-ups and set each person’s role: Reporter, Investigator or Admin.'] },
  audit: { title: 'Audit Log', tips: ['An immutable trail of every change — filter and export for compliance.'] },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}

const COMMON_QS = ['How many overdue actions?', 'How do I report an incident?', 'Anything to verify?']
const PAGE_QS = {
  dashboard: ['Give me a summary', 'What should I do first?'],
  incidents: ['How many open incidents?', 'How do I report an incident?'],
  injuries: ['How many injuries to verify?', 'How do I verify an injury?'],
  actions: ['What’s overdue?', 'How many open actions?'],
  illness: ['How do I report an illness?'],
}
export function suggestedQuestions(pathname) {
  const p = pageOf(pathname)
  return [...(PAGE_QS[p] || []), ...COMMON_QS].slice(0, 5)
}

// ── Free-text answers ────────────────────────────────────────────────────────
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const has = (q, ...words) => words.some((w) => q.includes(w))

export function answer(question, ctx = {}) {
  const q = norm(question)
  const incidents = ctx.incidents || []
  const illnesses = ctx.illnesses || []
  const open = ctx.openActions || []
  const overdue = ctx.overdueActions || []
  const pendingInjuries = ctx.pendingInjuries || []
  const openIncidents = incidents.filter((i) => i.lifecycle !== 'closed')

  if (has(q, 'overdue')) {
    return overdue.length
      ? { matched: true, text: `You have ${overdue.length} overdue action(s). Open the Action Tracker to update them.`, action: { type: 'navigate', to: '/incidents/actions' } }
      : { matched: true, text: 'No overdue actions — nicely on top of it. 👍' }
  }
  if (has(q, 'open action', 'how many action', 'actions open')) {
    return { matched: true, text: `${open.length} action(s) are still open across incidents and illnesses.`, action: { type: 'navigate', to: '/incidents/actions' } }
  }
  if (has(q, 'verify', 'verification') || (has(q, 'injur') && has(q, 'how many', 'pending'))) {
    return pendingInjuries.length
      ? { matched: true, text: `${pendingInjuries.length} injury report(s) awaiting verification.`, action: { type: 'navigate', to: '/incidents/injuries' } }
      : { matched: true, text: 'All injury reports are verified. ✅' }
  }
  if (has(q, 'report an incident', 'new incident', 'how do i report', 'log an incident', 'raise incident')) {
    return { matched: true, text: 'I’ll open the incident reporter — fill Step 1 (what happened) and save to generate the Initial Report.', action: { type: 'navigate', to: '/incidents/new' } }
  }
  if (has(q, 'illness', 'sick', 'exposure', 'disease')) {
    return { matched: true, text: 'Log a work-related illness here — agent, exposure, PPE and body parts, then corrective actions.', action: { type: 'navigate', to: '/incidents/illness/new' } }
  }
  if (has(q, 'investigation', '5 why', 'fishbone', 'bow tie', 'fault tree', 'event tree', 'root cause')) {
    return { matched: true, text: 'In an incident’s Investigation step you can build 5-Why, Fishbone, Bow-Tie, Fault-Tree or Event-Tree diagrams — and add more than one method.' }
  }
  if (has(q, 'summary', 'overview', 'how am i doing', 'status')) {
    return { matched: true, text: `Summary: ${incidents.length} incident(s) (${openIncidents.length} open), ${illnesses.length} illness report(s), ${open.length} open action(s)${overdue.length ? ` (${overdue.length} overdue)` : ''}, ${pendingInjuries.length} injury report(s) to verify.` }
  }
  if (has(q, 'what should i do', 'next', 'first', 'priorit')) {
    if (overdue.length) return { matched: true, text: `Start with your ${overdue.length} overdue action(s).`, action: { type: 'navigate', to: '/incidents/actions' } }
    if (pendingInjuries.length) return { matched: true, text: `Verify ${pendingInjuries.length} pending injury report(s).`, action: { type: 'navigate', to: '/incidents/injuries' } }
    if (openIncidents.length) return { matched: true, text: `Continue investigating ${openIncidents.length} open incident(s).`, action: { type: 'navigate', to: '/incidents' } }
    return { matched: true, text: 'You’re all caught up. Report a new incident or illness whenever you need to.' }
  }
  // Unmatched → let the caller fall back (here, a friendly default since there's no AI endpoint).
  return { matched: false, text: 'I can help with incidents, injuries, illnesses and actions. Try “how many overdue actions?”, “anything to verify?”, or “how do I report an incident?”.' }
}

// Kept for API-shape parity with the shared component; no AI endpoint here.
export function buildAIContext(ctx = {}) {
  return {
    incidents: (ctx.incidents || []).length,
    openActions: (ctx.openActions || []).length,
    overdueActions: (ctx.overdueActions || []).length,
    pendingInjuries: (ctx.pendingInjuries || []).length,
    pathname: ctx.pathname,
  }
}

export async function askAI() {
  return null // no LLM backend wired — the rule answer is used instead.
}
