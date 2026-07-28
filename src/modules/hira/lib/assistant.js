// ─────────────────────────────────────────────────────────────────────────────
// HIRA Guide — rule-based insight engine. Pure functions over the live org data
// (no LLM): per-page onboarding tips, suggested questions, and a scored-intent
// answer() that understands free-typed questions (synonyms + entity lookups) and
// reports counts/examples from the dashboard summary, risk lists, CAPA actions
// and the activity log.
// ─────────────────────────────────────────────────────────────────────────────
import { riskLists, flattenAdditionalControls, flattenHazards, isOverdue } from './raStats'
import { categoryLabel } from './constants'

const pageOf = (pathname = '') => {
  if (pathname.includes('/risk-register')) return 'risk-register'
  if (pathname.includes('/action-tracker')) return 'action-tracker'
  if (pathname.includes('/repository')) return 'repository'
  if (pathname.includes('/create')) return 'create'
  if (pathname.includes('/bulk-import')) return 'bulk-import'
  if (pathname.includes('/organization')) return 'organization'
  if (pathname.includes('/assessment/')) return 'assessment'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'This is your live risk overview. Use the Site / Location / Title filters to focus the charts.',
      'Tiles are colour-coded by risk level — “Under Permissible Risk”, “ALARP”, “High & Critical”.',
      'Watch “Overdue Actions” — click it to jump to the Action Tracker.',
    ],
  },
  create: {
    title: 'Create Risk Assessment',
    tips: [
      'Section 1 = details (pick a Site from the dropdown, or add one with ＋).',
      'Section 2 = add internal/external members; internal ones can own controls.',
      'Section 3 = activities → hazards. Pick Group → Category → Type, set Probability × Severity and the matrix scores it.',
      'Add additional controls + projected risk; tick ALARP to accept the residual risk.',
    ],
  },
  repository: {
    title: 'Repository',
    tips: [
      'Every saved assessment lives here. Filter by Site, Name or Location.',
      'Hover a row for actions: view, export PDF, edit, delete.',
    ],
  },
  'risk-register': {
    title: 'Risk Register',
    tips: [
      'Risks grouped by severity (Critical/High/ALARP) and acceptability (initial vs residual).',
      'The “Action Required” tab lists non-acceptable residual risks — add controls or declare ALARP right there.',
    ],
  },
  'action-tracker': {
    title: 'Action Tracker',
    tips: [
      'All additional controls (CAPA) with their status and due dates.',
      'Filter by status or risk focus; overdue actions are flagged red. Change status inline.',
    ],
  },
  'bulk-import': {
    title: 'Bulk Import',
    tips: [
      'Download the CSV template, fill one row per hazard/control, then upload to import many at once.',
    ],
  },
  organization: {
    title: 'Organization',
    tips: [
      'Add your sites/facilities here — they become the Site dropdown in assessments and a dashboard filter.',
    ],
  },
  assessment: {
    title: 'Assessment',
    tips: ['Full read-only breakdown. Use Export PDF for the ISO-format document, or Edit to change it.'],
  },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}

const COMMON_QS = ['How many overdue actions?', 'What are my critical risks?', 'Recent activity?']
const PAGE_QS = {
  dashboard: ['Give me a summary', 'Which site has the most hazards?', 'What should I do first?'],
  'risk-register': ['How many non-acceptable residual risks?', 'How many ALARP?', 'What are my high risks?'],
  'action-tracker': ['What’s overdue?', 'How many open actions?', 'What should I do first?'],
  repository: ['How many assessments?', 'How many hazards?', 'Which site has the most hazards?'],
  create: ['What counts as acceptable risk?', 'When should I declare ALARP?'],
  organization: ['Which site has the most hazards?', 'How many sites?'],
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
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
    if (!d) return ''
    const s = Math.floor((Date.now() - d.getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  } catch {
    return ''
  }
}

function siteBreakdown(assessments) {
  const m = {}
  for (const a of assessments) {
    const site = a.siteName || 'Unspecified'
    const n = (a.activities || []).reduce((c, act) => c + (act.hazards?.length || 0), 0)
    m[site] = (m[site] || 0) + n
  }
  return Object.entries(m).sort((x, y) => y[1] - x[1])
}

const hzLabel = (h) => h.hazardType || categoryLabel(h.hazardCategory) || 'hazard'
const isOpen = (c) => ['Open', 'In Progress'].includes(c?.status || 'Open')
const isHC = (risk) => risk?.key === 'high' || risk?.key === 'critical'
const worstResidual = (rows) =>
  rows.reduce((m, r) => (r.residual && (!m || (r.residual.score || 0) > (m.score || 0)) ? r.residual : m), null)

// answer() result wrappers: matched=true means a rule handled it; matched=false
// signals the caller (Assistant) to try the AI fallback.
const hit = (text) => ({ text, matched: true })
const miss = (text) => ({ text, matched: false })
// A matched answer that also asks the UI to navigate somewhere.
const nav = (text, to) => ({ text, matched: true, action: { type: 'navigate', to } })

const HSE = 'For authoritative guidance, see the UK HSE: https://www.hse.gov.uk/.'

// Concise, correct safety guidance for common risk-assessment / control / hazard
// questions, always citing the HSE. Returns null if the topic isn't recognised
// (so the caller can defer to the AI fallback).
function guidanceAnswer(qn) {
  if (qn.includes('hierarch') || qn.includes('control measure') || qn.includes('how to control') || qn.includes('what control') || qn.includes('types of control'))
    return `Use the hierarchy of controls, most to least effective: 1) Elimination, 2) Substitution, 3) Engineering controls, 4) Administrative controls, 5) PPE. Always exhaust higher levels before relying on PPE. ${HSE}`
  if (qn.includes('ppe'))
    return `PPE (personal protective equipment) is the LAST line of defence, used only after higher controls. Choose PPE matched to the hazard (eye, hearing, respiratory, hand, foot, fall protection), and ensure correct fit, training and maintenance. ${HSE}`
  if (qn.includes('coshh') || qn.includes('hazardous substance') || qn.includes('chemical'))
    return `COSHH covers substances hazardous to health: assess exposure, prevent it where possible or otherwise control it (ventilation, enclosure, PPE), and monitor/health-surveil where needed. ${HSE}`
  if (qn.includes('alarp'))
    return `ALARP = “As Low As Reasonably Practicable”: keep reducing a residual risk until the cost/effort of further reduction is grossly disproportionate to the benefit, then formally accept it. ${HSE}`
  if ((qn.includes('hazard') && (qn.includes('differ') || qn.includes('vs') || qn.includes('versus'))) || qn.includes('what is a hazard') || qn.includes('what is hazard'))
    return `A hazard is anything with the potential to cause harm (e.g. chemicals, electricity, working at height). Risk is how likely that harm is and how severe it would be. ${HSE}`
  if (qn.includes('risk assessment') || qn.includes('assess risk') || qn.includes('how do i assess') || qn.includes('what is risk'))
    return `A risk assessment has 5 steps: 1) identify hazards, 2) decide who might be harmed and how, 3) evaluate the risk and decide controls, 4) record and implement your findings, 5) review and update. In HIRA: create an assessment → add activities → hazards → score Probability × Severity → apply the hierarchy of controls and a projected residual risk. ${HSE}`
  return null
}

// Fuzzy "did you mean" — best name from `names` by shared significant words
// (+ a bonus for a contained substring). Returns null when nothing is close.
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

// ── Answering ────────────────────────────────────────────────────────────────
/**
 * Answer a free-typed question from the live data context.
 * ctx = { summary, assessments, activity, sites, pathname }
 *
 * Strategy: (1) entity lookups when a known site/assessment name is mentioned,
 * (2) a scored intent registry (synonym keywords → handler; highest score wins),
 * (3) a helpful fallback that points at what the guide *can* answer.
 */
export function answer(question, ctx) {
  const { summary, assessments = [], activity = [], sites = [], pathname } = ctx || {}
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your risks — try “give me a summary” or “what’s overdue?”.')
  const tokens = new Set(qn.split(' '))

  const hazards = flattenHazards(assessments)
  const actions = flattenAdditionalControls(assessments)
  const lists = riskLists(assessments)

  // ── 0. Navigation intents (create a RA / add a hazard to an existing one) ────
  const asmtByName = assessments.find((a) => a.name && norm(a.name).length >= 3 && qn.includes(norm(a.name)))
  const wantsAddHazard = qn.includes('hazard') && /\b(add|new|log|include|put|record)\b/.test(qn)
  const wantsCreate = /\b(create|new|start|make|begin|add|do)\b/.test(qn) &&
    (qn.includes('risk assessment') || qn.includes('assessment') || qn.includes('hira'))

  if (wantsAddHazard) {
    if (asmtByName) return nav(`Opening “${asmtByName.name}” so you can add a hazard — go to Section 3 (Activities → Hazards) and add it there.`, `/hira/create/${asmtByName.id}`)
    const names = assessments.map((a) => a.name).filter(Boolean)
    const guess = closest(qn, names)
    if (guess) return hit(`I couldn’t find an exact match. Did you mean “${guess}”? If so, say “add hazard to ${guess}” and I’ll open it.`)
    return hit(names.length
      ? `Which assessment should I add the hazard to? You have: ${list(names, 5)}. Say “add hazard to <name>”, or “create a risk assessment” to start a new one.`
      : `You don’t have any assessments yet. Say “create a risk assessment” and I’ll open the form for you.`)
  }
  if (wantsCreate) {
    return nav('Sure — opening the Create Risk Assessment page for you. 👷', '/hira/create')
  }

  // ── 1. Entity lookups (mention of a specific site or assessment by name) ─────
  const siteNames = Array.from(new Set([...sites, ...assessments.map((a) => a.siteName)].filter(Boolean)))
  const longestHit = (candidates, minLen) =>
    candidates
      .filter((c) => c && norm(c).length >= minLen && qn.includes(norm(c)))
      .sort((a, b) => norm(b).length - norm(a).length)[0] || null

  const siteHit = longestHit(siteNames, 2)
  const asmtHit = assessments.find((a) => a.name && norm(a.name).length >= 4 && qn.includes(norm(a.name)))

  // Prefer the more specific (longer) literal match.
  const preferAsmt = asmtHit && (!siteHit || norm(asmtHit.name).length >= norm(siteHit).length)

  if (preferAsmt) {
    const rows = hazards.filter((r) => r.assessmentId === asmtHit.id)
    const w = worstResidual(rows)
    const open = actions.filter((r) => r.assessmentId === asmtHit.id && isOpen(r.control)).length
    const where = asmtHit.siteName ? ` at ${asmtHit.siteName}` : ''
    if (!rows.length) return hit(`“${asmtHit.name}”${where} has no hazards recorded yet.`)
    return hit(`“${asmtHit.name}”${where}: ${rows.length} hazard(s), worst residual risk ${w?.label || '—'}, ${open} open action(s). e.g. ${list(rows.map((r) => hzLabel(r.hazard)))}.`)
  }
  if (siteHit) {
    const rows = hazards.filter((r) => norm(r.siteName) === norm(siteHit))
    const hc = rows.filter((r) => isHC(r.residual)).length
    const open = actions.filter((r) => norm(r.siteName) === norm(siteHit) && isOpen(r.control)).length
    if (!rows.length) return hit(`No hazards recorded for ${siteHit} yet.`)
    return hit(`${siteHit}: ${rows.length} hazard(s)${hc ? `, ${hc} at High/Critical residual risk` : ''}, ${open} open action(s).`)
  }

  // ── 2. Scored intent registry ───────────────────────────────────────────────
  const overdue = () => actions.filter((r) => isOverdue(r.control))
  const open = () => actions.filter((r) => isOpen(r.control))

  const INTENTS = [
    {
      // HSE guidance (general RA / control / hazard knowledge) — must win its topics
      keywords: ['hierarch', 'control measure', 'how to control', 'what control', 'types of control', 'ppe', 'coshh', 'hazardous substance',
        'what is alarp', 'what does alarp', 'alarp mean', 'meaning of alarp',
        'what is a hazard', 'what is hazard', 'hazard vs', 'hazard versus', 'difference between hazard',
        'what is a risk assessment', 'what is risk assessment', 'how to do a risk assessment', 'how do i do a risk assessment',
        'steps of risk assessment', 'how do i assess', 'assess risk', 'best practice', 'guidance'],
      run: () => guidanceAnswer(qn) || `${HSE}`,
    },
    {
      // recent activity / audit
      keywords: ['recent', 'history', 'changed', 'lately', 'latest', 'audit', 'who did', 'who changed', 'activity log', ' log'],
      run: () => {
        if (!activity.length) return 'No recorded activity yet. Creating assessments, changing a control’s status or declaring ALARP will show up here.'
        return `Recent activity:\n${activity.slice(0, 5).map((e) => `• ${e.actorName} ${e.message} (${timeAgo(e.at)})`).join('\n')}`
      },
    },
    {
      // overdue
      keywords: ['overdue', 'late', 'past due', 'missed', 'behind', 'due date', 'whats late', 'what is late'],
      run: () => {
        const od = overdue()
        if (!od.length) return 'No overdue actions — nice. An action is overdue when its due date has passed and it isn’t Implemented.'
        return `${od.length} overdue action(s): ${list(od.map((r) => r.control.description || r.control.hierarchy))}. Open the Action Tracker to address them.`
      },
    },
    {
      // priorities / what should I do
      keywords: ['what should i', 'what do i do', 'what next', 'priorit', 'focus', 'urgent', 'most important', 'advice', 'recommend', 'where do i start', 'first', 'attention'],
      run: () => {
        const od = overdue()
        const need = lists.actionRequired
        if (!od.length && !need.length) return 'You’re in good shape — no overdue actions and every residual risk is acceptable or ALARP-accepted.'
        const parts = []
        if (od.length) parts.push(`1) Clear ${od.length} overdue action(s): ${list(od.map((r) => r.control.description || r.control.hierarchy), 2)}.`)
        if (need.length) parts.push(`${od.length ? '2)' : '1)'} Address ${need.length} non-acceptable residual risk(s) (add controls or declare ALARP): ${list(need.map((r) => hzLabel(r.hazard)), 2)}.`)
        return `Here’s where to focus:\n${parts.join('\n')}`
      },
    },
    {
      // open / in-progress actions (CAPA) — list each with its hazard + assessment
      keywords: ['open action', 'open actions', 'in progress', 'pending', 'outstanding', 'unfinished', 'remaining action', 'capa', 'to do', 'todo', 'which hazard', 'hazard has', 'hazard with', 'open for'],
      run: () => {
        const op = open()
        if (!op.length) return `No open actions — all ${actions.length} additional control(s) are Implemented (or none have been added yet).`
        const lines = op.slice(0, 6).map((r) =>
          `• ${r.control.description || r.control.hierarchy || 'Control'} — for hazard “${r.hazardLabel}” in “${r.assessmentName}”${r.control.dueDate ? ` (due ${r.control.dueDate})` : ''}${isOverdue(r.control) ? ' ⚠ overdue' : ''}`)
        const extra = op.length - Math.min(op.length, 6)
        return `${op.length} open action(s) (Open / In Progress)${summary?.overdueActions ? `, ${summary.overdueActions} overdue` : ''}:\n${lines.join('\n')}${extra > 0 ? `\n…and ${extra} more. Open the Action Tracker for all of them.` : ''}`
      },
    },
    {
      keywords: ['critical', 'severe'],
      run: () => lists.critical.length
        ? `${lists.critical.length} hazard(s) at Critical residual risk: ${list(lists.critical.map((x) => hzLabel(x.hazard)))}.`
        : 'No hazards at Critical residual risk. Want me to check your High risks or what needs action?',
    },
    {
      keywords: ['high risk', 'high risks', 'major', ' high'],
      run: () => lists.high.length
        ? `${lists.high.length} hazard(s) at High residual risk: ${list(lists.high.map((x) => hzLabel(x.hazard)))}.`
        : 'No hazards at High residual risk. Want your Critical risks or the list of what needs action?',
    },
    {
      keywords: ['alarp', 'tolerable', 'as low as'],
      run: () => `${lists.alarp.length} hazard(s) accepted as ALARP. Declare ALARP when a residual risk can’t reasonably be reduced further.`,
    },
    {
      keywords: ['non acceptable', 'not acceptable', 'unacceptable', 'non-acceptable'],
      run: () => `Residual: ${lists.nonAcceptableResidual.length} non-acceptable. Initial: ${lists.nonAcceptableInitial.length} non-acceptable. (Non-acceptable = risk score ≥ 7.) ${lists.actionRequired.length} need action (non-acceptable residual, not yet ALARP).`,
    },
    {
      keywords: ['action required', 'need action', 'needs action', 'require action', 'problem', 'issue', 'concern', 'danger', 'unsafe', 'not safe', 'wrong', 'worry', 'worried'],
      run: () => lists.actionRequired.length
        ? `${lists.actionRequired.length} hazard(s) need action — non-acceptable residual risk and not yet ALARP. See the Action Required tab in the Risk Register.`
        : 'Nothing needs action — all residual risks are acceptable or ALARP-accepted.',
    },
    {
      keywords: ['acceptable'],
      run: () => `Acceptable = risk score 1–6 (Negligible/Low/Medium). Acceptable residual: ${lists.acceptableResidual.length}; non-acceptable residual: ${lists.nonAcceptableResidual.length}.`,
    },
    {
      // how many sites
      keywords: ['how many site', 'number of site', 'sites configured', 'how many facilit'],
      run: () => `${sites.length} site(s) configured${sites.length ? `: ${list(sites, 5)}` : ''}.`,
    },
    {
      // busiest / riskiest site
      keywords: ['which site', 'busiest', 'most hazard', 'site with most', 'riskiest', 'hardest', ' site', 'facility', 'plant', ' where'],
      run: () => {
        const bd = siteBreakdown(assessments)
        if (!bd.length) return 'No hazards recorded yet.'
        return `Busiest site by hazards: ${bd[0][0]} (${bd[0][1]}). ${bd.length > 1 ? `Next: ${bd.slice(1, 3).map(([s, n]) => `${s} (${n})`).join(', ')}.` : ''}`
      },
    },
    {
      keywords: ['activit', 'task', 'operation', ' job'],
      run: () => {
        const top = Object.entries(summary?.byActivity || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
        return top.length ? `Top activities by hazards: ${top.map(([a, n]) => `${a} (${n})`).join(', ')}.` : 'No activities recorded yet.'
      },
    },
    {
      keywords: ['how many assessment', 'assessments', 'total assessment', 'number of assessment', 'show all', 'list all', 'everything', 'show me everything'],
      run: () => `${summary?.totalAssessments || 0} risk assessment(s) with ${summary?.totalHazards || 0} hazard(s) in total.`,
    },
    {
      keywords: ['hazard'],
      run: () => `${summary?.totalHazards || 0} hazard(s) across ${summary?.totalAssessments || 0} assessment(s). ${summary?.permissible || 0} are under permissible risk; ${summary?.highCritical || 0} are High or Critical.`,
    },
    {
      keywords: ['control', 'type of control'],
      run: () => `${summary?.totalControls || 0} control(s) total. Additional controls (CAPA): ${actions.length}, of which ${summary?.openActions || 0} open.`,
    },
    {
      // overall summary / status
      keywords: ['summary', 'overview', 'overall', 'status', 'how are we', 'how is it', 'snapshot', 'brief', 'situation', 'dashboard', 'where do we stand', 'state of', 'risk', 'risks', 'risky', 'how bad', 'is it safe', 'safe', 'how safe'],
      run: () => `Snapshot: ${summary?.totalAssessments || 0} assessment(s), ${summary?.totalHazards || 0} hazard(s) — ${summary?.highCritical || 0} High/Critical, ${lists.alarp.length} ALARP-accepted, ${summary?.permissible || 0} under permissible risk. Actions: ${summary?.openActions || 0} open, ${summary?.overdueActions || 0} overdue. ${lists.actionRequired.length} risk(s) still need action.`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey', 'yo'],
      run: () => 'Hi! I read your live data. Ask me for a summary, what’s overdue, your critical/high risks, ALARP count, acceptable vs non-acceptable, the busiest site, recent activity, or “tell me about <an assessment name>”.',
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

  // ── 3. Nothing matched → ask a clarifying cross-question with a suggestion ───
  // 3a. Looks like they named an assessment/site we don't have → "did you mean…?"
  const asmtGuess = closest(qn, assessments.map((a) => a.name).filter(Boolean))
  if (asmtGuess && /assessment|hazard|risk|about|detail|show|tell|open|action/.test(qn))
    return hit(`I couldn’t find that exactly. Did you mean the assessment “${asmtGuess}”? Try “tell me about ${asmtGuess}”, or “add hazard to ${asmtGuess}”.`)
  const siteGuess = closest(qn, sites)
  if (siteGuess && /site|location|where|plant|facility|area/.test(qn))
    return hit(`Did you mean the site “${siteGuess}”? Try “risks at ${siteGuess}”.`)

  // 3b. Topic is clear but the question is vague → ask which angle they want.
  if (/action|capa|task|to do/.test(qn))
    return hit('Did you mean overdue actions, open actions, or which hazard has an open action? Ask one and I’ll pull it up.')
  if (/site|location|plant|facility|area/.test(qn))
    return hit(sites.length
      ? `Which site? You have: ${list(sites, 5)}. Try “risks at <site>” or “which site has the most hazards”.`
      : 'No sites are set up yet — add them under Organization, then ask “which site has the most hazards”.')
  if (/assessment|hira/.test(qn))
    return hit('Did you want to create a risk assessment, add a hazard to an existing one, or hear about a specific assessment? Tell me which.')

  // 3c. Safety/guidance wording → try the AI; the no-AI fallback still cites HSE.
  const safetyish = /hazard|risk|control|safety|assess|ppe|incident|accident|injur|coshh|hse/.test(qn)
  if (safetyish)
    return miss(`Could you be a bit more specific? You can ask about your overdue/open actions, critical/high risks, ALARP, or a specific assessment — or for general guidance see the HSE: https://www.hse.gov.uk/.`)

  // 3d. No idea → offer concrete options as a question.
  const qs = suggestedQuestions(pathname)
  return miss(`I’m not sure I follow — did you want a summary, your overdue/open actions, critical/high risks, or “tell me about <an assessment>”? You could also say “create a risk assessment”. Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

/** Convenience for any caller that just wants the answer string. */
export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback ───────────────────────────────────────────────────────────────
/**
 * Compact, data-only snapshot for the LLM. Only includes the same aggregate
 * figures already visible in the app (no raw control text / member PII).
 */
export function buildAIContext(ctx) {
  const { summary, assessments = [], activity = [], sites = [] } = ctx || {}
  const lists = riskLists(assessments)
  const actions = flattenAdditionalControls(assessments)
  const sitesByHazards = siteBreakdown(assessments).slice(0, 8).map(([site, hazards]) => ({ site, hazards }))
  const topActivities = Object.entries(summary?.byActivity || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([activity, hazards]) => ({ activity, hazards }))
  const recentActivity = activity.slice(0, 8).map((e) => ({ who: e.actorName, did: e.message, when: timeAgo(e.at) }))
  const assessmentList = assessments.slice(0, 40).map((a) => {
    const rows = flattenHazards([a])
    return {
      name: a.name || 'Untitled',
      site: a.siteName || '',
      location: a.location || '',
      hazards: rows.length,
      worstResidual: worstResidual(rows)?.label || null,
    }
  })
  return {
    totals: {
      assessments: summary?.totalAssessments || 0,
      hazards: summary?.totalHazards || 0,
      controls: summary?.totalControls || 0,
      underPermissibleRisk: summary?.permissible || 0,
      highOrCritical: summary?.highCritical || 0,
    },
    risk: {
      alarpAccepted: lists.alarp.length,
      high: lists.high.length,
      critical: lists.critical.length,
      acceptableResidual: lists.acceptableResidual.length,
      nonAcceptableResidual: lists.nonAcceptableResidual.length,
      needsAction: lists.actionRequired.length,
    },
    actions: { total: actions.length, open: summary?.openActions || 0, overdue: summary?.overdueActions || 0 },
    sites,
    sitesByHazards,
    topActivities,
    recentActivity,
    assessments: assessmentList,
  }
}

/**
 * Ask the server-side AI proxy. Returns the answer string, or null on any
 * failure / when the key isn't configured (caller then uses the rule fallback).
 */
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
