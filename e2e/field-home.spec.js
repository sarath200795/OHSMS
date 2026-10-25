// The phone bar's Home control. Desktop width never mounts this bar, so the
// viewport is a phone before the first navigation — setting it afterwards
// leaves the first paint in desktop view, where the bar does not exist.
import { expect, test } from '@playwright/test'

const ADMIN = { email: 'admin@acme.test', password: 'password123' }

test.use({
  viewport: { width: 390, height: 844 },
})

async function signIn(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 20_000 })
}

test('the phone bar Home control returns to the field home', async ({ page }) => {
  await signIn(page)

  const bar = page.getByRole('navigation', { name: 'Field' })
  const home = bar.getByRole('link', { name: 'Home' })
  await expect(home).toBeVisible()
  await expect(home).toHaveAttribute('href', '/field')
  await expect(home).toHaveAttribute('aria-current', 'page')

  const box = await home.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  await bar.getByRole('link', { name: 'Tasks' }).click()
  await page.waitForURL(/\/field\/tasks/)
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible()
  await expect(home).not.toHaveAttribute('aria-current', 'page')
  await expect(bar.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')

  await home.focus()
  await expect(home).toBeFocused()
  await home.click()
  await page.waitForURL(/\/field\/?$/)
  await expect(home).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached()
})
