// ─────────────────────────────────────────────────────────────────────────────
// Every module, signed in, with the console watched.
//
// Console noise is cumulative and nobody owns it: each warning is individually
// ignorable, and once there are enough of them the console stops being read at
// all. React Router's two future-flag warnings alone were ~94% of everything
// logged — two lines per navigation across 29 routes — which is exactly the
// state in which a real error hides in plain sight.
//
// So this fails on things that are actually wrong (an uncaught exception, a
// console.error, a 5xx) and merely REPORTS the rest. Warnings are printed but
// do not fail the run: third-party libraries add them on their own schedule,
// and a gate that goes red without anyone changing anything gets disabled.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test'

const ADMIN = { email: 'admin@acme.test', password: 'password123' }

// Every route in App.jsx that a signed-in admin can reach, plus the module tabs
// that mount their own data contexts. A new module belongs here.
const ROUTES = [
  '/portal', '/dashboard', '/incidents', '/hira', '/inspections', '/inspections/forms',
  '/audit', '/permits', '/loto', '/loto/inventory', '/loto/operations', '/loto/locks',
  '/equipment', '/mock-drills', '/committee', '/training', '/documents', '/actions',
  '/emergency-response', '/objectives', '/weather', '/cctv', '/stakeholder',
  '/analytics', '/sites', '/users', '/settings', '/audit-log', '/security',
]

// Noise from the headless GPU, not from the app: three.js draws the portal's
// module logo and the software renderer narrates its own performance.
const BENIGN = [/GL Driver Message/i, /WebGL/i]

test('no module logs an error to the console', async ({ page }) => {
  test.setTimeout(600_000)
  const fatal = []
  const noise = []
  let route = '(sign-in)'

  const record = (bucket, kind, text) => {
    const t = String(text || '').trim().slice(0, 400)
    if (!t || BENIGN.some((re) => re.test(t))) return
    bucket.push({ route, kind, text: t })
  }

  page.on('console', (m) => {
    const type = m.type()
    if (type === 'error') record(fatal, 'console.error', m.text())
    else if (type === 'warning') record(noise, 'warning', m.text())
  })
  page.on('pageerror', (e) => record(fatal, 'uncaught', e?.message || e))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || ''
    // A navigation cancelled by the next goto() is the harness, not the app.
    if (/ERR_ABORTED/.test(f)) return
    record(noise, 'requestfailed', `${r.method()} ${r.url()} — ${f}`)
  })
  page.on('response', (r) => {
    const s = r.status()
    if (s >= 500) record(fatal, 'http' + s, `${r.request().method()} ${r.url()}`)
    else if (s >= 400) record(noise, 'http' + s, `${r.request().method()} ${r.url()}`)
  })

  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 30_000 })

  for (const r of ROUTES) {
    route = r
    await page.goto(r, { waitUntil: 'domcontentloaded' })
    // Long enough for the module's own subscriptions to open and first-render.
    await page.waitForTimeout(1500)
  }

  if (noise.length) {
    /* eslint-disable-next-line no-console */
    console.log(`\n${noise.length} non-fatal console entries:\n` +
      [...new Set(noise.map((n) => `  [${n.kind}] ${n.route}: ${n.text}`))].join('\n') + '\n')
  }

  // One assertion, and the message IS the report — a bare count would send the
  // next person back to the trace to find out what broke.
  expect(
    fatal.map((f) => `[${f.kind}] ${f.route}\n    ${f.text}`).join('\n'),
    `${fatal.length} console error(s) across ${ROUTES.length} routes`,
  ).toBe('')
})
