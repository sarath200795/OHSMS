// Rebuild the standalone FLS dashboard against a fresh API key.
//
//   node tools/fls-dashboard/refresh.mjs --key mb_xxxxx
//   node tools/fls-dashboard/refresh.mjs               (reuses the saved key)
//
// ── Why this exists ──────────────────────────────────────────────────────────
//
// The dashboard in the app (Analytics → ODIN) queries Metabase live through a
// Cloud Function, and an admin rotates its key in the connection settings. This
// script is for the OTHER artefact: the single self-contained HTML file that
// can be mailed to someone with no login. That file carries its own data and
// cannot call Metabase — a published page is blocked from reaching other hosts,
// and a warehouse API key inside a file anyone can open would be worse than
// that block not existing. So refreshing it means re-fetching here.
//
// ── The three-day key ────────────────────────────────────────────────────────
//
// This instance issues keys that expire every three days, so the key is not
// baked into anything. It is read from --key, then MB_KEY, then a local
// .mbkey file, and the first thing this does is ask Metabase whether it still
// works — a clear "your key expired" beats twenty minutes of failing queries.
// A key passed with --key is saved to .mbkey so the next run needs no argument.
//
// .mbkey is git-ignored. Keep it that way.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = import.meta.dirname
const KEY_FILE = path.join(HERE, '.mbkey')
const RAW = path.join(HERE, 'raw')
const ORIGIN = process.env.MB_URL || 'https://metabase.curefit.co'

// How many days of history the shipped file can be filtered across. The date
// pickers cannot reach outside it, so this is the real limit on the artefact.
const WINDOW_DAYS = Number(process.env.MB_WINDOW_DAYS || 365)

const argKey = (() => {
  const i = process.argv.indexOf('--key')
  return i >= 0 ? process.argv[i + 1] : ''
})()

const key = argKey || process.env.MB_KEY || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '')

if (!key) {
  console.error(`No API key.

  node tools/fls-dashboard/refresh.mjs --key mb_xxxxx

Mint one in Metabase: Settings → Admin → Authentication → API keys.
It is saved to tools/fls-dashboard/.mbkey (git-ignored) for next time.`)
  process.exit(1)
}

// ── Is the key alive? ────────────────────────────────────────────────────────
//
// /api/user/current proves the key without running anybody's query. Checking
// first is the whole point: these queries take half a minute each and there are
// a dozen of them, so failing on the cheap request is worth the round trip.
process.stdout.write('Checking the key… ')
const who = await fetch(`${ORIGIN}/api/user/current`, { headers: { 'x-api-key': key } })
if (!who.ok) {
  console.error(`rejected (HTTP ${who.status}).

${who.status === 401 || who.status === 403
  ? 'This key has expired or been revoked — they last three days on this instance.\nMint a new one and pass it with --key.'
  : 'Metabase would not answer. Check the URL and try again.'}`)
  process.exit(1)
}
const me = await who.json()
console.log(`ok — ${me.common_name || me.email || 'an API user'}`)

// Only save a key that has just been proven to work.
if (argKey) {
  fs.writeFileSync(KEY_FILE, `${argKey}\n`)
  console.log(`Saved to ${path.relative(process.cwd(), KEY_FILE)} — future runs need no --key.`)
}

// ── The rolling window ───────────────────────────────────────────────────────
//
// Chunks already on disk are kept, so a refresh costs only the months that are
// new. The two most recent are deleted first and re-fetched every time: tickets
// close and the "to date" score moves, so a cached recent month is a stale
// month that looks current.
const today = new Date()
const to = today.toISOString().slice(0, 10)
const from = new Date(today.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

const recent = [0, 1].map((back) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1))
  return d.toISOString().slice(0, 7)
})
for (const f of fs.existsSync(RAW) ? fs.readdirSync(RAW) : []) {
  const stale = recent.some((m) => f.includes(m))
    // Audit chunks are quarterly and named by their first day, so any chunk
    // whose span could still be moving is re-fetched rather than reasoned about.
    || (f.startsWith('audits_') && f.slice(7, 14) >= recent[1])
  if (stale) { fs.rmSync(path.join(RAW, f)); console.log(`  refetching ${f}`) }
}

// Chunks older than the window are dropped, or the file grows forever.
for (const f of fs.readdirSync(RAW)) {
  const m = /_(\d{4}-\d{2})/.exec(f)
  if (m && `${m[1]}-01` < from.slice(0, 7) + '-01') {
    fs.rmSync(path.join(RAW, f))
    console.log(`  dropping ${f} (outside the ${WINDOW_DAYS}-day window)`)
  }
}

// ── Fetch, aggregate, inject ─────────────────────────────────────────────────

const run = (script, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(HERE, script)], {
    stdio: 'inherit',
    env: { ...process.env, ...env, MB_KEY: key, MB_URL: ORIGIN },
  })
  if (r.status !== 0) {
    console.error(`\n${script} failed. Nothing was overwritten — fix it and run this again.`)
    process.exit(r.status || 1)
  }
}

console.log(`\nWindow ${from} .. ${to}`)
run('fetch.mjs', { MB_FROM: from, MB_TO: to })
run('build.mjs')
run('inject.mjs')

console.log(`\nDone — ${path.relative(process.cwd(), path.join(HERE, 'fls-dashboard.html'))}`)
console.log('Open it in a browser, or send the file on. It needs no server and no key.')
