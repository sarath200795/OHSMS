// The phone QR scanner. A desktop-width run never opens this screen: mobile
// view is the only place the field bar offers it, and that is where the
// preview was a blank box. Fake camera flags stand in for the phone sensor.
// The stream still has to paint into a box with a real size, and the scan
// frame has to be on screen while it does.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { expect, test } from '@playwright/test'

const ADMIN = { email: 'admin@acme.test', password: 'password123' }

const hostingHeaders = JSON.parse(
  readFileSync(new URL('../firebase.json', import.meta.url))
).hosting.headers.find((entry) => entry.source === '**').headers

function header(name) {
  return hostingHeaders.find((entry) => entry.key === name).value
}

test.use({
  viewport: { width: 390, height: 844 },
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
})

async function signIn(page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 20_000 })
}

async function expectLivePreview(page) {
  const stage = page.locator('[data-scan-stage]')
  const video = stage.locator('video:visible')
  await expect(video).toBeVisible()
  await expect(stage.locator('[data-scan-frame]')).toBeVisible()
  await expect(stage.getByRole('status')).toHaveText(/Scanning/, { timeout: 15_000 })
  await expect
    .poll(
      () =>
        video.evaluate((node) => {
          const box = node.getBoundingClientRect()
          return (
            box.width > 150 &&
            box.height > 150 &&
            node.videoWidth > 0 &&
            node.paused === false &&
            (node.hasAttribute('playsinline') || node.playsInline === true)
          )
        }),
      { timeout: 15_000 }
    )
    .toBe(true)
}

test('mobile view shows a live scan frame from the platform detector', async ({ page }) => {
  await page.addInitScript(() => {
    if (typeof window.BarcodeDetector !== 'function') {
      window.BarcodeDetector = class {
        async detect() {
          return []
        }
      }
    }
  })
  await signIn(page)
  await page.goto('/field/scan')
  await expect(page.getByRole('heading', { name: 'Scan QR' })).toBeVisible()
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expectLivePreview(page)

  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('[data-scan-stage] video:visible')).toHaveCount(0)
  await expect(page.locator('[data-scan-frame]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Start camera' }).click()
  await expectLivePreview(page)

  await page.goto('/field')
  await page.goto('/field/scan')
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expectLivePreview(page)
})

test('mobile view shows a live scan frame without BarcodeDetector', async ({ page }) => {
  await page.addInitScript(() => {
    const wipe = (target) => {
      try {
        Object.defineProperty(target, 'BarcodeDetector', {
          configurable: true,
          writable: true,
          value: undefined,
        })
      } catch {
        // A non-configurable platform detector still has to be hidden from
        // the page, or this test would pass on the other scanner.
      }
    }
    wipe(window)
    wipe(globalThis)
  })
  await signIn(page)
  await page.goto('/field/scan')
  await expect(page.getByRole('heading', { name: 'Scan QR' })).toBeVisible()
  const kind = await page.evaluate(() => typeof window.BarcodeDetector)
  expect(kind).not.toBe('function')
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expectLivePreview(page)
  const insideReader = await page.locator('#field-qr-reader video:visible').count()
  expect(insideReader).toBe(1)
})

test('the hosting camera headers still let a preview play', async ({ page }) => {
  const csp = header('Content-Security-Policy')
  const policy = header('Permissions-Policy')
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Permissions-Policy': policy,
    })
    res.end(
      '<!doctype html><video id="v" autoplay muted playsinline style="width:320px;height:240px;background:#000"></video>'
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await page.goto(`http://127.0.0.1:${port}/`)
    const seen = await page.evaluate(async () => {
      const secure = window.isSecureContext
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const video = document.getElementById('v')
        video.srcObject = stream
        await video.play()
        return { secure, ok: true, width: video.videoWidth, height: video.videoHeight }
      } catch (err) {
        return { secure, ok: false, name: err?.name || '', message: err?.message || String(err) }
      }
    })
    expect(seen.secure).toBe(true)
    expect(seen.ok, seen.message).toBe(true)
    expect(seen.width).toBeGreaterThan(0)
    expect(seen.height).toBeGreaterThan(0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
