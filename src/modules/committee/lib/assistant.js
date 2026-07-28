// ─────────────────────────────────────────────────────────────────────────────
// Sam — the HSE Committee guide. Rule-based insight engine over the live org
// data (meetings, CAPA actions, sites): per-page onboarding tips, suggested
// questions, and a scored-intent answer() that reports counts/examples. Mirrors
// the HIRA assistant's API (pageGuide / suggestedQuestions / answer / askAI /
// buildAIContext) so the floating Sam component is a drop-in.
// ─────────────────────────────────────────────────────────────────────────────

const pageOf = (pathname = '') => {
  if (pathname.includes('/users')) return 'users'
  if (pathname.includes('/sites')) return 'sites'
  return 'meetings'
}

const GUIDES = {
  meetings: {
    title: 'Meetings Dashboard',
    tips: [
      'This is your live meeting overview. Use the Site and Category filters to focus the charts.',
      'Donuts show meetings by type and overall CAPA action status; bars show points and status per meeting.',
      'Open the Calendar tab to track which statutory meetings are due per site.',
      'Click “New Meeting” to log minutes, attendees and a CAPA action plan.',
    ],
  },
  users: {
    title: 'Team & Approvals',
    tips: [
      'Approve teammates who sign up to join your organization.',
      'Promote a member to admin, or revoke access, from the members table.',
    ],
  },
  sites: {
    title: 'Facility Sites',
    tips: [
      'Add your facility sites here — they drive the site filters and per-site compliance tracking.',
      'Each meeting is logged against a site.',
    ],
  },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.meetings
}

const COMMON_QS = ['Give me a summary', 'What’s overdue?', 'How many meetings?']
const PAGE_QS = {
  meetings: ['How many open actions?', 'Meetings by type?', 'What should I do first?'],
  users: ['How many pending approvals?', 'How many admins?'],
  sites: ['How many sites?', 'Which site has the most meetings?'],
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
const allActions = (meetings) => meetings.flatMap((m) => (m.actions || []).map((a) => ({ ...a, meeting: m.subject || m.docId })))
const isOpen = (a) => (a.status || 'Open') !== 'Closed'
const isOverdue = (a) => isOpen(a) && a.due && new Date(a.due) < new Date()

const hit = (text) => ({ text, matched: true })
const miss = (text) => ({ text, matched: false })
const nav = (text, to) => ({ text, matched: true, action: { type: 'navigate', to } })

// ── Answering ────────────────────────────────────────────────────────────────
export function answer(question, ctx) {
  const { meetings = [], sites = [], users = [], pathname } = ctx || {}
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your meetings — try “give me a summary” or “what’s overdue?”.')
  const tokens = new Set(qn.split(' '))

  const actions = allActions(meetings)
  const overdue = actions.filter(isOverdue)
  const open = actions.filter(isOpen)
  const byType = MEETING_COUNT_BY(meetings, (m) => m.type || 'Other')
  const bySite = MEETING_COUNT_BY(meetings, (m) => m.siteId || 'Unspecified')

  if (/\b(create|new|start|log|add|make)\b/.test(qn) && /(meeting|minute|committee)/.test(qn))
    return nav('Sure — opening a new meeting form for you. 👷', '/committee?view=new')

  const INTENTS = [
    {
      keywords: ['overdue', 'late', 'past due', 'missed', 'behind'],
      run: () => overdue.length
        ? `${overdue.length} overdue action(s): ${list(overdue.map((a) => a.action || a.owner))}. Open a meeting to update their status.`
        : 'No overdue actions — nice. An action is overdue when its due date has passed and it isn’t Closed.',
    },
    {
      keywords: ['open action', 'open actions', 'in progress', 'pending action', 'outstanding', 'capa', 'to do', 'todo'],
      run: () => open.length
        ? `${open.length} open action(s) (Open / In Progress)${overdue.length ? `, ${overdue.length} overdue` : ''}. e.g. ${list(open.map((a) => a.action || 'Action'))}.`
        : `No open actions — all ${actions.length} CAPA action(s) are Closed (or none added yet).`,
    },
    {
      keywords: ['what should i', 'what do i do', 'what next', 'priorit', 'focus', 'first', 'urgent'],
      run: () => overdue.length
        ? `Start with ${overdue.length} overdue action(s): ${list(overdue.map((a) => a.action || 'Action'), 2)}.`
        : open.length ? `Work through ${open.length} open action(s): ${list(open.map((a) => a.action || 'Action'), 2)}.`
          : 'You’re in good shape — no open or overdue actions. Log your next committee meeting from the New Meeting tab.',
    },
    {
      keywords: ['by type', 'type of meeting', 'meeting type', 'kinds of meeting', 'categories'],
      run: () => byType.length ? `Meetings by type: ${byType.map(([t, n]) => `${t} (${n})`).join(', ')}.` : 'No meetings logged yet.',
    },
    {
      keywords: ['which site', 'busiest', 'most meeting', 'site with most', ' site', 'facility', 'plant'],
      run: () => {
        if (qn.includes('how many') || qn.includes('number of')) return `${sites.length} site(s) configured${sites.length ? `: ${list(sites.map((s) => s.name || s.code), 5)}` : ''}.`
        return bySite.length ? `Busiest site by meetings: ${bySite[0][0]} (${bySite[0][1]}).${bySite.length > 1 ? ` Next: ${bySite.slice(1, 3).map(([s, n]) => `${s} (${n})`).join(', ')}.` : ''}` : 'No meetings logged yet.'
      },
    },
    {
      keywords: ['how many site', 'number of site', 'sites configured', 'how many facilit'],
      run: () => `${sites.length} site(s) configured${sites.length ? `: ${list(sites.map((s) => s.name || s.code), 5)}` : ''}.`,
    },
    {
      keywords: ['pending', 'approval', 'approve', 'request to join', 'waiting'],
      run: () => {
        const p = users.filter((u) => u.status === 'pending').length
        return p ? `${p} member(s) awaiting approval. Open Team & Approvals to review them.` : 'No pending approvals right now.'
      },
    },
    {
      keywords: ['admin', 'who are the admin', 'how many admin'],
      run: () => {
        const a = users.filter((u) => u.role === 'admin').map((u) => u.name || u.email)
        return a.length ? `${a.length} admin(s): ${list(a, 5)}.` : 'No admins found.'
      },
    },
    {
      keywords: ['how many meeting', 'total meeting', 'number of meeting', 'meetings held', 'how many committee'],
      run: () => `${meetings.length} meeting(s) logged${byType.length ? ` — ${byType.map(([t, n]) => `${t}: ${n}`).join(', ')}` : ''}.`,
    },
    {
      keywords: ['summary', 'overview', 'overall', 'status', 'snapshot', 'how are we', 'situation', 'dashboard', 'state of'],
      run: () => `Snapshot: ${meetings.length} meeting(s), ${actions.length} CAPA action(s) — ${open.length} open, ${overdue.length} overdue, ${actions.length - open.length} closed. ${sites.length} site(s).`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey', 'yo'],
      run: () => 'Hi, I’m Sam! I read your live data. Ask me for a summary, what’s overdue, open actions, meetings by type, the busiest site, pending approvals — or say “create a meeting”.',
    },
  ]

  let best = null, bestScore = 0
  for (const intent of INTENTS) {
    let s = 0
    for (const k of intent.keywords || []) if (qn.includes(k)) s++
    for (const k of intent.tokenKeywords || []) if (tokens.has(k)) s++
    if (s > bestScore) { bestScore = s; best = intent }
  }
  if (best && bestScore > 0) return hit(best.run())

  const qs = suggestedQuestions(pathname)
  return miss(`I’m not sure I follow — did you want a summary, your overdue/open actions, meetings by type, or the busiest site? Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

function MEETING_COUNT_BY(meetings, keyFn) {
  const m = {}
  for (const mt of meetings) { const k = keyFn(mt); m[k] = (m[k] || 0) + 1 }
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback (optional; no backend → returns null, caller uses the rule text) ─
export function buildAIContext(ctx) {
  const { meetings = [], sites = [], users = [] } = ctx || {}
  const actions = allActions(meetings)
  return {
    totals: { meetings: meetings.length, actions: actions.length, sites: sites.length, members: users.length },
    actions: { open: actions.filter(isOpen).length, overdue: actions.filter(isOverdue).length, closed: actions.filter((a) => !isOpen(a)).length },
    meetingsByType: MEETING_COUNT_BY(meetings, (m) => m.type || 'Other').map(([type, n]) => ({ type, count: n })),
    sites: sites.map((s) => s.name || s.code),
  }
}

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
