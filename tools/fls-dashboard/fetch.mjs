// Pull the two Metabase questions the FLS dashboard is built from.
//
// Both are heavy Trino queries, so they are fetched in CHUNKS rather than one
// span: the ticket dump (80321) crashed a worker node on a 90-day request and
// returned a 500, and a chunk that fails can be retried on its own instead of
// throwing away twenty minutes of successful work. Chunks are also resumable —
// a file that already exists is skipped, so re-running this after a failure
// costs only the months that are actually missing.
//
// The API key is read from the environment. It is a bearer credential for the
// whole warehouse and never belongs in a file that could be committed.
//
//   MB_KEY='mb_...' node fetch.mjs
import fs from 'node:fs'
import path from 'node:path'

const KEY = process.env.MB_KEY
if (!KEY) {
  console.error('Set MB_KEY to your Metabase API key.')
  process.exit(1)
}
const ORIGIN = process.env.MB_URL || 'https://metabase.curefit.co'
const DIR = path.join(import.meta.dirname, 'raw')

// The window the dashboard can filter inside. The from/to picker cannot reach
// past what was fetched, so this is the real limit on the shipped page.
const FROM = process.env.MB_FROM || '2025-09-01'
const TO = process.env.MB_TO || '2026-08-30'

const card = (id) => JSON.parse(fs.readFileSync(path.join(DIR, `card_${id}.json`), 'utf8'))
const paramsOf = (id) => Object.fromEntries((card(id).parameters || []).map((p) => [p.slug, p]))

/** Inclusive month starts from FROM to TO, as [start, end] date pairs. */
function months(from, to) {
  const out = []
  const end = new Date(`${to}T00:00:00Z`)
  let cur = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
    const last = new Date(next.getTime() - 86400000)
    out.push([
      cur.toISOString().slice(0, 10) < from ? from : cur.toISOString().slice(0, 10),
      last.toISOString().slice(0, 10) > to ? to : last.toISOString().slice(0, 10),
    ])
    cur = next
  }
  return out
}

/** Group months into spans of `n`, so a cheap query needs fewer round trips. */
const spans = (list, n) =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) =>
    [list[i * n][0], list[Math.min(i * n + n, list.length) - 1][1]])

async function runCard(id, start, end, startSlug, endSlug, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 2) {
    console.log(`  skip ${path.basename(out)} (have it)`)
    return
  }
  const p = paramsOf(id)
  const body = {
    parameters: [
      { id: p[startSlug].id, type: 'date/single', target: p[startSlug].target, value: start },
      { id: p[endSlug].id, type: 'date/single', target: p[endSlug].target, value: end },
    ],
  }
  // Two attempts. The failure this retries is a Trino worker falling over under
  // load, which is transient and usually clears on its own — not a bad request,
  // which would fail the same way twice and is reported rather than looped on.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now()
    const res = await fetch(`${ORIGIN}/api/card/${id}/query/json`, {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    })
    const text = await res.text()
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    if (res.ok && text.startsWith('[')) {
      fs.writeFileSync(out, text)
      const n = JSON.parse(text).length
      console.log(`  ${start}..${end} -> ${n} rows, ${(text.length / 1e6).toFixed(1)}MB, ${secs}s`)
      return
    }
    console.log(`  ${start}..${end} -> FAILED (attempt ${attempt}, ${secs}s): ${text.slice(0, 160)}`)
    if (attempt === 2) fs.writeFileSync(`${out}.error`, text)
  }
}

const ms = months(FROM, TO)
console.log(`Window ${FROM} .. ${TO} (${ms.length} months)`)

// Audits: light enough to ask for a quarter at a time.
console.log('\nCard 68611 — Dynamic FLS Audit Score V3')
for (const [s, e] of spans(ms, 3)) {
  await runCard(68611, s, e, 'Start', 'End', path.join(DIR, `audits_${s}.json`))
}

// Tickets: one month at a time. Three months at once is what killed the worker.
console.log('\nCard 80321 — QFLS Audit Tickets Dump')
for (const [s, e] of ms) {
  await runCard(80321, s, e, 'sd', 'ed', path.join(DIR, `tickets_${s.slice(0, 7)}.json`))
}

console.log('\nDone.')
