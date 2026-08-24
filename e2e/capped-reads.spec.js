// ─────────────────────────────────────────────────────────────────────────────
// Every screen that totals a capped register must say so when the cap is hit.
//
// This is the check the code cannot make for itself. `incompleteReadNotice`
// produces the sentence and `<IncompleteNotice>` renders it, and both are unit
// tested — but whether a given SCREEN actually asks for the notice and puts it
// on the page is a wiring question, and the wiring was missing in exactly the
// places it mattered most: the KPI scorecard threw the read status away, and the
// fire dashboard named extinguishers while four other capped registers on the
// same page said nothing.
//
// Run with VITE_TEST_READ_CAP set to a small number so the seeded demo org is
// already past it. Skipped otherwise, because at the real 5 000 no fixture
// could trip it.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test'

const CAP = Number(process.env.VITE_TEST_READ_CAP || 0)
const ADMIN = { email: 'admin@acme.test', password: 'password123' }

test.skip(!CAP, 'set VITE_TEST_READ_CAP to a small number to exercise the cap')

async function signIn(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 20_000 })
}

// Every route here renders at least one figure built from a capped read.
const SCREENS = [
  ['/portal', 'Portal home'],
  ['/objectives', 'Objectives scorecard'],
  ['/equipment/ext-dashboard', 'Equipment dashboard'],
  ['/equipment/aed-dashboard', 'AED dashboard'],
  ['/equipment/fas-dashboard', 'FAS dashboard'],
  ['/analytics', 'Analytics'],
  ['/sites', 'Sites'],
]

for (const [path, label] of SCREENS) {
  test(`${label} admits its figures are incomplete`, async ({ page }) => {
    await signIn(page)
    await page.goto(path)

    // role="status" is what IncompleteNotice renders, and using the role rather
    // than the copy means rewording the sentence does not break this.
    const notice = page.getByRole('status').filter({ hasText: /incomplete/i })
    await expect(
      notice.first(),
      `${label} shows totals built on a capped read and no notice saying so`
    ).toBeVisible({ timeout: 20_000 })
  })
}
