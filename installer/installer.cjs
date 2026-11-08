// WEEHS Installer: installs a self-hosted WEEHS without a terminal.
//
// Double-clicked, it starts a small web server on this computer only
// (127.0.0.1, a free port) and opens the installer page in the default
// browser. The page checks Docker, takes the address, writes the settings,
// starts the database, the app and HTTPS (the same selfhost/ kit install.sh
// uses, built into this program), and hands over to the app's own /setup.
//
// docs/SELF-HOSTING.md is the procedure; installer/README.md says how this
// is built and why it is shaped this way.

'use strict'

const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { validDomain, safeValue, buildEnv, readEnv, allowedRequest } = require('./core.cjs')
const { kitFiles, uiHtml, releaseInfo } = require('./assets.cjs')

const IDLE_EXIT_MS = 2 * 60 * 60 * 1000
const say = (line) => process.stdout.write(`${line}\n`)

function defaultDir() {
  if (process.env.WEEHS_INSTALL_DIR) return process.env.WEEHS_INSTALL_DIR
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData || 'C:\\ProgramData', 'WEEHS')
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0) return '/opt/weehs'
  return path.join(os.homedir(), 'weehs')
}

// ── Running Docker ──────────────────────────────────────────────────────────
function run(cmd, args, { cwd, onLine } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, COMPOSE_PROGRESS: 'plain' },
      })
    } catch (err) {
      resolve({ code: -1, output: String(err.message) })
      return
    }
    let output = ''
    const take = (chunk) => {
      const text = chunk.toString()
      output += text
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line.trim())
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (err) => resolve({ code: -1, output: String(err.message) }))
    child.on('close', (code) => resolve({ code, output }))
  })
}

async function checks(dir) {
  const docker = await run('docker', ['version', '--format', '{{.Server.Version}}'])
  const compose = docker.code === 0 ? await run('docker', ['compose', 'version', '--short']) : null
  const installed = fs.existsSync(path.join(dir, '.env'))
  const ports = installed
    ? { 80: true, 443: true }
    : { 80: await portFree(80), 443: await portFree(443) }
  return {
    os: process.platform,
    docker: docker.code === 0 ? docker.output.trim() : null,
    dockerProblem:
      docker.code === 0 ? '' : /not found|ENOENT/i.test(docker.output) ? 'missing' : 'not-running',
    compose: compose && compose.code === 0 ? compose.output.trim() : null,
    ports,
    installed,
  }
}

// A port someone else holds (IIS, another web server) stops Caddy. EACCES
// means only that this program may not bind it; Docker can, so that is fine.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', (err) => resolve(err.code !== 'EADDRINUSE'))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '0.0.0.0')
  })
}

// ── Installing ──────────────────────────────────────────────────────────────
const job = { state: 'idle', steps: [], log: [], error: '', domain: '' }

function step(name, status) {
  const existing = job.steps.find((s) => s.name === name)
  if (existing) existing.status = status
  else job.steps.push({ name, status })
}

function logLine(line) {
  if (job.log[job.log.length - 1] === line) return
  job.log.push(line)
  if (job.log.length > 400) job.log.shift()
}

// Asked of Caddy on this computer, with the real name, so it works before DNS
// has spread. The certificate is not checked: this asks whether the app
// answers, and a new certificate can take a minute.
function health(domain) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port: 443,
        path: '/health',
        servername: domain,
        headers: { Host: domain },
        rejectUnauthorized: false,
        timeout: 5000,
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(/"ok":\s*true/.test(body)))
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => req.destroy())
  })
}

async function install(dir, settings) {
  job.state = 'running'
  job.steps = []
  job.log = []
  job.error = ''
  const kit = kitFiles()
  try {
    step('Prepare the folder', 'running')
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, text] of Object.entries(kit)) {
      // Written with \n whatever the platform: init-db.sh runs inside a Linux
      // container, where a carriage return breaks it.
      fs.writeFileSync(path.join(dir, name), text.replace(/\r\n/g, '\n'))
    }
    try {
      fs.chmodSync(path.join(dir, 'init-db.sh'), 0o755)
    } catch {
      // Windows has no mode bits; the postgres image sources the script then.
    }
    step('Prepare the folder', 'done')

    step('Write the settings and new secrets', 'running')
    const envPath = path.join(dir, '.env')
    if (fs.existsSync(envPath)) {
      // Never a second set of secrets over the first: a new STATE_KEY cannot
      // read what the old one sealed, and new database passwords do not match
      // the database that already exists.
      logLine('Keeping the existing settings and their secrets.')
    } else {
      const text = buildEnv(kit['.env.example'], settings)
      fs.writeFileSync(envPath, text, { mode: 0o600 })
      logLine('Settings written, readable by this account only.')
    }
    const env = readEnv(fs.readFileSync(envPath, 'utf8'))
    job.domain = env.DOMAIN
    step('Write the settings and new secrets', 'done')

    step('Start the database, the app and HTTPS', 'running')
    const up = await run('docker', ['compose', 'up', '-d'], { cwd: dir, onLine: logLine })
    if (up.code !== 0)
      throw new Error('Docker could not start WEEHS. The details are in the log below.')
    step('Start the database, the app and HTTPS', 'done')

    step('Wait for WEEHS to answer', 'running')
    let ok = false
    for (let i = 0; i < 90 && !ok; i += 1) {
      ok = await health(env.DOMAIN)
      if (!ok) await new Promise((r) => setTimeout(r, 2000))
    }
    if (!ok) {
      const logs = await run('docker', ['compose', 'logs', '--tail', '20', 'app'], { cwd: dir })
      for (const line of logs.output.split(/\r?\n/)) if (line.trim()) logLine(line.trim())
      throw new Error('WEEHS did not answer within three minutes. The app’s log is below.')
    }
    step('Wait for WEEHS to answer', 'done')
    job.state = 'done'
  } catch (err) {
    const current = job.steps.find((s) => s.status === 'running')
    if (current) current.status = 'failed'
    job.error = err.message
    job.state = 'failed'
  }
}

function installedSummary(dir) {
  const envPath = path.join(dir, '.env')
  if (!fs.existsSync(envPath)) return null
  const env = readEnv(fs.readFileSync(envPath, 'utf8'))
  return { domain: env.DOMAIN, setupCode: env.CONTROL_TOKEN, image: env.WEEHS_IMAGE }
}

// ── The local web server ────────────────────────────────────────────────────
function openBrowser(url) {
  if (process.env.WEEHS_INSTALLER_NO_BROWSER) return
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    // The URL is printed too, for a desktop with no default browser set.
  }
}

function main() {
  const token = randomBytes(24).toString('hex')
  let dir = path.resolve(defaultDir())
  let idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS)

  const server = http.createServer(async (req, res) => {
    clearTimeout(idle)
    idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS)
    const { port } = server.address()
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    const expectedHost = `127.0.0.1:${port}`
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(type === 'application/json' ? JSON.stringify(body) : body)
    }

    if (req.method === 'GET' && url.pathname === '/') {
      if (
        !allowedRequest({
          host: req.headers.host,
          token: url.searchParams.get('t'),
          expectedHost,
          expectedToken: token,
        })
      ) {
        send(
          403,
          'Open the address this installer printed when it started.',
          'text/plain; charset=utf-8'
        )
        return
      }
      send(200, uiHtml().replace('__TOKEN__', token), 'text/html; charset=utf-8')
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      send(404, { error: 'not found' })
      return
    }
    // The backup is a download link, which cannot carry a header.
    const given =
      url.pathname === '/api/backup' ? url.searchParams.get('t') : req.headers['x-installer-token']
    if (
      !allowedRequest({ host: req.headers.host, token: given, expectedHost, expectedToken: token })
    ) {
      send(403, { error: 'refused' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      send(200, {
        release: releaseInfo(),
        dir,
        checks: await checks(dir),
        installed: installedSummary(dir),
        job: { state: job.state, steps: job.steps, log: job.log.slice(-60), error: job.error },
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/install') {
      if (job.state === 'running') {
        send(409, { error: 'An installation is already running.' })
        return
      }
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 16_384) break
      }
      let input
      try {
        input = JSON.parse(body || '{}')
      } catch {
        send(400, { error: 'That could not be read.' })
        return
      }
      const wanted = String(input.dir || dir).trim()
      if (!path.isAbsolute(wanted) || !safeValue(wanted)) {
        send(400, { error: 'The folder must be a full path, like ' + defaultDir() })
        return
      }
      dir = path.resolve(wanted)
      const already = fs.existsSync(path.join(dir, '.env'))
      const domain = String(input.domain || '')
        .trim()
        .toLowerCase()
      if (!already && !validDomain(domain)) {
        send(400, {
          error: 'Enter the address as a name only, like ehs.example.com (no https://).',
        })
        return
      }
      const mail = input.mail && typeof input.mail === 'object' ? input.mail : {}
      for (const v of Object.values(mail)) {
        if (v != null && !safeValue(String(v))) {
          send(400, { error: 'A mail setting contains a line break.' })
          return
        }
      }
      install(dir, { domain, image: releaseInfo().image, mail })
      send(202, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/backup') {
      const envPath = path.join(dir, '.env')
      if (!fs.existsSync(envPath)) {
        send(404, { error: 'Nothing is installed yet.' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="weehs-settings-backup.env"',
        'Cache-Control': 'no-store',
      })
      res.end(fs.readFileSync(envPath))
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/quit') {
      send(200, { ok: true })
      setTimeout(() => process.exit(0), 200)
      return
    }
    send(404, { error: 'not found' })
  })

  server.listen(Number(process.env.WEEHS_INSTALLER_PORT || 0), '127.0.0.1', () => {
    const { port } = server.address()
    const address = `http://127.0.0.1:${port}/?t=${token}`
    say('WEEHS Installer is open in your web browser.')
    say(`If it did not open, go to: ${address}`)
    openBrowser(address)
  })
}

if (require.main === module) main()

module.exports = { main, checks, install, job }
