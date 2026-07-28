// ─────────────────────────────────────────────────────────────────────────────
// Fire Marshal "Sam" — rule-based safety assistant. Pure functions over the live
// fleet data (no LLM): per-page onboarding tips, suggested questions, and a
// scored-intent answer() that understands free-typed questions and reports
// counts/examples from the extinguisher fleet, refill/defect workflow, quotations
// and dashboard summary. An optional AI fallback (askAI) handles anything the
// rules miss.
// ─────────────────────────────────────────────────────────────────────────────
import {
  deriveStatus, isToBeRefilled, isInProcess, isPhysicalDefect, isRefilledClosed,
  hasQuotation, needsQuotation, severityLabel, toDate, daysUntil,
} from './extinguisherLogic'
import { DEFECT_BY_KEY, STATUS_LABEL } from './constants'
import { AUDIT } from './audit'

const pageOf = (pathname = '') => {
  if (pathname.includes('/aed-dashboard')) return 'aed-dashboard'
  if (pathname.includes('/fas-dashboard')) return 'fas-dashboard'
  if (pathname.includes('/aed')) return 'aed'
  if (pathname.includes('/fas')) return 'fas'
  if (pathname.includes('/repository')) return 'repository'
  if (pathname.includes('/refill-due')) return 'refill-due'
  if (pathname.includes('/in-process')) return 'in-process'
  if (pathname.includes('/physical-defects')) return 'physical-defects'
  if (pathname.includes('/physical-open') || pathname.includes('/physical-closed')) return 'physical-log'
  if (pathname.includes('/closed')) return 'closed'
  if (pathname.includes('/approvals')) return 'approvals'
  if (pathname.includes('/add')) return 'add'
  if (pathname.includes('/bulk-upload')) return 'bulk-upload'
  if (pathname.includes('/qr-print')) return 'qr-print'
  if (pathname.includes('/signages')) return 'signages'
  if (pathname.includes('/mock-drills')) return 'mock-drills'
  if (pathname.includes('/users')) return 'users'
  return 'dashboard'
}

const GUIDES = {
  dashboard: {
    title: 'Dashboard',
    tips: [
      'Your live fleet overview — click any chart slice or bar to filter every widget at once.',
      'KPI cards: Total, Healthy, To Be Refilled, In Process, Physical Defects, Refilled & Closed.',
      'Use the Condition legend at the top to focus on a single defect/due category.',
    ],
  },
  repository: {
    title: 'Repository',
    tips: [
      'Every extinguisher lives here. Filter by Type / Capacity / Entity / Region / Status + search.',
      'Select rows to bulk export, print QR labels, or move to the Recycle Bin.',
      'Per-row actions: submit quotation, send to vendor, resolve defects, edit, report a defect, view QR.',
    ],
  },
  'refill-due': {
    title: 'To Be Refilled',
    tips: [
      'Units due for refill/HPT within 30 days, or flagged Empty / Over-Pressurized.',
      'Submit a vendor quotation first — then "Received by vendor" moves it to In Process.',
    ],
  },
  'in-process': {
    title: 'In Process',
    tips: [
      'Units currently with the vendor for refilling.',
      'When returned, click "Refilled & closed" and set the new Next-Refill / Next-HPT dates.',
    ],
  },
  'physical-defects': {
    title: 'Physical Defects',
    tips: [
      'Units with PIN, stand, hose or handle damage needing physical repair.',
      'Submit a quotation, then "Resolve" once the repair is done.',
    ],
  },
  'physical-log': {
    title: 'Physical Defect Log',
    tips: ['A record of approved physical-defect reports — Open (still active) and Closed (resolved).'],
  },
  closed: {
    title: 'Refilled & Closed',
    tips: ['Completed refill cycles with their updated due dates.'],
  },
  approvals: {
    title: 'Approvals',
    tips: [
      'QR-scan and portal reports land here as "pending".',
      'Approving a defect adds it to the unit; a refill report moves the unit to To Be Refilled.',
    ],
  },
  add: {
    title: 'Add Extinguisher',
    tips: ['Fill the details (Center is required); leave Serial blank for an auto FE-#### serial. A QR code is generated on save.'],
  },
  'bulk-upload': {
    title: 'Bulk Upload',
    tips: ['Download the template, fill one row per extinguisher, upload to preview, then import. Matching Serial Nos overwrite (spec/dates only).'],
  },
  'qr-print': {
    title: 'Print QR Codes',
    tips: ['Select extinguishers and print 3-up A4 QR labels. Scanning a label opens the public status page.'],
  },
  signages: {
    title: 'Safety Signage',
    tips: [
      'Matrix view: sites × signage types — green = available, amber = needs attention, red = missing, grey = not recorded.',
      'Filter by Region, Entity, Type or Condition; export the matrix + details to Excel.',
      'Click a cell to add a record for that site & sign. FERP captures floor coverage (e.g. 6/8 floors).',
    ],
  },
  'mock-drills': {
    title: 'Mock Drills',
    tips: [
      'Pick a scenario to run a drill — complete the checklist, log teams, action log and CAPA, then save.',
      'Each record gets a % score; download a PDF report and attach evidence photos.',
      'Filter the history by site. Ask me "how did our last drill go?".',
    ],
  },
  users: {
    title: 'Team & Approvals',
    tips: ['Approve teammates joining your org and manage roles. Use "List my organization" to make it joinable at signup.'],
  },
  'aed-dashboard': {
    title: 'AED Dashboard',
    tips: [
      'Defibrillator readiness at a glance — Ready, Service due, Out of service, battery/pad expiring and inspection due.',
      '"Data not available" counts AEDs still missing their site, battery or pad expiry — fill those in to clear the flag.',
      'The Open defects panel lists AEDs reported via a QR scan and awaiting approval; the by-site table shows where attention is needed.',
    ],
  },
  aed: {
    title: 'AED Repository',
    tips: [
      'Every defibrillator lives here — each gets a unique auto ID (AED-0001…). Site is picked from your 1P/2P list.',
      'Add records anytime, even without full details; incomplete ones show a "Data N/A" flag. Log inspections with the wrench.',
      'Tick the checkboxes to select rows and delete them in bulk. Only an admin can generate a QR code (the QR button) — once created, anyone can view it and scanning lets staff report a defect.',
    ],
  },
  'fas-dashboard': {
    title: 'FAS Dashboard',
    tips: [
      'Fire-alarm system health across sites — Operational, Service due and Faulty devices, plus service-due-soon.',
      '"Data not available" counts devices still missing their site. Open defects lists QR-scan reports awaiting approval.',
      'The by-type and by-site tables show where faults and overdue services cluster.',
    ],
  },
  fas: {
    title: 'FAS Repository',
    tips: [
      'Fire-alarm panels and devices live here — each gets a unique auto ID (FAS-0001…). Site is picked from your 1P/2P list.',
      'Add records anytime; incomplete ones show a "Data N/A" flag. Log a service with the wrench to reset the next-due date.',
      'Tick the checkboxes to select rows and delete them in bulk. Only an admin can generate a QR code; scanning a device QR lets staff report battery, UPS, hooter and zone faults.',
    ],
  },
}

export function pageGuide(pathname) {
  return GUIDES[pageOf(pathname)] || GUIDES.dashboard
}

const COMMON_QS = ['Give me a summary', "Today's status", 'What needs attention?']
const PAGE_QS = {
  dashboard: ["Today's status", 'What needs attention?', 'How many are due for refill?'],
  repository: ['How many extinguishers?', 'How many need a quotation?', 'What types do we have?'],
  'refill-due': ['How many are due for refill?', 'How many need a quotation?', 'What should I do first?'],
  'in-process': ['How many are in process?', 'How do I close a refill?'],
  'physical-defects': ['How many physical defects?', 'Which defects are most common?'],
  approvals: ['How many pending approvals?', 'What is pending?'],
  add: ['Which extinguisher for an electrical fire?', 'How often should extinguishers be serviced?'],
  signages: ['How many signage records?', 'Which sites are missing signage?', 'Is FERP on all floors?'],
  'mock-drills': ['How many mock drills?', 'How did our last drill go?', "What's our average drill score?"],
  aed: ['How many AEDs?', 'Which AEDs need attention?', 'How do I generate a QR code?'],
  'aed-dashboard': ['How many AEDs are ready?', 'Which AEDs are out of service?', 'What battery/pads are expiring?'],
  fas: ['How many FAS devices?', 'Which panels are faulty?', 'How do I generate a QR code?'],
  'fas-dashboard': ['How many FAS devices are operational?', 'Which are faulty?', 'What service is due?'],
}
export function suggestedQuestions(pathname) {
  const p = pageOf(pathname)
  return [...(PAGE_QS[p] || []), ...COMMON_QS].slice(0, 5)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const list = (names, n = 3) => {
  const shown = names.filter(Boolean).slice(0, n)
  const extra = names.length - shown.length
  return shown.join(', ') + (extra > 0 ? ` and ${extra} more` : '')
}

const extLabel = (e) => e.serialNo || `${e.type || 'Extinguisher'} @ ${e.centerName || 'site'}`

// count occurrences of a key in a [{...}] list by a field accessor
function tally(items, keyFn) {
  const m = {}
  for (const it of items) {
    const k = keyFn(it)
    if (k == null || k === '') continue
    m[k] = (m[k] || 0) + 1
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

const hit = (text) => ({ text, matched: true })
const miss = (text) => ({ text, matched: false })
const nav = (text, to) => ({ text, matched: true, action: { type: 'navigate', to } })

// ── Daily status from the audit log ──────────────────────────────────────────
// "Today" = same calendar day as `now`. Audit `at` is a Firestore Timestamp.
function isSameDay(d, ref) {
  return d && ref && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

/** Summarise today's activity (defects raised, refills, closures) from auditLogs. */
function dailyStatus(auditLogs = [], now = new Date()) {
  const todays = auditLogs.filter((l) => isSameDay(toDate(l.at), now))
  const countOf = (...actions) => todays.filter((l) => actions.includes(l.action)).length
  const defectsRaised = todays.filter((l) => l.action === AUDIT.REPORT_CREATE && /defect/i.test(l.summary || '')).length
  const defectsApproved = todays.filter((l) => l.action === AUDIT.REPORT_APPROVE && /defect/i.test(l.summary || '')).length
  const quotations = countOf(AUDIT.WF_QUOTATION_SUBMITTED)
  const sentToVendor = countOf(AUDIT.WF_SENT_TO_VENDOR)
  const refilledClosed = countOf(AUDIT.WF_REFILLED_CLOSED)
  const defectsResolved = countOf(AUDIT.WF_RESOLVED_DEFECTS)
  const added = countOf(AUDIT.EXT_CREATE, AUDIT.EXT_BULK_CREATE)
  return { total: todays.length, defectsRaised, defectsApproved, quotations, sentToVendor, refilledClosed, defectsResolved, added }
}

// ── Cylinder + center lookups ─────────────────────────────────────────────────
// Pull a serial-looking token (e.g. FE-0001 / FE0001 / "1234") out of a question.
function extractSerial(qn, extinguishers = []) {
  const serials = extinguishers.map((e) => (e.serialNo || '').toLowerCase()).filter(Boolean)
  // exact stored serial appearing anywhere in the (normalised) question
  for (const s of serials) if (s && qn.includes(s)) return s
  // a token like fe 0001 / fe0001 → rejoin and match
  const m = qn.match(/\b(fe[\s-]?\d{1,6}|\d{3,6})\b/)
  if (m) {
    const tok = m[1].replace(/\s|-/g, '')
    const found = serials.find((s) => s.replace(/\s|-/g, '') === tok)
    if (found) return found
  }
  return null
}

/** A human-readable, per-cylinder status line. */
function cylinderStatus(e, now = new Date()) {
  const d = deriveStatus(e, now)
  const bits = [`${severityLabel(e, now)}`]
  if (e.region || e.centerName) bits.push(`at ${[e.centerName, e.region].filter(Boolean).join(', ')}`)
  bits.push(`type ${e.type || '—'}${e.capacity ? ` ${e.capacity}` : ''}`)
  const refillDays = daysUntil(e.dateOfNextRefill, now)
  const hptDays = daysUntil(e.dateOfNextHPT, now)
  const dueBits = []
  if (refillDays != null) dueBits.push(`next refill ${refillDays <= 0 ? `${Math.abs(refillDays)}d overdue` : `in ${refillDays}d`}`)
  if (hptDays != null) dueBits.push(`next HPT ${hptDays <= 0 ? `${Math.abs(hptDays)}d overdue` : `in ${hptDays}d`}`)
  if (d.physicalDefects.length) dueBits.push(`defects: ${d.physicalDefects.map((k) => DEFECT_BY_KEY[k]?.label || k).join(', ')}`)
  if (needsQuotation(e, now)) dueBits.push('awaiting a quotation')
  else if (hasQuotation(e)) dueBits.push('quotation submitted')
  return `🧯 ${e.serialNo || 'Extinguisher'}: ${bits.join(' · ')}${dueBits.length ? `. ${dueBits.join('; ')}.` : '.'}`
}

const ed = (a, b) => { // Levenshtein distance for fuzzy center matching
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[m][n]
}

/** Rank centers by closeness to a typed name (substring first, then edit distance). */
function rankCenters(query, centers) {
  const q = norm(query)
  if (!q) return []
  return centers
    .map((cn) => {
      const n = norm(cn)
      let score = 0
      if (n === q) score = 100
      else if (n.includes(q) || q.includes(n)) score = 60 - Math.abs(n.length - q.length)
      else {
        const dist = ed(q, n)
        const close = Math.max(n.length, q.length)
        if (dist <= Math.max(2, Math.floor(close * 0.4))) score = 40 - dist
      }
      return { center: cn, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

function centerSummary(centerName, extinguishers, now = new Date()) {
  const rows = extinguishers.filter((e) => norm(e.centerName) === norm(centerName))
  if (!rows.length) return `No extinguishers recorded at ${centerName}.`
  const due = rows.filter((e) => isToBeRefilled(e, now)).length
  const proc = rows.filter((e) => isInProcess(e)).length
  const def = rows.filter((e) => isPhysicalDefect(e)).length
  const healthy = rows.filter((e) => deriveStatus(e, now).isHealthy).length
  const parts = [`${rows.length} extinguisher(s)`, `${healthy} healthy`]
  if (due) parts.push(`${due} to be refilled`)
  if (proc) parts.push(`${proc} in process`)
  if (def) parts.push(`${def} with physical defects`)
  return `${centerName}: ${parts.join(', ')}.`
}

// Concise fire-safety guidance, citing the UK HSE. Returns null when the topic
// isn't recognised so the caller can defer to the AI fallback.
const HSE = 'For authoritative guidance see the UK HSE: https://www.hse.gov.uk/.'
function guidanceAnswer(qn) {
  if ((qn.includes('which') || qn.includes('what') || qn.includes('type')) && qn.includes('electric'))
    return `For electrical fires use a CO₂ extinguisher (or a dry-powder one) — never water or foam on live electrics. CO₂ leaves no residue, ideal around equipment. ${HSE}`
  if ((qn.includes('which') || qn.includes('what') || qn.includes('type')) && (qn.includes('kitchen') || qn.includes('cooking') || qn.includes('oil') || qn.includes('fat')))
    return `For cooking-oil/fat fires (Class F) use a wet-chemical extinguisher. Never use water. ${HSE}`
  if (qn.includes('class') && qn.includes('fire'))
    return `Fire classes: A = solids (wood/paper), B = flammable liquids, C = gases, D = metals, E/electrical, F = cooking oils. Match the extinguisher to the class — ABC dry powder covers A, B and electrical; CO₂ for electrical; wet-chemical for F. ${HSE}`
  if (qn.includes('how to use') || qn.includes('how do i use') || qn.includes('pass'))
    return `Use the PASS technique: Pull the pin, Aim at the base of the fire, Squeeze the handle, Sweep side to side. Only tackle a small fire with a clear exit behind you. ${HSE}`
  if (qn.includes('how often') || qn.includes('service') || qn.includes('inspect') || qn.includes('maintenance schedule'))
    return `Best practice (BS 5306): a monthly visual check by the user, an annual "basic" service by a competent person, and an extended service / refill on a longer cycle (commonly 5 years, 10 for CO₂). Track each unit's Next-Refill and Next-HPT dates here. ${HSE}`
  if (qn.includes('hpt') || qn.includes('hydro') || qn.includes('pressure test'))
    return `HPT = Hydrostatic Pressure Test — periodic testing of the cylinder's integrity (commonly every 5 years, 10 for CO₂). The Next-HPT date on each unit flags when it's due. ${HSE}`
  if (qn.includes('refill') && (qn.includes('what') || qn.includes('when') || qn.includes('why')))
    return `An extinguisher needs refilling after any use, when it reads empty/under-pressure, or at its scheduled service. In Fire Marshal it moves: To Be Refilled → (quotation) → Received by vendor → In Process → Refilled & Closed. ${HSE}`
  return null
}

// Fuzzy "did you mean" by shared significant words + substring bonus.
function closest(qn, names = []) {
  const qset = new Set(qn.split(' ').filter((w) => w.length > 2))
  let best = null
  let bestScore = 0
  for (const n of names) {
    if (!n) continue
    let s = 0
    for (const w of norm(n).split(' ')) if (w.length > 2 && qset.has(w)) s++
    if (qn.includes(norm(n)) && norm(n).length > 2) s += 3
    if (s > bestScore) { bestScore = s; best = n }
  }
  return bestScore > 0 ? best : null
}

// ── Safety signage answers ────────────────────────────────────────────────────
const SIGNAGE_TYPE_HINTS = [
  ['stretcher', 'Stretcher Signage'],
  ['fire order', 'Fire Order Signage'],
  ['dug out', 'Dug Out Emergency Contacts'],
  ['ferp', 'FERP Signage'],
  ['lift', 'Lift Emergency Contacts'],
  ['mcp', 'MCP Signage'],
  ['fas', 'FAS Panel Signage'],
  ['assembly', 'Assembly Point'],
  ['fire exit', 'Fire Exit'],
  ['no smoking', 'No Smoking'],
  ['first aid', 'First Aid'],
]
// The site signages the user cares most about — used for coverage scoring.
const KEY_SIGNAGE = [
  'Stretcher Signage', 'Fire Order Signage', 'Dug Out Emergency Contacts', 'FERP Signage',
  'Lift Emergency Contacts', 'MCP Signage', 'FAS Panel Signage',
]
const ferpCov = (s) => (s.allFloors ? s.totalFloors || 0 : s.floorsCovered || 0)

function signageAnswer(qn, c) {
  const sigs = c.signages || []
  const sites = c.sites || []
  if (!sigs.length) return 'No signage recorded yet. Add fire-safety signage under Site Safety → Safety Signage, then I can report coverage by site.'

  const site = sites.find((s) => norm(s).length >= 3 && qn.includes(norm(s)))
  const typeHit = SIGNAGE_TYPE_HINTS.find(([k]) => qn.includes(k))
  const type = typeHit ? typeHit[1] : null

  // FERP floor coverage
  if (type === 'FERP Signage' || qn.includes('ferp') || (qn.includes('floor') && qn.includes('plan'))) {
    const ferps = sigs.filter((s) => s.type === 'FERP Signage')
    if (site) {
      const rec = ferps.filter((s) => norm(s.centerName) === norm(site)).sort((a, b) => (b.totalFloors || 0) - (a.totalFloors || 0))[0]
      if (!rec) return `No FERP signage recorded for ${site} yet.`
      const total = rec.totalFloors || 0, cov = ferpCov(rec)
      return `FERP at ${site}: ${total ? `${cov}/${total} floors${cov >= total ? ' — on all floors ✅' : ' — partial ⚠️'}` : 'recorded'}.`
    }
    if (!ferps.length) return 'No FERP signage recorded yet. Add it with the building floor count under Safety Signage.'
    const allOk = ferps.filter((s) => (s.totalFloors || 0) > 0 && ferpCov(s) >= (s.totalFloors || 0))
    const partial = ferps.filter((s) => (s.totalFloors || 0) > 0 && ferpCov(s) < (s.totalFloors || 0))
    return `FERP recorded at ${ferps.length} site(s): ${allOk.length} on all floors, ${partial.length} partial${partial.length ? ` — ${list(partial.map((s) => `${s.centerName} ${ferpCov(s)}/${s.totalFloors || '?'}`), 3)}` : ' ✅'}.`
  }

  // A specific signage type across sites
  if (type) {
    const recs = sigs.filter((s) => s.type === type)
    if (site) {
      const here = recs.filter((s) => norm(s.centerName) === norm(site))
      return here.length ? `${type} at ${site}: ${here.length} record(s)${here[0].condition ? `, condition ${here.map((s) => s.condition).join('/')}` : ''}.` : `${type} is NOT recorded at ${site}. ⚠️`
    }
    const onSites = new Set(recs.map((s) => s.centerName))
    const missing = sites.filter((s) => !onSites.has(s))
    return `${type}: recorded at ${onSites.size}/${sites.length} site(s) (${recs.length} record(s)).${missing.length ? ` Missing at ${list(missing, 3)}.` : ' Present at every site ✅'}`
  }

  // A whole site's signage
  if (site) {
    const recs = sigs.filter((s) => norm(s.centerName) === norm(site))
    if (!recs.length) return `No signage recorded for ${site} yet.`
    const present = Array.from(new Set(recs.map((s) => s.type)))
    const missingKey = KEY_SIGNAGE.filter((t) => !present.includes(t))
    const issues = recs.filter((s) => s.condition && s.condition !== 'OK')
    return `${site}: ${recs.length} record(s) across ${present.length} type(s).${missingKey.length ? ` Missing key signage: ${list(missingKey, 4)}.` : ' All key signage present ✅.'}${issues.length ? ` ${issues.length} need attention.` : ''}`
  }

  // Coverage / gaps across sites ("which sites are missing signage?")
  if (/gap|coverage|cover|which site|incomplete|complete|least|worst|behind|missing/.test(qn)) {
    const cov = sites.map((s) => {
      const present = new Set(sigs.filter((x) => norm(x.centerName) === norm(s)).map((x) => x.type))
      return { s, n: KEY_SIGNAGE.filter((t) => present.has(t)).length }
    }).sort((a, b) => a.n - b.n)
    const worst = cov.filter((x) => x.n < KEY_SIGNAGE.length)
    if (!worst.length) return `Every site has all ${KEY_SIGNAGE.length} key signage types. ✅`
    return `Signage coverage (of ${KEY_SIGNAGE.length} key types) — lowest: ${list(worst.map((x) => `${x.s} ${x.n}/${KEY_SIGNAGE.length}`), 4)}.`
  }

  // Condition problems (damaged / faded / obstructed / etc.)
  if (/damaged|faded|obstruct|condition|attention|broken|issue|fault/.test(qn)) {
    const issues = sigs.filter((s) => s.condition && s.condition !== 'OK')
    if (!issues.length) return 'All recorded signage is in OK condition. ✅'
    const byCond = tally(issues, (s) => s.condition)
    return `${issues.length} signage item(s) need attention: ${byCond.map(([cn, n]) => `${cn} (${n})`).join(', ')}. e.g. ${list(issues.map((s) => `${s.type} @ ${s.centerName}`), 2)}.`
  }

  // General count + breakdown
  const byType = tally(sigs, (s) => s.type)
  const sitesWith = new Set(sigs.map((s) => s.centerName)).size
  return `${sigs.length} signage record(s) across ${sitesWith} site(s). By type: ${byType.slice(0, 5).map(([t, n]) => `${t} (${n})`).join(', ')}${byType.length > 5 ? '…' : ''}.`
}

// ── Mock drill answers ────────────────────────────────────────────────────────
const drillAvg = (rows) => (rows.length ? Math.round(rows.reduce((a, d) => a + (d.score || 0), 0) / rows.length) : 0)
const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''))

function drillAnswer(qn, c) {
  const drills = c.mockDrills || []
  const sites = c.sites || []
  if (!drills.length) return 'No mock drills recorded yet. Run one under Site Safety → Mock Drills — pick a scenario, complete the checklist, then save.'

  const site = sites.find((s) => norm(s).length >= 3 && qn.includes(norm(s)))

  if (site) {
    const rows = drills.filter((d) => norm(d.centerName) === norm(site))
    if (!rows.length) return `No mock drills recorded for ${site} yet.`
    const last = [...rows].sort(byDateDesc)[0]
    return `${site}: ${rows.length} drill(s), avg score ${drillAvg(rows)}%. Latest: ${last.scenario} on ${last.date || '—'} (${last.score ?? 0}%, ${last.outcome || '—'}).`
  }

  if (/last|recent|latest|how did/.test(qn)) {
    const d = [...drills].sort(byDateDesc)[0]
    return `Most recent: ${d.scenario} at ${d.centerName || '—'} on ${d.date || '—'} — ${d.score ?? 0}%, ${d.outcome || '—'} (${d.eventType || 'Mock Drill'}).`
  }
  if (/real|emergenc/.test(qn)) {
    const real = drills.filter((d) => d.eventType === 'Real Emergency')
    if (!real.length) return `No real emergencies logged — all ${drills.length} record(s) are mock drills. ✅`
    const last = [...real].sort(byDateDesc)[0]
    return `${real.length} real emergency record(s) (vs ${drills.length - real.length} mock drill(s)). Latest: ${last.scenario} @ ${last.centerName || '—'} on ${last.date || '—'}.`
  }
  if (/score|average|avg|pass|fail|perform|outcome/.test(qn)) {
    const low = [...drills].sort((a, b) => (a.score || 0) - (b.score || 0))[0]
    const fails = drills.filter((d) => d.outcome === 'Fail').length
    return `Average drill score ${drillAvg(drills)}% across ${drills.length} drill(s). Lowest: ${low.scenario} @ ${low.centerName || '—'} (${low.score ?? 0}%).${fails ? ` ${fails} failed.` : ''}`
  }
  if (/scenario|which|type|breakdown|kind/.test(qn)) {
    const byScn = tally(drills, (d) => d.scenario)
    return `Drills by scenario: ${byScn.map(([s, n]) => `${s} (${n})`).join(', ')}.`
  }

  const byScn = tally(drills, (d) => d.scenario)
  const sitesWith = new Set(drills.map((d) => d.centerName)).size
  return `${drills.length} drill(s) across ${sitesWith} site(s), avg score ${drillAvg(drills)}%. Top scenarios: ${byScn.slice(0, 3).map(([s, n]) => `${s} (${n})`).join(', ')}.`
}

// ── Answering ────────────────────────────────────────────────────────────────
/**
 * Answer a free-typed question from the live fleet context.
 * ctx = { extinguishers, refillDue, inProcess, physicalDefects, closed,
 *         physicalOpen, pendingReports, summary, stats, pathname }
 */
export function answer(question, ctx) {
  const c = ctx || {}
  const ext = c.extinguishers || []
  const refillDue = c.refillDue || []
  const inProcess = c.inProcess || []
  const physical = c.physicalDefects || []
  const closed = c.closed || []
  const pending = c.pendingReports || []
  const summary = c.summary || {}
  const today = new Date()
  const qn = norm(question)
  if (!qn) return hit('Ask me anything about your extinguishers — try “give me a summary” or “what needs attention?”.')

  // Items awaiting a quotation before they can progress.
  const awaitingQuote = ext.filter((e) => needsQuotation(e, today))
  const quoted = ext.filter((e) => hasQuotation(e))

  const regions = Array.from(new Set(ext.map((e) => e.region).filter(Boolean)))
  const centers = Array.from(new Set(ext.map((e) => e.centerName).filter(Boolean)))

  // ── Cylinder lookup by serial (status of a specific extinguisher) ──
  const serial = extractSerial(qn, ext)
  if (serial) {
    const e = ext.find((x) => (x.serialNo || '').toLowerCase() === serial)
    if (e) return hit(cylinderStatus(e, today))
  }
  // Asked about a cylinder/serial but we couldn't resolve it.
  if (/\b(cylinder|extinguisher|serial|fe[\s-]?\d)\b/.test(qn) && /\b(status|where|detail|about|info|condition)\b/.test(qn) && !serial) {
    // only nudge if they seem to be naming one (has a number or "serial")
    if (/\d/.test(qn) || qn.includes('serial')) {
      return hit('I couldn’t find that serial number. Give me the exact serial (e.g. “status of FE-0001”) and I’ll pull up its condition, dates, defects and quotation.')
    }
  }

  // ── Daily status (from the audit log) ──
  if ((qn.includes('today') || qn.includes('daily') || qn.includes('day')) && /(status|defect|refill|chang|close|activit|happen|summary|report)/.test(qn)) {
    const ds = dailyStatus(c.auditLogs || [], today)
    if (!ds.total) return hit('No recorded activity today yet. Defects raised, quotations, refills and closures will show up here as they happen.')
    const parts = []
    if (ds.defectsRaised) parts.push(`${ds.defectsRaised} defect(s) reported`)
    if (ds.defectsApproved) parts.push(`${ds.defectsApproved} defect(s) approved`)
    if (ds.quotations) parts.push(`${ds.quotations} quotation(s) submitted`)
    if (ds.sentToVendor) parts.push(`${ds.sentToVendor} sent to vendor`)
    if (ds.refilledClosed) parts.push(`${ds.refilledClosed} refilled & closed`)
    if (ds.defectsResolved) parts.push(`${ds.defectsResolved} defect(s) resolved`)
    if (ds.added) parts.push(`${ds.added} extinguisher(s) added`)
    return hit(`Today’s status (${ds.total} change(s)):\n${parts.length ? parts.map((p) => `• ${p}`).join('\n') : '• misc. edits only'}.`)
  }

  // ── Safety signage & mock drills (checked before extinguisher center lookups) ──
  if (/signage|stretcher|\bferp\b|\bmcp\b|fas panel|fire order|dug out|assembly point|lift emergency|order board/.test(qn))
    return hit(signageAnswer(qn, c))
  if (/\bdrills?\b|mock drill|evacuation drill|fire drill|emergency drill|drill score/.test(qn))
    return hit(drillAnswer(qn, c))

  // ── Navigation intent (add an extinguisher) ──
  if (/\b(add|create|new|register)\b/.test(qn) && qn.includes('extinguish'))
    return nav('Opening the Add Extinguisher form for you. 🧯', '/equipment/add')
  if (qn.includes('bulk') || (qn.includes('upload') && qn.includes('many')))
    return nav('Opening Bulk Upload — download the template, fill it, and import. 📥', '/equipment/bulk-upload')

  // ── Center lookup by name (exact, then fuzzy with disambiguation) ──
  const centerExact = centers.find((cn) => norm(cn).length >= 3 && qn.includes(norm(cn)))
  const asksCenter = /\b(center|centre|site|location|facility|branch|at )\b/.test(qn) || qn.includes('cylinders in') || qn.includes('extinguishers in') || qn.includes('extinguishers at')
  if (centerExact) {
    return hit(centerSummary(centerExact, ext, today))
  }
  if (asksCenter && centers.length) {
    // strip leading keywords to isolate the typed name
    const q = qn.replace(/.*\b(center|centre|site|location|facility|branch|in|at)\b/, '').trim() || qn
    const ranked = rankCenters(q, centers)
    if (ranked.length === 1 || (ranked[0] && ranked[0].score >= 60)) {
      return hit(centerSummary(ranked[0].center, ext, today))
    }
    if (ranked.length > 1) {
      return hit(`I found a few centers close to that. Which did you mean?\n${ranked.slice(0, 5).map((r) => `• ${r.center}`).join('\n')}\nAsk “extinguishers at <exact name>”.`)
    }
  }

  // ── Region entity lookup ──
  const regionHit = regions.find((r) => norm(r).length >= 2 && qn.includes(norm(r)))
  if (regionHit) {
    const rows = ext.filter((e) => norm(e.region) === norm(regionHit))
    const due = rows.filter((e) => isToBeRefilled(e, today)).length
    return hit(`${regionHit} region: ${rows.length} extinguisher(s)${due ? `, ${due} due for refill` : ''}.`)
  }

  const tokens = new Set(qn.split(' '))
  const INTENTS = [
    {
      // Fire-safety guidance (general knowledge)
      keywords: ['which extinguish', 'what extinguish', 'type of fire', 'class of fire', 'class fire', 'electric', 'kitchen', 'cooking', 'how to use', 'how do i use', 'pass technique', 'how often', 'service', 'inspect', 'maintenance schedule', 'hpt', 'hydro', 'pressure test', 'guidance', 'best practice'],
      run: () => guidanceAnswer(qn) || HSE,
    },
    {
      // priorities / what needs attention
      keywords: ['attention', 'what should i', 'what do i do', 'priorit', 'urgent', 'focus', 'first', 'recommend', 'advice', 'where do i start', 'action'],
      run: () => {
        const parts = []
        if (awaitingQuote.length) parts.push(`${awaitingQuote.length} unit(s) need a quotation before they can move forward: ${list(awaitingQuote.map(extLabel), 2)}.`)
        const overdue = refillDue.filter((e) => deriveStatus(e, today).flags.REFILL_DUE || deriveStatus(e, today).flags.HPT_DUE)
        if (overdue.length) parts.push(`${overdue.length} unit(s) are overdue for refill/HPT: ${list(overdue.map(extLabel), 2)}.`)
        if (physical.length) parts.push(`${physical.length} physical defect(s) to resolve.`)
        if (pending.length) parts.push(`${pending.length} report(s) awaiting approval.`)
        if (!parts.length) return 'You’re in good shape — nothing overdue, no open defects, and no pending approvals. 🎉'
        return `Here’s where to focus:\n${parts.map((p, i) => `${i + 1}) ${p}`).join('\n')}`
      },
    },
    {
      // quotations
      keywords: ['quotation', 'quote', 'quoted', 'estimate', 'cost'],
      run: () => {
        if (!awaitingQuote.length && !quoted.length) return 'No quotations needed right now — no units are in a refill/defect cycle.'
        return `${awaitingQuote.length} unit(s) still need a quotation before they can progress; ${quoted.length} already have one.${awaitingQuote.length ? ` Awaiting: ${list(awaitingQuote.map(extLabel))}.` : ''}`
      },
    },
    {
      // refill due
      keywords: ['refill', 'due', 'to be refilled', 'overdue', 'expir'],
      run: () => {
        if (!refillDue.length) return 'Nothing is due for refilling right now. 🎉'
        return `${refillDue.length} extinguisher(s) to be refilled (due within 30 days, or flagged empty/over-pressurized): ${list(refillDue.map(extLabel))}.`
      },
    },
    {
      // in process
      keywords: ['in process', 'with vendor', 'being refilled', 'sent to vendor'],
      run: () => inProcess.length
        ? `${inProcess.length} extinguisher(s) in process with the vendor: ${list(inProcess.map(extLabel))}.`
        : 'No extinguishers are currently in process with a vendor.',
    },
    {
      // physical defects
      keywords: ['physical defect', 'defect', 'damage', 'pin', 'hose', 'handle', 'stand', 'broken', 'faulty'],
      run: () => {
        if (!physical.length) return 'No open physical defects — all units are physically intact. 🛠️'
        const byType = tally(physical.flatMap((e) => deriveStatus(e, today).physicalDefects), (k) => DEFECT_BY_KEY[k]?.label || k)
        return `${physical.length} unit(s) with physical defects. Most common: ${byType.slice(0, 3).map(([d, n]) => `${d} (${n})`).join(', ')}.`
      },
    },
    {
      // approvals
      keywords: ['approval', 'pending', 'awaiting', 'to approve', 'review'],
      run: () => pending.length
        ? `${pending.length} report(s) awaiting approval in the Approvals queue.`
        : 'No reports are pending approval right now.',
    },
    {
      // closed / completed
      keywords: ['closed', 'completed', 'refilled and closed', 'done'],
      run: () => `${closed.length} completed refill cycle(s) on record.`,
    },
    {
      // breakdown by type / capacity / entity / region
      keywords: ['what type', 'types', 'by type', 'breakdown', 'capacity', 'entity', 'by region', 'distribution'],
      run: () => {
        const byType = tally(ext, (e) => e.type)
        const byRegion = tally(ext, (e) => e.region)
        return `By type: ${byType.map(([t, n]) => `${t} (${n})`).join(', ') || '—'}.${byRegion.length ? ` By region: ${byRegion.slice(0, 4).map(([r, n]) => `${r} (${n})`).join(', ')}.` : ''}`
      },
    },
    {
      // which region/center has the most
      keywords: ['which region', 'which center', 'which site', 'most', 'busiest', 'worst', 'where'],
      run: () => {
        const byRegion = tally(ext, (e) => e.region)
        const defByRegion = tally(physical, (e) => e.region)
        if (qn.includes('defect') && defByRegion.length) return `Most physical defects: ${defByRegion[0][0]} (${defByRegion[0][1]}).`
        if (!byRegion.length) return 'No region data recorded yet.'
        return `Largest fleet by region: ${byRegion[0][0]} (${byRegion[0][1]}).${byRegion.length > 1 ? ` Next: ${byRegion.slice(1, 3).map(([r, n]) => `${r} (${n})`).join(', ')}.` : ''}`
      },
    },
    {
      // counts / totals / summary
      keywords: ['how many', 'total', 'count', 'summary', 'overview', 'snapshot', 'status', 'how are we', 'how many extinguish'],
      run: () => `Snapshot: ${summary.total ?? ext.length} extinguisher(s) — ${summary.healthy || 0} healthy, ${refillDue.length} to be refilled, ${inProcess.length} in process, ${physical.length} with physical defects, ${closed.length} refilled & closed.${awaitingQuote.length ? ` ${awaitingQuote.length} awaiting a quotation.` : ''}${pending.length ? ` ${pending.length} pending approval.` : ''}`,
    },
    {
      keywords: ['help', 'what can you', 'who are you', 'what do you do'],
      tokenKeywords: ['hi', 'hello', 'hey'],
      run: () => 'Hi! I read your live fleet data. Ask me for a summary, today’s status, what needs attention, refill-due / in-process / defect counts, or a cylinder by serial (e.g. “status of FE-0001”). I also cover Safety Signage (e.g. “which sites are missing signage?”, “is FERP on all floors?”) and Mock Drills (e.g. “how did our last drill go?”, “average drill score?”) — plus general fire-safety guidance.',
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

  // ── Nothing matched → clarify or defer to AI ──
  const centerGuess = closest(qn, centers)
  if (centerGuess && /center|site|location|where|at /.test(qn))
    return hit(`Did you mean the center “${centerGuess}”? Try “extinguishers at ${centerGuess}”.`)

  const safetyish = /fire|extinguish|refill|defect|safety|hpt|pressure|hazard|risk|co2|foam|powder/.test(qn)
  if (safetyish)
    return miss(`Could you be a bit more specific? Ask about refill-due, in-process, physical defects, quotations, pending approvals, or a region/center — or for fire-safety guidance see the HSE: https://www.hse.gov.uk/.`)

  const qs = suggestedQuestions(c.pathname)
  return miss(`I’m not sure I follow — did you want a summary, what needs attention, or a breakdown by type/region? Try: “${qs.slice(0, 3).join('”, “')}”.`)
}

export function answerText(question, ctx) {
  return answer(question, ctx).text
}

// ── AI fallback ───────────────────────────────────────────────────────────────
/** Compact, data-only snapshot for the LLM (aggregates only — no PII). */
export function buildAIContext(ctx) {
  const c = ctx || {}
  const ext = c.extinguishers || []
  const today = new Date()
  const byType = tally(ext, (e) => e.type)
  const byRegion = tally(ext, (e) => e.region)
  const byEntity = tally(ext, (e) => e.entity)
  const byStatus = tally(ext, (e) => STATUS_LABEL[e.status] || e.status)
  const awaitingQuote = ext.filter((e) => needsQuotation(e, today)).length
  return {
    totals: {
      extinguishers: (c.summary?.total) ?? ext.length,
      healthy: c.summary?.healthy || 0,
      toBeRefilled: (c.refillDue || []).length,
      inProcess: (c.inProcess || []).length,
      physicalDefects: (c.physicalDefects || []).length,
      refilledClosed: (c.closed || []).length,
      awaitingQuotation: awaitingQuote,
      pendingApprovals: (c.pendingReports || []).length,
    },
    byType: byType.map(([type, count]) => ({ type, count })),
    byRegion: byRegion.map(([region, count]) => ({ region, count })),
    byEntity: byEntity.map(([entity, count]) => ({ entity, count })),
    byStatus: byStatus.map(([status, count]) => ({ status, count })),
    today: dailyStatus(c.auditLogs || [], today),
    centers: Array.from(new Set(ext.map((e) => e.centerName).filter(Boolean))).slice(0, 50),
    fleetWideTotals: c.stats || null,
    signage: (() => {
      const sigs = c.signages || []
      return {
        total: sigs.length,
        sitesCovered: new Set(sigs.map((s) => s.centerName).filter(Boolean)).size,
        byType: tally(sigs, (s) => s.type).map(([type, count]) => ({ type, count })),
        needingAttention: sigs.filter((s) => s.condition && s.condition !== 'OK').length,
      }
    })(),
    mockDrills: (() => {
      const drills = c.mockDrills || []
      return {
        total: drills.length,
        avgScore: drills.length ? Math.round(drills.reduce((a, d) => a + (d.score || 0), 0) / drills.length) : 0,
        realEmergencies: drills.filter((d) => d.eventType === 'Real Emergency').length,
        byScenario: tally(drills, (d) => d.scenario).map(([scenario, count]) => ({ scenario, count })),
      }
    })(),
  }
}

/** Ask the server-side AI proxy. Returns the answer string or null on any failure. */
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
