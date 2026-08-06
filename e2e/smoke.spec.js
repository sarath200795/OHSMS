// ─────────────────────────────────────────────────────────────────────────────
// The money flows, end to end.
//
// Every regression this app has shipped was invisible to the unit suite and
// caught by a person clicking. These are those clicks, automated: sign in and
// see the portal, report an incident and get a document id back, and scan a
// permit QR without an account. If one of these breaks, the app is broken for
// its actual users no matter what else passes.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test'

const ADMIN = { email: 'admin@acme.test', password: 'password123' }

async function signIn(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Everyone lands on the portal.
  await page.waitForURL(/\/portal/, { timeout: 20_000 })
}

test('sign in reaches the portal, scoped and populated', async ({ page }) => {
  await signIn(page)
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible()
  // The widget grid is the page's reason to exist.
  await expect(page.getByText('How are my sites doing?')).toBeVisible()
  await expect(page.getByRole('button', { name: /choose widgets/i })).toBeVisible()
  // And the module tiles below it (label + tile title both mention it, hence first()).
  await expect(page.getByText('Action Tracker').first()).toBeVisible()
})

test('an incident can be reported and comes back with a reference', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: /report an incident/i }).click()
  await page.waitForURL(/\/portal\/report/)

  // Step 1 — what happened: type, severity, at least ten words of narrative.
  await page.getByRole('button', { name: 'Near Miss' }).click()
  await page.getByRole('button', { name: 'Low', exact: true }).click()
  await page.locator('textarea').first()
    .fill('E2E smoke test — near miss at the loading bay, pallet slipped, no injuries.')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2 — nobody hurt.
  await page.getByRole('button', { name: 'No', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 3 — confirm the account is accurate, then send.
  await page.getByText(/accurate account of what I saw/i).click()
  await page.getByRole('button', { name: /send report/i }).click()

  // The confirmation must quote the human reference, not a Firestore key —
  // this exact screen once showed the raw id and it took a person to notice.
  await expect(page.getByText(/IRA-\d{4}-\d{4}|INC-[A-Z0-9]{2,5}_\d{4}/)).toBeVisible({ timeout: 20_000 })
})

test('a scanned permit QR answers without an account', async ({ page }) => {
  // No sign-in on purpose: the person scanning a permit taped to a scaffold
  // has no account, and this page not resolving was a real shipped bug.
  await page.goto('/permit/e2e-nonexistent-token')
  await expect(page.getByText(/code not recognised/i)).toBeVisible()
  await expect(page.getByText(/do not treat it as authorisation/i)).toBeVisible()
})

test('the public equipment QR page answers without an account', async ({ page }) => {
  await page.goto('/qr/e2e-nonexistent-token')
  await expect(page.getByText(/code not recognised/i)).toBeVisible()
})
