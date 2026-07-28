// ─────────────────────────────────────────────────────────────────────────────
// HECP Safety Bot ("Sam") — rule-based insight engine. Pure functions over the
// live org data (no LLM): per-page tips, suggested questions, and a scored-intent
// answer() that understands free-typed questions and reports counts/examples from
// procedures, lock status, sites, technicians, the lock inventory and the
// activity log. Falls back to a server-side AI proxy (askAI) only when no rule
// matches. All guidance is tailored to Lockout/Tagout and cites OSHA 1910.147.
// ─────────────────────────────────────────────────────────────────────────────
import { LOCK_STATUS } from '../constants/procedures'
import { collectInUseLockNos, lockoutDeviceTally } from '../utils/lockout'
import { numberIsolationPoints } from '../utils/codes'
import { pointDeviceKeys, deviceLabel } from '../constants/energySources'

const OSHA =
  'See OSHA 29 CFR 1910.147: https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147.'

const pageOf = (pathname = '') => {
  if (pathname.includes('/inventory')) return 'inventory'
  if (pathname.includes('/register')) return 'register'
  if (pathname.includes('/operations')) return 'operations'
  if (pathname.includes('/procedures/new') || pathname.includes('/revise')) return 'create'
  if (pathname.includes('/procedures/')) return 'detail'
  if (pathname.includes('/sites')) return 'sites'
  if (pathname.includes('/technicians')) return 'technicians'
  if (pathname.includes('/locks')) return 'locks'
  if (pathname.includes('/approvals')) return 'approvals'
  if (pathname.includes('/users')) return 'users'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'Your live LOTO overview. Use the Site filter to focus the stats and charts.',
      'Watch the lock cards — “Fully Locked” / “Partially Locked” show what is energized-out right now.',
      '“Locked Equipment” lists everything currently locked; click a row to open it.',
    ],
  },
  create: {
    title: 'Create Procedure',
    tips: [
      'Pick the Organization + Site (dropdown) and name the equipment.',
      'Add one isolation point per energy source — they auto-number (E-1, M-1…) and colour-code.',
      'Each point: energy source, LOTO device(s), isolation details, hazard, photo, verification.',
      'Save → it starts as Draft and must be Approved before anyone can perform LOTO on it.',
    ],
  },
  inventory: {
    title: 'Procedure Inventory',
    tips: [
      'Every procedure with its status + lock state. Filter by site / equipment / status.',
      'Select rows to bulk-print PDFs and energy-tag sheets.',
    ],
  },
  register: {
    title: 'LOTO Register',
    tips: [
      'Live Status shows which equipment is locked / partially locked, and what still needs locking.',
      'Activity Log is a permanent record of every lock / unlock / group action.',
    ],
  },
  operations: {
    title: 'LOTO Operations',
    tips: [
      'Lock and unlock each isolation point here (approved procedures only).',
      'Once fully locked, add a Group Lock; group technicians must be removed before the primary lock.',
    ],
  },
  sites: { title: 'Sites', tips: ['Add your sites/locations — they power the Site dropdown and the dashboard filter.'] },
  technicians: { title: 'Technicians', tips: ['Authorized technicians + their dedicated personal lock no. (also shown in Lock Inventory).'] },
  locks: { title: 'Lock Inventory', tips: ['Department locks for LOTO. In-use locks show where they are applied; personal locks come from Technicians.'] },
  approvals: { title: 'Approvals', tips: ['Approve pending members and assign a role; that seeds their permissions.'] },
  detail: { title: 'Procedure', tips: ['Review the procedure, generate the PDF / energy tags, send for approval, approve, revise or delete.'] },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}

const COMMON_QS = ['Give me a summary', "What's locked right now?", 'Recent activity?']
const PAGE_QS = {
  dashboard: ['What needs my attention?', 'How many pending approval?', 'Which site has the most procedures?'],
  register: ["What's partially locked?", "What still needs locking?", "What's fully locked?"],
  operations: ['How do I lock out equipment?', 'What is a group lock?'],
  inventory: ['How many approved procedures?', 'What lockout devices are used?', 'How many drafts?'],
  create: ['What goes in an isolation point?', 'When can a procedure be performed?'],
  locks: ['How many locks are available?', 'Which locks are in use?'],
  technicians: ['How many technicians?'],
  sites: ['Which site has the most procedures?', 'How many sites?'],
  approvals: ['How many pending approval?'],
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

/** Aggregate the live data into the figures the bot reasons over. */
export function buildStats({ procedures = [], sites = [], technicians = [], locks = [] }) {
  const status = { draft: 0, pending_approval: 0, approved: 0, rejected: 0 }
  const lock = { unlocked: 0, partial: 0, locked: 0 }
  let points = 0
  let lockedPoints = 0
  let groupActive = 0
  const bySite = {}
  const deviceDefined = {} // device key → # isolation points using it
  const deviceInUse = {} // device key → # currently applied (incl. group hardware)
  procedures.forEach((p) => {
    if (status[p.status] != null) status[p.status] += 1
    const ls = p.lockSummary?.status || LOCK_STATUS.UNLOCKED
    if (lock[ls] != null) lock[ls] += 1
    points += (p.isolationPoints || []).length
    lockedPoints += (p.isolationPoints || []).filter((pt) => pt.lockState?.locked).length
    if (p.groupLock?.active) groupActive += 1
    const s = p.site || 'Unspecified'
    bySite[s] = (bySite[s] || 0) + 1
    ;(p.isolationPoints || []).forEach((pt) => {
      pointDeviceKeys(pt).forEach((k) => { deviceDefined[k] = (deviceDefined[k] || 0) + 1 })
    })
    Object.entries(lockoutDeviceTally(p)).forEach(([k, v]) => { deviceInUse[k] = (deviceInUse[k] || 0) + v })
  })
  const inUse = collectInUseLockNos(procedures)
  const deptLocks = locks.filter((l) => l.type === 'department')
  const availableDept = deptLocks.filter((l) => l.active !== false && !inUse.has(l.lockNo)).length
  return {
    total: procedures.length,
    status,
    lock,
    points,
    lockedPoints,
    groupActive,
    siteBreakdown: Object.entries(bySite).sort((a, b) => b[1] - a[1]),
    sites: sites.map((s) => s.name).filter(Boolean),
    technicians: technicians.length,
    locks: { total: locks.length, department: deptLocks.length, availableDept, inUse: inUse.size },
    devices: { defined: deviceDefined, inUse: deviceInUse },
  }
}

const lockedList = (procedures) =>
  procedures.filter((p) => (p.lockSummary?.status || LOCK_STATUS.UNLOCKED) !== LOCK_STATUS.UNLOCKED)
const partialList = (procedures) =>
  procedures.filter((p) => p.lockSummary?.status === LOCK_STATUS.PARTIAL)

// Concise LOTO guidance, always citing OSHA. null when the topic isn't recognised.
function guidanceAnswer(qn) {
  if (qn.includes('hierarch') || qn.includes('control measure') || qn.includes('types of control'))
    return `Use the hierarchy of controls — Elimination, Substitution, Engineering, Administrative, then PPE — and exhaust the higher levels before PPE. ${OSHA}`
  if ((qn.includes('how') && (qn.includes('lock out') || qn.includes('lockout') || qn.includes('loto'))) || qn.includes('steps') || qn.includes('procedure for'))
    return `LOTO sequence: 1) prepare/notify affected employees, 2) shut down the equipment, 3) isolate every energy source, 4) apply locks & tags, 5) release stored/residual energy, 6) verify a zero-energy state before work. Reverse to restore. ${OSHA}`
  if (qn.includes('group lock') || (qn.includes('group') && qn.includes('lock')))
    return `Group lockout: the equipment is secured with a department lock and each authorized technician applies their own lock (e.g. to a group lock box or hasp). Remove members' locks one by one; the primary lock comes off last. ${OSHA}`
  if (qn.includes('tag') && !qn.includes('tagout'))
    return `A tag warns others not to operate the device but provides no physical restraint — it must accompany a lock, never replace it. ${OSHA}`
  if (qn.includes('verify') || qn.includes('zero energy') || qn.includes('zero-energy'))
    return `Always verify a zero-energy state after isolating: try-out the start controls, test for voltage/pressure, and confirm stored energy is dissipated — then return controls to off/neutral. ${OSHA}`
  if (qn.includes('what is loto') || qn.includes('what is lockout') || qn.includes('hazardous energy'))
    return `Lockout/Tagout controls hazardous energy (electrical, mechanical, hydraulic, pneumatic, chemical, gravitational) during service/maintenance so equipment can't be started unexpectedly. ${OSHA}`
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
 * ctx = { procedures, events, sites, technicians, locks, pathname }
 */
export function answer(question, ctx) {
  const { procedures = [], events = [], pathname } = ctx || {}
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your LOTO — try “give me a summary” or “what’s locked right now?”.')
  const tokens = new Set(qn.split(' '))
  const stats = buildStats(ctx || {})

  // ── 0. Navigation intents ────────────────────────────────────────────────
  const wantsCreate = /\b(create|new|start|make|begin|add|build)\b/.test(qn) &&
    (qn.includes('procedure') || qn.includes('loto') || qn.includes('lockout'))
  if (wantsCreate) return nav('Sure — opening the Create Procedure page for you. 👷', '/loto/procedures/new')

  // Procedure lookup by equipment name.
  const byEquip = procedures.find((p) => p.equipment && norm(p.equipment).length >= 3 && qn.includes(norm(p.equipment)))
  if (byEquip && /lock|status|hazard|point|about|detail|tell|show|open/.test(qn)) {
    const pts = numberIsolationPoints(byEquip.isolationPoints || [])
    const lockedPts = pts.filter((pt) => pt.lockState?.locked)
    const st = byEquip.lockSummary?.status || LOCK_STATUS.UNLOCKED
    const label = st === LOCK_STATUS.LOCKED ? 'Equipment locked' : st === LOCK_STATUS.PARTIAL ? 'Partially locked' : 'Unlocked'
    return hit(`“${byEquip.equipment}”${byEquip.site ? ` · ${byEquip.site}` : ''}: ${byEquip.status?.replace('_', ' ')}, ${label} (${lockedPts.length}/${pts.length} points). Points: ${list(pts.map((p) => p.pointId), 6)}.`)
  }

  // ── 1. Scored intent registry ────────────────────────────────────────────
  const INTENTS = [
    {
      // LOTO guidance (general knowledge) — must win its topics
      keywords: ['hierarch', 'control measure', 'types of control', 'how to lock', 'how do i lock', 'how to lockout', 'loto step', 'steps', 'procedure for', 'what is loto', 'what is lockout', 'hazardous energy', 'group lock', 'tagout', 'tag out', 'verify', 'zero energy', 'zero-energy', 'best practice', 'guidance', 'osha'],
      run: () => guidanceAnswer(qn) || `For LOTO best practice, ${OSHA}`,
    },
    {
      keywords: ['recent', 'history', 'activity', 'lately', 'latest', 'who locked', 'who did', ' log', 'audit'],
      run: () => {
        if (!events.length) return 'No recorded activity yet. Locking or unlocking an isolation point will show up here.'
        const lines = events.slice(0, 5).map((e) => {
          const act = e.action === 'lock' ? 'locked' : e.action === 'unlock' ? 'unlocked' : e.action === 'group_join' ? 'added a group lock on' : e.action === 'group_leave' ? 'removed a group lock on' : e.action
          return `• ${e.byName || 'Someone'} ${act} ${e.pointId ? `${e.pointId} of ` : ''}${e.equipment || 'equipment'} (${timeAgo(e.at)})`
        })
        return `Recent activity:\n${lines.join('\n')}`
      },
    },
    {
      keywords: ['partial', 'partially', 'needs locking', 'need locking', 'still need', 'incomplete', 'to complete', 'finish locking'],
      run: () => {
        const pl = partialList(procedures)
        if (!pl.length) return 'No equipment is partially locked — everything is either fully locked or unlocked.'
        const detail = pl.slice(0, 4).map((p) => {
          const pts = numberIsolationPoints(p.isolationPoints || [])
          const need = pts.filter((pt) => !pt.lockState?.locked).map((pt) => pt.pointId)
          return `• ${p.equipment} — needs: ${need.join(', ') || '—'}`
        })
        return `${pl.length} partially-locked equipment:\n${detail.join('\n')}`
      },
    },
    {
      keywords: ['locked', 'lock status', "what's locked", 'whats locked', 'energized', 'isolated', 'fully locked', 'equipment locked'],
      run: () => {
        const ll = lockedList(procedures)
        if (!ll.length) return 'Nothing is currently locked out — all equipment is unlocked.'
        return `${stats.lock.locked} fully locked, ${stats.lock.partial} partially locked. Currently locked: ${list(ll.map((p) => p.equipment))}.`
      },
    },
    {
      keywords: ['pending', 'awaiting approval', 'to approve', 'approval', 'approve', 'sign off', 'sign-off'],
      run: () => `${stats.status.pending_approval} procedure(s) pending approval, ${stats.status.approved} approved, ${stats.status.draft} draft, ${stats.status.rejected} rejected.`,
    },
    {
      keywords: ['draft', 'unfinished procedure'],
      run: () => `${stats.status.draft} draft procedure(s). Drafts must be sent for approval and approved before LOTO can be performed.`,
    },
    {
      keywords: ['what should i', 'what do i do', 'what next', 'priorit', 'focus', 'attention', 'urgent', 'where do i start', 'first', 'recommend', 'advice'],
      run: () => {
        const parts = []
        if (stats.status.pending_approval) parts.push(`${parts.length + 1}) ${stats.status.pending_approval} procedure(s) awaiting approval.`)
        const pl = partialList(procedures)
        if (pl.length) parts.push(`${parts.length + 1}) Finish locking ${pl.length} partially-locked equipment: ${list(pl.map((p) => p.equipment), 2)}.`)
        if (stats.status.draft) parts.push(`${parts.length + 1}) ${stats.status.draft} draft(s) to complete and send for approval.`)
        if (!parts.length) return "You're in good shape — nothing pending approval and no partially-locked equipment."
        return `Here’s where to focus:\n${parts.join('\n')}`
      },
    },
    {
      keywords: ['which site', 'busiest', 'most procedure', 'site with most', 'facility', 'plant', ' site'],
      run: () => {
        if (!stats.siteBreakdown.length) return 'No procedures recorded yet.'
        const [top, n] = stats.siteBreakdown[0]
        return `Busiest site by procedures: ${top} (${n}). ${stats.siteBreakdown.length > 1 ? `Next: ${stats.siteBreakdown.slice(1, 3).map(([s, c]) => `${s} (${c})`).join(', ')}.` : ''}`
      },
    },
    {
      keywords: ['how many site', 'number of site', 'sites'],
      run: () => `${stats.sites.length} site(s)${stats.sites.length ? `: ${list(stats.sites, 5)}` : ' — add them under Admin → Sites'}.`,
    },
    {
      keywords: ['technician', 'who can perform', 'authorized'],
      run: () => `${stats.technicians} authorized technician(s) configured (each with a dedicated personal lock no.).`,
    },
    {
      keywords: ['lock available', 'available lock', 'locks available', 'lock inventory', 'department lock', 'how many lock', 'spare lock', 'free lock', 'in use'],
      run: () => `Lock inventory: ${stats.locks.department} department lock(s), ${stats.locks.availableDept} available, ${stats.locks.inUse} currently in use.`,
    },
    {
      // LOTO device types (padlock, hasp, valve lock, …) defined and in use
      keywords: ['device', 'lockout device', 'loto device', 'hardware', 'padlock', 'hasp', 'valve lock', 'cable lockout', 'plug cover', 'pin in', 'pin out', 'flange', 'type of device', 'what device', 'which device'],
      run: () => {
        const def = Object.entries(stats.devices.defined).sort((a, b) => b[1] - a[1])
        if (!def.length) return 'No LOTO devices recorded yet — add isolation points (each with a device) to a procedure.'
        const used = Object.entries(stats.devices.inUse).sort((a, b) => b[1] - a[1])
        const defStr = def.map(([k, n]) => `${deviceLabel(k)} (${n})`).join(', ')
        const usedStr = used.length ? used.map(([k, n]) => `${deviceLabel(k)} ×${n}`).join(', ') : 'none currently applied'
        return `LOTO devices defined across procedures: ${defStr}. Currently in use: ${usedStr} (incl. group-lock hardware).`
      },
    },
    {
      keywords: ['isolation point', 'how many point', 'energy point'],
      run: () => `${stats.points} isolation point(s) across ${stats.total} procedure(s); ${stats.lockedPoints} currently locked.`,
    },
    {
      keywords: ['how many procedure', 'total procedure', 'procedures', 'number of procedure'],
      run: () => `${stats.total} procedure(s): ${stats.status.approved} approved, ${stats.status.pending_approval} pending, ${stats.status.draft} draft, ${stats.status.rejected} rejected.`,
    },
    {
      keywords: ['group lock', 'group'],
      run: () => `${stats.groupActive} equipment with an active group lock. ${guidanceAnswer('group lock')}`,
    },
    {
      keywords: ['summary', 'overview', 'overall', 'status', 'how are we', 'snapshot', 'brief', 'situation', 'dashboard', 'where do we stand', 'is it safe', 'safe'],
      run: () => `Snapshot: ${stats.total} procedure(s) — ${stats.status.approved} approved, ${stats.status.pending_approval} pending approval. Locks: ${stats.lock.locked} fully locked, ${stats.lock.partial} partially locked, ${stats.lock.unlocked} unlocked. ${stats.points} isolation points (${stats.lockedPoints} locked). ${stats.locks.inUse} lock(s) in use.`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey', 'yo'],
      run: () => "Hi, I'm Sam — I read your live LOTO data. Ask me for a summary, what's locked or partially locked, pending approvals, the busiest site, your lock inventory, recent activity, or “tell me about <equipment>”. I can also give OSHA-based LOTO guidance.",
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

  // ── 2. Nothing matched → clarify or defer to AI ──────────────────────────
  const equipGuess = closest(qn, procedures.map((p) => p.equipment).filter(Boolean))
  if (equipGuess && /procedure|lock|equipment|about|detail|show|tell|point/.test(qn))
    return hit(`Did you mean “${equipGuess}”? Try “tell me about ${equipGuess}”.`)

  const safetyish = /lock|loto|tagout|energy|isolat|hazard|safety|osha|procedure|approv|technician|site/.test(qn)
  if (safetyish)
    return miss(`Could you be more specific? Ask about your locked / partially-locked equipment, pending approvals, lock inventory, sites, or a specific equipment — or for guidance, ${OSHA}`)

  const qs = suggestedQuestions(pathname)
  return miss(`I’m not sure I follow — want a summary, what’s locked, pending approvals, or “tell me about <equipment>”? Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback ───────────────────────────────────────────────────────────────
/** Compact, data-only snapshot for the LLM (aggregate figures already in-app). */
export function buildAIContext(ctx) {
  const { procedures = [], events = [] } = ctx || {}
  const stats = buildStats(ctx || {})
  const equipment = procedures.slice(0, 50).map((p) => ({
    equipment: p.equipment || 'Untitled',
    site: p.site || '',
    status: p.status || '',
    lock: p.lockSummary?.status || 'unlocked',
    points: (p.isolationPoints || []).length,
    lockedPoints: (p.isolationPoints || []).filter((pt) => pt.lockState?.locked).length,
    groupLock: !!p.groupLock?.active,
  }))
  const recentActivity = events.slice(0, 10).map((e) => ({
    who: e.byName, action: e.action, equipment: e.equipment, point: e.pointId, when: timeAgo(e.at),
  }))
  return {
    totals: { procedures: stats.total, isolationPoints: stats.points, lockedPoints: stats.lockedPoints },
    status: stats.status,
    lockStates: stats.lock,
    groupLocksActive: stats.groupActive,
    sites: stats.sites,
    siteBreakdown: stats.siteBreakdown.slice(0, 8).map(([site, count]) => ({ site, count })),
    technicians: stats.technicians,
    lockInventory: stats.locks,
    devices: {
      defined: Object.fromEntries(Object.entries(stats.devices.defined).map(([k, v]) => [deviceLabel(k), v])),
      inUse: Object.fromEntries(Object.entries(stats.devices.inUse).map(([k, v]) => [deviceLabel(k), v])),
    },
    equipment,
    recentActivity,
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
