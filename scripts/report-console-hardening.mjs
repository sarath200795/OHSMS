#!/usr/bin/env node
// Print the console-hardening checklist, and optionally probe a few Google
// Cloud APIs if the operator already has Application Default Credentials.
//
// Read-only. Never writes. Never prints secret values. A missing credential
// is the normal case: the checklist is the deliverable, the probes are a
// convenience for a laptop that is already logged in.
//
//   node scripts/report-console-hardening.mjs
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/report-console-hardening.mjs
//
// Do not commit the JSON key. Do not run this as a required CI gate — console
// state is invisible to git, and a red check that cannot see the console
// trains people to ignore it.
import { readFileSync } from 'node:fs'

const checklist = readFileSync(new URL('../docs/CONSOLE-HARDENING.md', import.meta.url), 'utf8')
const project = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || ''

console.log('=== Console hardening checklist (docs/CONSOLE-HARDENING.md) ===\n')
console.log(checklist)
console.log('\n=== Optional read-only probes ===\n')

const hasAdc = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
)

if (!hasAdc || !project) {
  console.log(
    hasAdc
      ? 'ADC is set but GCLOUD_PROJECT / VITE_FIREBASE_PROJECT_ID is not. Not guessing a project id.'
      : 'No Application Default Credentials. Printed the checklist only — this is the expected CI outcome.'
  )
  console.log(
    '\nManual verification still required for App Check enforcement, MFA, API key referrers, and backups.'
  )
  process.exit(0)
}

const probes = []

try {
  const { execFileSync } = await import('node:child_process')
  const gcloud = (args) => {
    try {
      return execFileSync('gcloud', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    } catch (err) {
      return `(gcloud failed: ${err?.stderr || err?.message || 'not installed'})`
    }
  }

  probes.push(['project', project])
  probes.push([
    'firestore databases list',
    gcloud(['firestore', 'databases', 'list', '--project', project, '--format', 'value(name)']),
  ])
  probes.push([
    'identity platform mfa (best-effort)',
    gcloud(['identity-platform', 'config', 'get', '--project', project, '--format', 'json']),
  ])
} catch (err) {
  probes.push(['probe', err?.message || String(err)])
}

for (const [label, value] of probes) {
  const text = String(value || '').slice(0, 500)
  console.log(`- ${label}: ${text || '(empty)'}`)
}

console.log(
  '\nProbes are hints. App Check enforcement, API key HTTP referrers, and PITR ' +
    'still have to be ticked in the console — those APIs are easy to misread from a script.'
)
process.exit(0)
