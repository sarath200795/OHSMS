// Recorded walkthrough: an organization registers with its own database, its
// own SAML identity provider and its own storage, signs in, uploads a logo and
// signs out.
//
//   node e2e/record/own-stack-walkthrough.mjs [out-dir]
//
// Needs a JDK (the Firestore emulator) and the Playwright Chromium (or
// CHROMIUM_PATH pointing at one), plus openssl and ffmpeg. Writes
// own-stack-walkthrough.mp4 (and the raw .webm) to out-dir, default
// ./recordings, which is gitignored.
//
// What runs, all on loopback:
//   - the shared WEEHS site (Vite :5173) on the Firebase emulators, where the
//     registration wizard files the request — it creates no WEEHS account;
//   - the control plane / dedicated host (stack/server.mjs, :8787) on an
//     embedded Postgres, which takes the request, mails the one-time handoff
//     link, and on handoff provisions the company and becomes its SAML SP;
//   - the company's SAML IdP and its bucket + presign endpoint, served over TLS
//     at idp.northwind.test and files.northwind.test, which the browser maps to
//     loopback (e2e/record/companyServices.mjs);
//   - the dedicated company app (Vite :5174) built with the public env that
//     fulfillment produced: postgres data driver, s3 file driver, SAML.
//
// Every name, email and value in it is invented.

// POINTER, caption() and the scroll below run inside the page, not in Node.
/* global document, window, location, addEventListener */

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import {
  makeTls,
  startCompanyBucket,
  startCompanyIdp,
  startDedicatedHost,
} from './companyServices.mjs'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const OUT = resolve(process.argv[2] || join(ROOT, 'recordings'))
const RAW = join(OUT, 'raw')
const PROJECT = 'ohsms-demo'
const SHARED = 'http://localhost:5173'
const APP = 'http://localhost:5174'
const HOST_PORT = 8787
const IDP = 'https://idp.northwind.test'
const FILES = 'https://files.northwind.test'
const IDP_ENTITY = 'https://idp.northwind.test/saml'
const OPERATOR = 'local-operator-token'

const company = {
  orgName: 'Northwind Metals',
  address: 'Pune, India',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  issuer: IDP_ENTITY,
  clientId: 'ohsms-northwind',
  bucketName: 'northwind-ehs-files',
  bucketRegion: 'ap-south-1',
  presignUrl: `${FILES}/presign`,
}

const children = []
const servers = []
function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  children.push(child)
  return child
}
function stopAll() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  for (const s of servers) s.close?.()
}
process.on('exit', stopAll)

async function waitFor(url, ms = 90_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${url}`)
}
const pause = (page, ms) => page.waitForTimeout(ms)

// ── On-screen narration and a visible pointer ───────────────────────────────
// Playwright's video has no cursor; this draws one that follows real mouse
// events, so every click in the recording is a click that happened.
const POINTER = () => {
  const draw = () => {
    if (document.getElementById('__rec_ptr') || !document.body) return
    const dot = document.createElement('div')
    dot.id = '__rec_ptr'
    Object.assign(dot.style, {
      position: 'fixed',
      left: '-40px',
      top: '-40px',
      width: '22px',
      height: '22px',
      marginLeft: '-11px',
      marginTop: '-11px',
      borderRadius: '50%',
      zIndex: 2147483647,
      background: 'rgba(239,68,68,.35)',
      border: '2px solid rgba(220,38,38,.9)',
      pointerEvents: 'none',
      transition: 'transform .12s',
    })
    document.body.appendChild(dot)
    addEventListener(
      'mousemove',
      (e) => {
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
      },
      true
    )
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'), true)
    addEventListener('mouseup', () => (dot.style.transform = ''), true)
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', draw)
  else draw()
}

async function caption(page, step, text) {
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(
    ([s, t]) => {
      let bar = document.getElementById('__rec_cap')
      if (!bar) {
        bar = document.createElement('div')
        bar.id = '__rec_cap'
        Object.assign(bar.style, {
          position: 'fixed',
          left: '50%',
          bottom: '18px',
          transform: 'translateX(-50%)',
          maxWidth: '86%',
          zIndex: 2147483646,
          pointerEvents: 'none',
          background: 'rgba(15,23,42,.92)',
          color: '#fff',
          borderRadius: '12px',
          padding: '10px 18px',
          font: '500 15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
          boxShadow: '0 10px 30px rgba(0,0,0,.35)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        })
        document.body.appendChild(bar)
      }
      bar.innerHTML = ''
      const tag = document.createElement('span')
      tag.textContent = s
      Object.assign(tag.style, {
        background: '#f59e0b',
        color: '#111827',
        borderRadius: '999px',
        padding: '2px 10px',
        font: '700 12px/1.6 system-ui,sans-serif',
        whiteSpace: 'nowrap',
      })
      const body = document.createElement('span')
      body.textContent = t
      // There is no address bar in the recording. Which site the page is on
      // is the point of half the steps, so the origin rides on the caption.
      const where = document.createElement('span')
      where.textContent = location.origin
      Object.assign(where.style, {
        font: '500 12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
        color: '#93c5fd',
        borderLeft: '1px solid rgba(255,255,255,.25)',
        paddingLeft: '12px',
        whiteSpace: 'nowrap',
      })
      bar.append(tag, body, where)
    },
    [step, text]
  )
}

async function card(page, title, lines, ms = 3800) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#0f2a43,#134e4a);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff">
    <div style="max-width:880px;padding:0 40px">
      <div style="font:700 14px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#fbbf24">WEEHS · own-stack walkthrough</div>
      <h1 style="font:800 40px/1.15 system-ui;margin:14px 0 22px">${title}</h1>
      ${lines.map((l) => `<p style="font:400 19px/1.5 system-ui;margin:8px 0;color:#e2e8f0">${l}</p>`).join('')}
    </div></body></html>`)
  await pause(page, ms)
}

async function type(locator, text) {
  await locator.click()
  await locator.pressSequentially(text, { delay: 28 })
}

// ── Services ────────────────────────────────────────────────────────────────
async function main() {
  rmSync(RAW, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })

  console.log('starting Firebase emulators (auth, firestore)…')
  run('npx', ['firebase', 'emulators:start', '--only', 'auth,firestore', '--project', PROJECT])
  await waitFor('http://127.0.0.1:8080/')
  await waitFor('http://127.0.0.1:9099/')

  console.log('starting the shared WEEHS site…')
  run('npx', ['vite', '--port', '5173', '--strictPort'], {
    VITE_USE_EMULATORS: 'true',
    VITE_FIREBASE_PROJECT_ID: PROJECT,
    VITE_FIREBASE_API_KEY: 'demo-api-key',
  })
  await waitFor(SHARED)

  console.log('starting the control plane, company IdP and company bucket…')
  const tls = makeTls(['idp.northwind.test', 'files.northwind.test'])
  const host = await startDedicatedHost({ port: HOST_PORT, origin: APP, controlToken: OPERATOR })
  const idp = await startCompanyIdp({ port: 8444, entityId: IDP_ENTITY, publicUrl: IDP, tls })
  const bucket = await startCompanyBucket({
    port: 8443,
    appOrigin: APP,
    hostUrl: host.url,
    publicUrl: FILES,
    tls,
  })
  servers.push(host.server, idp.server, bucket.server)

  const browser = await chromium.launch({
    // Set when the installed Chromium is not the one this Playwright expects.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      // The company hostnames are loopback here. The sandbox proxy, if any,
      // would otherwise be asked to resolve them.
      '--no-proxy-server',
      '--host-resolver-rules=MAP idp.northwind.test:443 127.0.0.1:8444, MAP files.northwind.test:443 127.0.0.1:8443',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true, // the throwaway certificate above
    recordVideo: { dir: RAW, size: { width: 1280, height: 800 } },
  })
  await context.addInitScript(POINTER)
  const page = await context.newPage()

  // ── 0. Title ──────────────────────────────────────────────────────────────
  await card(
    page,
    'Register an organization on its own stack',
    [
      'Own database (Postgres) · own SAML identity provider · own file storage',
      'Then: sign in with company SSO, upload the organization logo, sign out.',
    ],
    4500
  )

  // ── 1. Register on the shared site ────────────────────────────────────────
  await page.goto(`${SHARED}/login`)
  await page.getByRole('link', { name: 'Register' }).waitFor()
  await caption(
    page,
    '1 · Register',
    'The founder starts on the shared WEEHS site and chooses Register.'
  )
  await pause(page, 2200)
  await page.getByRole('link', { name: 'Register' }).click()

  await page.getByText('Use your own database').waitFor()
  await caption(page, '1 · Register', 'Choose where the records live: the company’s own database.')
  await pause(page, 1500)
  await page.getByText('Use your own database').click()
  await pause(page, 900)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Organization name').waitFor()
  await caption(
    page,
    '2 · Own stack',
    'Organization and founder contact — no WEEHS password is created.'
  )
  await type(page.getByLabel('Organization name'), company.orgName)
  await type(page.getByLabel('Address'), company.address)
  await type(page.getByLabel('Your name'), company.contactName)
  await type(page.getByLabel('Work email'), company.contactEmail)
  await pause(page, 600)

  await caption(page, '2 · Own database', 'Hosting: the company brings its own Postgres database.')
  await page.getByLabel('Hosting').selectOption('bring')
  await pause(page, 700)
  await type(page.getByLabel('Database engine'), 'postgres')
  await pause(page, 900)

  await caption(
    page,
    '2 · Own SAML',
    'Sign-in: the company’s SAML IdP. Only public values here — no secrets.'
  )
  await page.getByLabel('Sign-in').selectOption('saml')
  await pause(page, 700)
  await type(page.getByLabel('Issuer URL'), company.issuer)
  await type(page.getByLabel('Client id'), company.clientId)
  await pause(page, 900)

  await caption(
    page,
    '2 · Own storage',
    'File store: the company’s own bucket, behind its own presign endpoint.'
  )
  await page.getByLabel('File store').selectOption('bring')
  await pause(page, 700)
  await type(page.getByLabel('Bucket name'), company.bucketName)
  await type(page.getByLabel('Bucket region'), company.bucketRegion)
  await type(page.getByLabel('Presign endpoint URL'), company.presignUrl)
  await pause(page, 1200)
  await page.getByRole('button', { name: 'File provisioning request' }).scrollIntoViewIfNeeded()
  await pause(page, 800)
  await page.getByRole('button', { name: 'File provisioning request' }).click()

  await page.getByText('Request filed').waitFor({ timeout: 20_000 })
  const requestId = (await page.locator('.font-mono').first().textContent()).trim()
  await caption(
    page,
    '3 · Filed',
    `Request ${requestId} is stored with status “requested”. Nothing is live yet.`
  )
  await pause(page, 5200)

  // ── 2. Control plane picks it up and mails the one-time handoff link ──────
  const doc = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/provisioningRequests/${requestId}`,
    { headers: { Authorization: 'Bearer owner' } }
  ).then((r) => r.json())
  const filed = { id: requestId, status: 'requested' }
  for (const [k, v] of Object.entries(doc.fields || {})) {
    if (typeof v.stringValue === 'string') filed[k] = v.stringValue
  }
  const toControlPlane = await fetch(`${host.url}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    body: JSON.stringify(filed),
  }).then((r) => r.json())
  if (!toControlPlane.ok || !toControlPlane.emailed) {
    throw new Error(`control plane refused the request: ${JSON.stringify(toControlPlane)}`)
  }
  const handoffMail = host.mailbox.at(-1)
  const handoffUrl = handoffMail.text.match(/https?:\/\/\S+\/handoff\?\S+/)[0]

  // The dedicated origin. stack/server.mjs is control plane and dedicated
  // host at once, so the handoff link is on this origin too and the proxy has
  // to be up before the mail is opened. The VITE_ values are the ones
  // fulfillment's publicEnv derives from this request (stack/fulfill.mjs);
  // until fulfillment runs, the host simply has no organization to serve.
  console.log('starting the dedicated company app…')
  run('npx', ['vite', '--config', 'e2e/record/vite.dedicated.config.mjs'], {
    OWNSTACK_HOST_URL: host.url,
    OWNSTACK_APP_PORT: '5174',
    VITE_DATA_DRIVER: 'postgres',
    VITE_DATA_GATEWAY: APP,
    VITE_STORAGE_DRIVER: 's3',
    VITE_S3_PRESIGN_ENDPOINT: filed.presignUrl,
    VITE_AUTH_METHOD: filed.authMethod,
    VITE_AUTH_ISSUER: filed.authIssuer,
    VITE_AUTH_CLIENT_ID: filed.authClientId,
    VITE_AUTH_TOTP: 'off',
    // App.jsx still gates on a Firebase project id even on this build. It is
    // a placeholder: nothing here talks to Firebase.
    VITE_FIREBASE_PROJECT_ID: 'northwind-dedicated',
    VITE_FIREBASE_API_KEY: 'unused-on-this-build',
  })
  await waitFor(`${APP}/login`)
  // Warm the module graph so the recording is not a loading spinner.
  const warm = await context.newPage()
  await warm.goto(`${APP}/login`)
  await warm.waitForLoadState('networkidle')
  await warm.close()

  await mailView(page, handoffMail, handoffUrl)
  await caption(
    page,
    '4 · Handoff mail',
    'The control plane emails a one-time secure link. Secrets go there, not in the wizard.'
  )
  await pause(page, 4200)
  await page.getByRole('link', { name: /handoff/ }).click()

  // ── 3. Secret handoff ─────────────────────────────────────────────────────
  await page.getByLabel(/Handoff email/).waitFor()
  await caption(
    page,
    '5 · Secrets',
    'One-time page: database URL, SAML IdP certificate and entry point, S3 keys, DATA_KEY_MASTER.'
  )
  await type(page.getByLabel(/Handoff email/), company.contactEmail)
  await type(
    page.getByLabel(/Database URL/),
    'postgres://ehs_browser@db.northwind.internal:5432/ehs'
  )
  await page.getByLabel(/SAML IdP certificate/).click()
  await page.getByLabel(/SAML IdP certificate/).fill(idp.cert)
  await pause(page, 500)
  await type(page.getByLabel(/SAML entry point/), idp.entryPoint)
  await type(page.getByLabel(/DATA_KEY_MASTER/), 'nw-dkm-7f3c9a1e5b2d4f60a8c1e9d2')
  await type(page.getByLabel(/S3 access key id/), 'AKIANORTHWINDDEMO01')
  await type(page.getByLabel(/S3 secret access key/), 'nwS3secretDemoValue9f8e7d6c5b4a')
  await pause(page, 900)
  await page.getByRole('button', { name: 'Submit secrets' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Submit secrets' }).click()

  await page.getByText('Organization is live').waitFor({ timeout: 30_000 })
  await caption(
    page,
    '6 · Live',
    'Provisioned on the company’s Postgres. The dedicated URL is assigned.'
  )
  await pause(page, 4200)

  // ── 4. Sign in with company SAML ──────────────────────────────────────────
  await page.getByRole('link', { name: APP }).click()
  await page.getByRole('button', { name: /company sign-in/i }).waitFor({ timeout: 30_000 })
  await caption(
    page,
    '7 · Sign in',
    'The company’s dedicated app. No WEEHS password: sign-in goes to the company IdP.'
  )
  await pause(page, 3000)
  await page.getByRole('button', { name: /company sign-in/i }).click()

  await page.waitForURL(/idp\.northwind\.test/)
  await page.getByLabel('Work email').waitFor()
  await caption(
    page,
    '8 · SAML IdP',
    'Northwind’s own identity provider (SAML 2.0) authenticates the founder.'
  )
  await type(page.getByLabel('Work email'), company.contactEmail)
  await type(page.getByLabel('Password'), 'correct-horse-battery')
  await pause(page, 1600)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.waitForURL(/localhost:5174\/portal/, { timeout: 30_000 })
  await page.getByText('Org Settings').first().waitFor({ timeout: 30_000 })
  await caption(
    page,
    '9 · Signed in',
    'Signed SAML assertion accepted. Asha is the organization’s administrator.'
  )
  await pause(page, 4500)

  // ── 5. Upload the organization logo ───────────────────────────────────────
  await page.getByText('Org Settings').first().click()
  await page.getByRole('button', { name: /upload logo/i }).waitFor({ timeout: 30_000 })
  await caption(page, '10 · Logo', 'Organization settings — read from the company’s Postgres.')
  await pause(page, 2000)
  await page.getByRole('button', { name: /upload logo/i }).scrollIntoViewIfNeeded()
  await pause(page, 1200)
  const logo = join(RAW, 'northwind-logo.png')
  await makeLogo(browser, logo)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /upload logo/i }).click()
  await (await chooser).setFiles(logo)
  await page.getByText('Logo updated').waitFor({ timeout: 30_000 })
  const stored = [...bucket.objects.keys()].find((k) => k.includes('/org-logo/'))
  await caption(page, '11 · Stored', `Uploaded to the company bucket: ${stored}`)
  await pause(page, 2500)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(page, 3500)

  // ── 6. Sign out ───────────────────────────────────────────────────────────
  await caption(
    page,
    '12 · Sign out',
    'The new logo now brands every screen. Sign out from the account menu.'
  )
  await pause(page, 1800)
  await page.getByRole('button', { name: /asha rao/i }).click()
  await pause(page, 1500)
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('button', { name: /company sign-in/i }).waitFor({ timeout: 20_000 })
  await caption(page, '13 · Signed out', 'Session cleared. Back at the company sign-in.')
  await pause(page, 3500)

  await card(
    page,
    'Done',
    [
      `${company.orgName}: records in its own Postgres, sign-in through its own SAML IdP,`,
      'files in its own bucket — and no account on the shared WEEHS project.',
    ],
    4500
  )

  const video = page.video()
  await context.close()
  await browser.close()
  const webm = await video.path()
  const finalWebm = join(OUT, 'own-stack-walkthrough.webm')
  renameSync(webm, finalWebm)
  const mp4 = join(OUT, 'own-stack-walkthrough.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    finalWebm,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    mp4,
  ])
  for (const f of readdirSync(RAW)) if (f.endsWith('.webm')) rmSync(join(RAW, f))
  console.log(`\nrecorded:\n  ${mp4}\n  ${finalWebm}`)
}

async function mailView(page, mail, url) {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)
  const body = esc(mail.text).replace(
    esc(url),
    `<a href="${esc(url)}">${esc(url.replace(/token=[^&]+/, 'token=…'))}</a>`
  )
  await page.goto('about:blank')
  await page.setContent(`<!doctype html><html><head><title>Mail</title></head><body style="margin:0;background:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <div style="max-width:820px;margin:60px auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden">
      <div style="padding:14px 22px;background:#0f2a43;color:#fff;font-weight:600">Inbox · ${esc(mail.to)} <span style="opacity:.6;font-weight:400">(local mail capture)</span></div>
      <div style="padding:22px">
        <div style="color:#64748b;font-size:14px">From: WEEHS control plane</div>
        <div style="color:#64748b;font-size:14px">To: ${esc(mail.to)}</div>
        <h2 style="margin:14px 0 10px;font-size:22px">${esc(mail.subject)}</h2>
        <pre style="white-space:pre-wrap;font:15px/1.6 system-ui;color:#0f172a">${body}</pre>
      </div></div></body></html>`)
}

async function makeLogo(browser, file) {
  const p = await browser.newPage({ viewport: { width: 256, height: 256 } })
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:256px;height:256px;display:grid;place-items:center">
    <div style="width:224px;height:224px;border-radius:52px;background:linear-gradient(135deg,#f59e0b,#b45309);display:grid;place-items:center;color:#fff;font:800 96px system-ui;letter-spacing:-4px">NM</div></div></body>`)
  await p.screenshot({ path: file, omitBackground: true })
  await p.close()
}

main()
  .then(() => {
    stopAll()
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    stopAll()
    process.exit(1)
  })
