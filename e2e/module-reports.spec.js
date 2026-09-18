// ─────────────────────────────────────────────────────────────────────────────
// Per-module reports, in the browser.
//
// Unit tests pin that every operating app mounts `/reports` and that hosting
// still rewrites the prefix to that app. This is the click: after sign-in,
// each reports URL renders that module's heading and a Reports tab, and the
// shell `/analytics` rollup is still there. If this were only a contract, a
// catch-all Navigate would still pass the source scan.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test'
import { OPERATING_APPS } from '../src/shared/modules/apps.js'
import { moduleReportsPath } from '../src/shared/modules/reports.js'
import { LANDING_PRODUCTS, landingOpenPath } from '../src/shared/modules/landing.js'

const ADMIN = { email: 'admin@acme.test', password: 'password123' }

async function signIn(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 20_000 })
}

async function expectModuleReports(page, path) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/reports$/i, { timeout: 20_000 })
  await expect(
    page.getByRole('navigation', { name: /sections/i }).getByRole('link', { name: 'Reports' })
  ).toHaveAttribute('aria-current', 'page')
}

test('every operating app serves its own reports page', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page)
  for (const app of OPERATING_APPS) {
    await expectModuleReports(page, moduleReportsPath(app.pathPrefix))
  }
})

test('landing module products deep-link to that app’s reports', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  for (const product of LANDING_PRODUCTS.filter((p) => p.moduleKey)) {
    await expectModuleReports(page, moduleReportsPath(landingOpenPath(product)))
  }
})

test('shell analytics remains the cross-suite rollup', async ({ page }) => {
  await signIn(page)
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('tablist', { name: 'Analytics modules' })).toBeVisible()
})
