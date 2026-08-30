// Turn the raw Metabase dumps into the compact dataset the dashboard embeds.
//
// WHY THIS EXISTS RATHER THAN SHIPPING THE JSON. A published Artifact cannot
// call Metabase — the CSP blocks every external host, and putting a warehouse
// API key in a page anyone can open would be worse than the CSP not blocking
// it. So the page carries its own data, and the from/to filter can only reach
// inside what is baked in. Twelve months of raw dumps are ~30MB, well past the
// 16MB page cap, so the rows are columnar and dictionary-encoded here: every
// repeated string (507 centre names, 28 cities, 160 checkpoints) becomes one
// entry in a lookup plus a small integer per row.
//
// Nothing is aggregated. The page re-buckets by day/week/month/quarter/half/
// year on the client, which it can only do if it still has the individual
// audits and tickets — so the job here is to make rows SMALL, not fewer.
//
//   node build.mjs
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.join(import.meta.dirname, 'raw')
const OUT = path.join(import.meta.dirname, 'data.json')

// The audit's own pass mark, taken from the question's SQL rather than assumed:
//   case when final.CAS_Score >= 90 then 'PASS' ... else 'FAIL'
// Baking the scores and deriving PASS/FAIL on the client costs three columns
// less; the assertion below proves the derivation matches what Metabase said.
const PASS_MARK = 90

const EPOCH = Date.UTC(2025, 0, 1)
const dayNum = (iso) => Math.round((Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) - EPOCH) / 86400000)

const readAll = (prefix) =>
  fs.readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))

/** A string→index lookup that builds its own dictionary as it goes. */
function dict() {
  const list = []
  const seen = new Map()
  const put = (v) => {
    // Empty and null collapse onto index 0, which the page prints as "—".
    // A blank city and a missing city are the same thing to a reader.
    const s = v === null || v === undefined || v === '' ? '—' : String(v)
    let i = seen.get(s)
    if (i === undefined) { i = list.length; list.push(s); seen.set(s, i) }
    return i
  }
  return { put, list }
}

// Round to one decimal. A CAS score carries fifteen significant digits out of
// Trino — 96.22641509433963 — and the page never shows more than one, so the
// rest is a megabyte of noise across forty thousand rows.
const r1 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10)

// ── Audits ───────────────────────────────────────────────────────────────────

const rawAudits = readAll('audits_')
const auditSeen = new Set()
const D = {
  center: dict(), city: dict(), bl: dict(), own: dict(),
  ctype: dict(), atype: dict(), auditor: dict(),
}
const A = { d: [], center: [], city: [], bl: [], own: [], ctype: [], atype: [], auditor: [], s0: [], s7: [], sc: [] }

let mismatch = 0
for (const r of rawAudits) {
  // Chunks are fetched by date span so they should not overlap, but a boundary
  // audit appearing in two spans would silently double a pass rate.
  if (auditSeen.has(r.task_instance_id)) continue
  auditSeen.add(r.task_instance_id)

  const s0 = r1(r.Oringinal_calcultated_CAS_score)
  const s7 = r1(r.cas_seven_day_score)
  const sc = r1(r.cas_current_day_score)

  // Does score >= 90 actually reproduce the PASS/FAIL the question returned?
  // Checked on the unrounded value, since a 89.96 rounds to 90.0 and would
  // flip. Any drift here means the client-side derivation is unsafe.
  const check = (score, verdict) => {
    if (score === null || score === undefined || !verdict) return
    const derived = Number(score) >= PASS_MARK ? 'PASS' : 'FAIL'
    if (derived !== verdict) mismatch++
  }
  check(r.Oringinal_calcultated_CAS_score, r.Oringinal_calcultated_CAS_score_result)
  check(r.cas_seven_day_score, r.cas_seven_day_result)
  check(r.cas_current_day_score, r.cas_current_day_result)

  A.d.push(dayNum(r.start_date))
  A.center.push(D.center.put(r.centername))
  A.city.push(D.city.put(r.cityName))
  A.bl.push(D.bl.put(r.business_line))
  A.own.push(D.own.put(r.ownership_type))
  A.ctype.push(D.ctype.put(r.center_type_1))
  A.atype.push(D.atype.put(r.TypeOfAudit))
  A.auditor.push(D.auditor.put(String(r.Auditor_Name || '').replace(/\s+(Curefit|Cultfit)$/i, '')))
  A.s0.push(s0); A.s7.push(s7); A.sc.push(sc)
}

// ── Tickets ──────────────────────────────────────────────────────────────────

const rawTickets = readAll('tickets_')
const tSeen = new Set()
const TD = { center: dict(), city: dict(), bl: dict(), own: dict(), ctype: dict(), st: dict(), sla: dict(), prio: dict(), l1: dict(), l2: dict(), cp: dict(), label: dict() }
const T = { d: [], center: [], city: [], bl: [], own: [], ctype: [], st: [], sla: [], prio: [], l1: [], l2: [], cp: [], label: [], tat: [], wh: [] }

for (const r of rawTickets) {
  if (tSeen.has(r.ticket_id)) continue
  tSeen.add(r.ticket_id)
  T.d.push(dayNum(r.ticket_date))
  T.center.push(TD.center.put(r.center_name))
  T.city.push(TD.city.put(r.city_name))
  T.bl.push(TD.bl.put(r.business_line))
  T.own.push(TD.own.put(r.ownership_type))
  T.ctype.push(TD.ctype.put(r.center_type))
  T.st.push(TD.st.put(r.ticket_status))
  T.sla.push(TD.sla.put(r.SLA_status))
  T.prio.push(TD.prio.put(r.priority_flag))
  T.l1.push(TD.l1.put(r.L1_tag))
  T.l2.push(TD.l2.put(r.L2_Tag))
  // The checkpoint question, trimmed. These are full sentences ("Are all
  // extinguishers placed on metal stands...") and they are the most useful
  // string in the dump — they say WHAT failed, not just that something did.
  T.cp.push(TD.cp.put(String(r.checkpoint || '').trim().slice(0, 160)))
  T.label.push(TD.label.put(String(r.labels || '').replace(/^\[|\]$/g, '')))
  T.tat.push(r.tat_closure_hour === null || r.tat_closure_hour === undefined ? null : Math.round(Number(r.tat_closure_hour)))
  T.wh.push(r.actual_working_hrs === null || r.actual_working_hrs === undefined ? null : Math.round(Number(r.actual_working_hrs)))
}

// ── Coverage ─────────────────────────────────────────────────────────────────
//
// The page prints this. A from/to picker that silently returns nothing outside
// the fetched window is a bug report waiting to happen, so the window is stated
// and the picker is clamped to it.
const span = (arr) => (arr.length ? [Math.min(...arr), Math.max(...arr)] : [0, 0])
const isoOf = (n) => new Date(EPOCH + n * 86400000).toISOString().slice(0, 10)
const [aMin, aMax] = span(A.d)
const [tMin, tMax] = span(T.d)

const payload = {
  meta: {
    epoch: '2025-01-01',
    passMark: PASS_MARK,
    builtAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    audits: { from: isoOf(aMin), to: isoOf(aMax), n: A.d.length, card: 68611, name: 'Dynamic FLS Audit Score-V3' },
    tickets: { from: isoOf(tMin), to: isoOf(tMax), n: T.d.length, card: 80321, name: 'QFLS Audit Tickets Dump' },
    from: isoOf(Math.min(aMin, tMin)),
    to: isoOf(Math.max(aMax, tMax)),
  },
  auditDims: Object.fromEntries(Object.entries(D).map(([k, v]) => [k, v.list])),
  audits: A,
  ticketDims: Object.fromEntries(Object.entries(TD).map(([k, v]) => [k, v.list])),
  tickets: T,
}

fs.writeFileSync(OUT, JSON.stringify(payload))
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2)

console.log(`audits  ${A.d.length} rows  ${payload.meta.audits.from} .. ${payload.meta.audits.to}  (${rawAudits.length - A.d.length} dupes dropped)`)
console.log(`tickets ${T.d.length} rows  ${payload.meta.tickets.from} .. ${payload.meta.tickets.to}  (${rawTickets.length - T.d.length} dupes dropped)`)
console.log(`dictionaries: centers ${D.center.list.length}, cities ${D.city.list.length}, auditors ${D.auditor.list.length}, checkpoints ${TD.cp.list.length}`)
console.log(`pass/fail derivation mismatches vs Metabase: ${mismatch}`)
console.log(`data.json ${mb} MB`)
if (mismatch) console.error('\n!! score >= 90 does NOT reproduce the question\'s PASS/FAIL. Bake the verdicts instead of deriving them.')
