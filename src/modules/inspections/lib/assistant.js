// ─────────────────────────────────────────────────────────────────────────────
// Inspections Guide — rule-based insight engine for "Sam". Pure functions over
// the live org data (no LLM): per-page onboarding tips, suggested questions, and
// a scored-intent answer() that understands free-typed questions and reports
// counts/examples from templates, the schedule, overdue tasks, records & sites.
// Mirrors the HIRA assistant API (pageGuide / suggestedQuestions / answer /
// buildAIContext / askAI) so the Assistant component stays portable.
// ─────────────────────────────────────────────────────────────────────────────

const pageOf = (pathname = '') => {
  if (pathname.includes('/forms/new') || pathname.includes('/edit')) return 'create'
  if (pathname.includes('/forms')) return 'forms'
  if (pathname.includes('/schedule')) return 'schedule'
  if (pathname.includes('/overdue')) return 'overdue'
  if (pathname.includes('/execute')) return 'execute'
  if (pathname.includes('/records')) return 'records'
  if (pathname.includes('/sites')) return 'sites'
  if (pathname.includes('/users')) return 'users'
  if (pathname.includes('/audit')) return 'audit'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'Your live inspection overview. Use the Site filter to scope the tiles and stats.',
      'Tiles: Active forms, Due today, Overdue and Completed — click any to jump there.',
      'Watch “Overdue” — click it to see what’s past due and start it.',
    ],
  },
  schedule: {
    title: 'Schedule',
    tips: [
      'The month calendar explodes recurring forms + assignments into due dates.',
      'Click a tile to run that inspection; completed ones show in green/red with their score.',
      'Filter by Site to focus on one location.',
    ],
  },
  create: {
    title: 'Create / Edit Form',
    tips: [
      'Add questions (Pass/Fail, Text, Number), set photo requirements, or import from Excel.',
      'Pick an optional Default site for recurring auto-scheduling.',
      'Set status to Active and add a recurring window, or assign one-off dates from the Forms list.',
    ],
  },
  forms: {
    title: 'Inspection Forms',
    tips: [
      'Every form lives here. Use “Assign” to schedule a form to a specific site + date.',
      'The same form can be assigned to several sites individually.',
      'Edit, change status, or (admins) delete from each card.',
    ],
  },
  execute: {
    title: 'Run Inspection',
    tips: [
      'Answer each question; failures let you add an observation and a photo.',
      'Mandatory-photo questions must have a photo before you can submit.',
      'Your live Pass/Fail score updates as you go.',
    ],
  },
  records: {
    title: 'Records',
    tips: [
      'Completed inspections with score, findings and full responses. Filter by site.',
      'Search by form, site or inspector. Click a row for the detail.',
    ],
  },
  sites: {
    title: 'Sites',
    tips: [
      'Add the sites you inspect — they become the target for assignments and the Site filter.',
      'Admins manage this list; everyone can pick and filter by site.',
    ],
  },
  users: { title: 'Users', tips: ['Approve members and set roles. Admins manage org access here.'] },
  audit: { title: 'Audit Log', tips: ['An append-only trail of every change in your organization.'] },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}

const COMMON_QS = ['Give me a summary', 'What’s overdue?', 'What’s due today?']
const PAGE_QS = {
  dashboard: ['What should I do first?', 'What’s my pass rate?', 'How many forms?'],
  schedule: ['What’s due today?', 'What’s coming up?', 'What’s overdue?'],
  forms: ['How many forms?', 'How do I assign a form?', 'Which sites are covered?'],
  overdue: ['What’s overdue?', 'What should I do first?'],
  records: ['What’s my pass rate?', 'How many inspections completed?', 'Any failures?'],
  sites: ['How many sites?', 'Which site has the most inspections?'],
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
const passRateOf = (records) => {
  if (!records.length) return null
  return Math.round((records.filter((r) => r.passFailResult === 'PASS').length / records.length) * 100)
}

const hit = (text) => ({ text, matched: true })
const miss = (text) => ({ text, matched: false })
const nav = (text, to) => ({ text, matched: true, action: { type: 'navigate', to } })

// ── Answering ────────────────────────────────────────────────────────────────
/**
 * Answer a free-typed question from the live data context.
 * ctx = { templates, activeTemplates, scheduledTasks, overdueTasks, dueTodayTasks, records, sites, pathname }
 */
export function answer(question, ctx) {
  const {
    templates = [], activeTemplates = [], scheduledTasks = [], overdueTasks = [],
    dueTodayTasks = [], records = [], sites = [], pathname,
  } = ctx || {}
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your inspections — try “give me a summary” or “what’s overdue?”.')
  const tokens = new Set(qn.split(' '))
  const upcoming = scheduledTasks.filter((t) => !overdueTasks.includes(t))
  const pr = passRateOf(records)

  // ── 0. Navigation intents ───────────────────────────────────────────────────
  const wantsCreate = /\b(create|new|start|make|build|add)\b/.test(qn) && /\bform|template|checklist|inspection\b/.test(qn) && !/assign/.test(qn)
  if (wantsCreate) return nav('Sure — opening the Create Form page for you. 👷', '/inspections/forms/new')
  if (/assign/.test(qn)) return nav('Open the Forms page, then hit “Assign” on a form to schedule it to a site + date.', '/inspections/forms')
  const goto = [
    ['schedule', '/inspections/schedule'], ['calendar', '/inspections/schedule'], ['overdue', '/inspections/overdue'],
    ['record', '/inspections/records'], ['site', '/sites'], ['dashboard', '/dashboard'], ['form', '/inspections/forms'],
  ]
  if (/\b(go to|open|show me|take me to|navigate)\b/.test(qn)) {
    for (const [kw, to] of goto) if (qn.includes(kw)) return nav(`Opening ${kw}…`, to)
  }

  // ── 1. Entity lookups (a specific site or form named in the question) ────────
  const siteHit = sites.filter((s) => s.name && norm(s.name).length >= 2 && qn.includes(norm(s.name)))
    .sort((a, b) => norm(b.name).length - norm(a.name).length)[0]
  const formHit = templates.find((t) => t.title && norm(t.title).length >= 4 && qn.includes(norm(t.title)))

  if (siteHit) {
    const pending = scheduledTasks.filter((t) => t.siteId === siteHit.id).length
    const done = records.filter((r) => r.siteId === siteHit.id).length
    const od = overdueTasks.filter((t) => t.siteId === siteHit.id).length
    return hit(`${siteHit.name}: ${pending} scheduled inspection(s)${od ? ` (${od} overdue)` : ''}, ${done} completed.`)
  }
  if (formHit) {
    const pendingA = (formHit.assignments || []).filter((a) => a.status === 'Pending').length
    const recs = records.filter((r) => r.templateId === formHit.id)
    return hit(`“${formHit.title}”: ${formHit.fields?.length || 0} question(s), ${pendingA} active assignment(s), ${recs.length} completed. Status: ${formHit.status}.`)
  }

  // ── 2. Scored intent registry ───────────────────────────────────────────────
  const INTENTS = [
    {
      keywords: ['overdue', 'late', 'past due', 'missed', 'behind', 'whats late', 'what is late'],
      run: () => overdueTasks.length
        ? `${overdueTasks.length} overdue inspection(s): ${list(overdueTasks.map((t) => `${t.title}${t.siteName ? ' @ ' + t.siteName : ''} (${t.dueString})`))}. Open Overdue to start them.`
        : 'No overdue inspections — nice work. Anything due in the next week shows under Overdue → Upcoming.',
    },
    {
      keywords: ['due today', 'today', 'now', 'right now'],
      run: () => dueTodayTasks.length
        ? `${dueTodayTasks.length} inspection(s) due today: ${list(dueTodayTasks.map((t) => `${t.title}${t.siteName ? ' @ ' + t.siteName : ''}`))}.`
        : 'Nothing due today.',
    },
    {
      keywords: ['upcoming', 'coming up', 'next', 'soon', 'scheduled', 'schedule', 'whats next', 'what next'],
      run: () => scheduledTasks.length
        ? `${scheduledTasks.length} scheduled inspection(s). Next: ${list(scheduledTasks.slice(0, 4).map((t) => `${t.title} (${t.dueString})`), 4)}.`
        : 'Nothing scheduled yet — assign a form to a site + date from the Forms page.',
    },
    {
      keywords: ['what should i', 'what do i do', 'priorit', 'focus', 'urgent', 'first', 'where do i start', 'attention', 'recommend'],
      run: () => {
        if (overdueTasks.length) return `Start with your ${overdueTasks.length} overdue inspection(s): ${list(overdueTasks.map((t) => t.title), 2)}. Then today’s ${dueTodayTasks.length}.`
        if (dueTodayTasks.length) return `You’re on top of overdue. Today: ${dueTodayTasks.length} inspection(s) — ${list(dueTodayTasks.map((t) => t.title), 2)}.`
        return 'You’re in good shape — nothing overdue or due today. Assign or build a new form when you’re ready.'
      },
    },
    {
      keywords: ['pass rate', 'pass', 'fail', 'score', 'result'],
      run: () => pr === null ? 'No inspections completed yet, so there’s no pass rate.'
        : `Pass rate: ${pr}% — ${records.filter((r) => r.passFailResult === 'PASS').length} of ${records.length} passed (≥90%). ${records.filter((r) => r.passFailResult === 'FAIL').length} failed.`,
    },
    {
      keywords: ['how many form', 'forms', 'template', 'checklist'],
      run: () => `${templates.length} form(s), ${activeTemplates.length} active. ${list(templates.slice(0, 4).map((t) => t.title), 4)}.`,
    },
    {
      keywords: ['how many site', 'number of site', 'sites', 'site', 'location'],
      run: () => `${sites.length} site(s)${sites.length ? `: ${list(sites.map((s) => s.name), 5)}` : ' — add them under Sites'}.`,
    },
    {
      keywords: ['which site', 'busiest', 'most inspection', 'most', 'riskiest'],
      run: () => {
        const m = {}
        ;[...scheduledTasks, ...records].forEach((x) => { const n = x.siteName; if (n) m[n] = (m[n] || 0) + 1 })
        const bd = Object.entries(m).sort((a, b) => b[1] - a[1])
        return bd.length ? `Busiest site: ${bd[0][0]} (${bd[0][1]} inspections). ${bd.length > 1 ? `Next: ${bd.slice(1, 3).map(([s, n]) => `${s} (${n})`).join(', ')}.` : ''}` : 'No inspections tied to a site yet.'
      },
    },
    {
      keywords: ['how many inspection', 'completed', 'records', 'history', 'done'],
      run: () => `${records.length} completed inspection(s)${pr !== null ? `, ${pr}% pass rate` : ''}. ${records.slice(0, 3).map((r) => `${r.templateTitle} (${r.score}%)`).join(', ')}`,
    },
    {
      keywords: ['summary', 'overview', 'overall', 'status', 'snapshot', 'how are we', 'how is it', 'brief', 'where do we stand'],
      run: () => `Snapshot: ${templates.length} form(s) (${activeTemplates.length} active), ${scheduledTasks.length} scheduled — ${dueTodayTasks.length} due today, ${overdueTasks.length} overdue. ${records.length} completed${pr !== null ? `, ${pr}% pass rate` : ''}. ${sites.length} site(s).`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey', 'yo'],
      run: () => 'Hi, I’m Sam! I read your live inspection data. Ask me for a summary, what’s overdue or due today, your pass rate, how many forms/sites, the busiest site, or “tell me about <a form or site>”. I can also open pages — try “go to schedule”.',
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

  // ── 3. Nothing matched → offer concrete options ─────────────────────────────
  const qs = suggestedQuestions(pathname)
  return miss(`I’m not sure I follow — want a summary, what’s overdue/due today, your pass rate, or “tell me about <a form or site>”? Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback (no server proxy configured → always null, rules answer) ───────
export function buildAIContext(ctx) {
  const { templates = [], scheduledTasks = [], overdueTasks = [], records = [], sites = [] } = ctx || {}
  return {
    totals: { forms: templates.length, scheduled: scheduledTasks.length, overdue: overdueTasks.length, completed: records.length, sites: sites.length },
  }
}

// No serverless AI endpoint in this app — return null so the caller uses the
// rule-based answer. (Mirrors HIRA's askAI signature for portability.)
export async function askAI() {
  return null
}
