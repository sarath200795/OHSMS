#!/usr/bin/env node
/**
 * Block a merge on high or critical advisories in what actually ships — with a
 * named allowlist rather than a lowered bar.
 *
 * `npm audit --audit-level=critical` was the first version, because one
 * unfixable high (xlsx) would otherwise have made the gate red on the day it
 * shipped, and a gate that is always red is a gate nobody reads. But lowering
 * the threshold hides every OTHER high too, which is most of what a dependency
 * gate exists to catch.
 *
 * So: fail on high and above, and allow exactly the advisories named below,
 * each with a reason and a condition for removing it. Anything not on the list
 * fails. The list is short on purpose — if it grows, that is the signal, not
 * the workaround.
 */
import { execFileSync } from 'node:child_process'

// Each entry must say why it is tolerable and what closes it. An allowlist
// without those becomes permanent.
const ALLOWED = {
  xlsx: {
    why: 'Prototype pollution, no fixed version on npm (SheetJS stopped publishing there). '
       + 'Reachable only by PARSING an untrusted file, and no import does that any more — '
       + 'every upload goes through shared/lib/parseTable (papaparse). This package is now '
       + 'used only to WRITE exports from data we already hold, which is not a parsing surface.',
    closes: 'Remove xlsx entirely, or migrate exports to the maintained SheetJS build.',
  },
}

const args = ['audit', '--omit=dev', '--json']
let raw = ''
try {
  raw = execFileSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' })
} catch (e) {
  // npm audit exits non-zero when it finds anything — the report is still on
  // stdout, and that report is the whole point of running it.
  raw = e.stdout || ''
}

if (!raw.trim()) {
  console.error('audit-gate: npm audit produced no report. Refusing to pass on no evidence.')
  process.exit(1)
}

const report = JSON.parse(raw)
const serious = Object.values(report.vulnerabilities || {})
  .filter((v) => v.severity === 'high' || v.severity === 'critical')

const unexpected = serious.filter((v) => !ALLOWED[v.name])
const accepted = serious.filter((v) => ALLOWED[v.name])

for (const v of accepted) {
  console.log(`allowed: ${v.severity} in ${v.name}`)
  console.log(`   why:    ${ALLOWED[v.name].why}`)
  console.log(`   closes: ${ALLOWED[v.name].closes}`)
}

// An entry that no longer matches anything is stale — it should be deleted, not
// left to silence a future advisory in the same package.
for (const name of Object.keys(ALLOWED)) {
  if (!serious.some((v) => v.name === name)) {
    console.log(`stale allowlist entry: ${name} no longer has a high/critical advisory — remove it.`)
  }
}

if (unexpected.length) {
  console.error(`\naudit-gate: ${unexpected.length} unallowed high/critical advisory in the runtime tree:`)
  for (const v of unexpected) {
    console.error(`  ${v.severity.toUpperCase()} ${v.name} — fix available: ${JSON.stringify(v.fixAvailable)}`)
  }
  console.error('\nFix it, or add it to ALLOWED in scripts/audit-gate.mjs with a reason and what closes it.')
  process.exit(1)
}

console.log(`\naudit-gate: ok — ${accepted.length} allowed, 0 unallowed.`)
