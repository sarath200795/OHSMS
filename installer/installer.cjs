// WEEHS Installer: installs a self-hosted WEEHS without a terminal.
//
// Double-clicked on the server, it answers on port 80, which is the company's
// own address once its DNS record points here, and shows a one-time
// installer code on the server's own screen. From any computer the IT admin
// opens http://their-address, enters the code, and the installer page checks
// Docker, takes the address, writes the settings, prepares the containers,
// and finally hands port 80 over to WEEHS: Caddy takes the address with
// HTTPS, and the browser lands on https://their-address/setup with the setup
// code already filled in. Every screen is at the company's own address.
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
const {
  validDomain,
  safeValue,
  buildEnv,
  readEnv,
  normalizeCode,
  sameSecret,
  makeInstallerCode,
  createLockout,
  actionAllowed,
} = require('./core.cjs')
const { kitFiles, uiHtml, codeHtml, releaseInfo } = require('./assets.cjs')

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

async function checks() {
  const docker = await run('docker', ['version', '--format', '{{.Server.Version}}'])
  const compose = docker.code === 0 ? await run('docker', ['compose', 'version', '--short']) : null
  return {
    os: process.platform,
    docker: docker.code === 0 ? docker.output.trim() : null,
    dockerProblem:
      docker.code === 0 ? '' : /not found|ENOENT/i.test(docker.output) ? 'missing' : 'not-running',
    compose: compose && compose.code === 0 ? compose.output.trim() : null,
    // Port 80 is this installer's until the hand-over, so only 443 is asked.
    port443: await portFree(443),
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
const job = { state: 'idle', steps: [], log: [], error: '' }

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

function fail(err) {
  const current = job.steps.find((s) => s.status === 'running')
  if (current) current.status = 'failed'
  job.error = err.message
  job.state = 'failed'
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

/** Everything before the hand-over: files, settings, images, containers. */
async function prepare(dir, settings) {
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
      fs.writeFileSync(envPath, buildEnv(kit['.env.example'], settings), { mode: 0o600 })
      logLine('Settings written, readable by this account only.')
    }
    step('Write the settings and new secrets', 'done')

    // Images and containers now, so the hand-over below is only a start and
    // the address is without an answer for as short a time as possible.
    step('Download and prepare WEEHS', 'running')
    const pulled = await run('docker', ['compose', 'pull', '--ignore-pull-failures'], {
      cwd: dir,
      onLine: logLine,
    })
    if (pulled.code !== 0)
      logLine('Some images were not downloaded; using the ones on this computer.')
    const created = await run('docker', ['compose', 'create'], { cwd: dir, onLine: logLine })
    if (created.code !== 0)
      throw new Error('Docker could not prepare WEEHS. The details are below.')
    step('Download and prepare WEEHS', 'done')
    job.state = 'ready'
  } catch (err) {
    fail(err)
  }
}

/** The hand-over: this program leaves port 80, WEEHS starts and takes it. */
async function start(dir, domain) {
  step('Start WEEHS with HTTPS', 'running')
  const up = await run('docker', ['compose', 'up', '-d'], { cwd: dir, onLine: logLine })
  if (up.code !== 0) throw new Error('Docker could not start WEEHS. The details are below.')
  let ok = false
  for (let i = 0; i < 90 && !ok; i += 1) {
    ok = await health(domain)
    if (!ok) await new Promise((r) => setTimeout(r, 2000))
  }
  if (!ok) {
    const logs = await run('docker', ['compose', 'logs', '--tail', '20', 'app'], { cwd: dir })
    for (const line of logs.output.split(/\r?\n/)) if (line.trim()) logLine(line.trim())
    throw new Error('WEEHS did not answer within three minutes. The app’s log is below.')
  }
  step('Start WEEHS with HTTPS', 'done')
}

function settingsOf(dir) {
  const envPath = path.join(dir, '.env')
  if (!fs.existsSync(envPath)) return null
  const env = readEnv(fs.readFileSync(envPath, 'utf8'))
  return { domain: env.DOMAIN, setupCode: env.CONTROL_TOKEN }
}

// ── The web server ──────────────────────────────────────────────────────────
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
    // The address is printed too.
  }
}

const isLoopback = (addr) => /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ''))
const hostOnly = (host) =>
  String(host || '')
    .replace(/:\d+$/, '')
    .toLowerCase()

function main() {
  const code = makeInstallerCode()
  const session = randomBytes(24).toString('hex')
  const lockout = createLockout()
  const port = Number(process.env.WEEHS_INSTALLER_PORT || 80)
  let dir = path.resolve(defaultDir())
  let idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS)

  // Already installed: there is nothing to set up, only to start again.
  const existing = settingsOf(dir)
  if (existing) {
    say(`WEEHS is installed for ${existing.domain}. Starting it.`)
    run('docker', ['compose', 'up', '-d'], { cwd: dir }).then(() => {
      openBrowser(`https://${existing.domain}`)
      process.exit(0)
    })
    return
  }

  const server = http.createServer(async (req, res) => {
    clearTimeout(idle)
    idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS)
    const url = new URL(req.url, 'http://installer.invalid')
    const send = (status, body, type = 'application/json', headers = {}) => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        ...headers,
      })
      res.end(type === 'application/json' ? JSON.stringify(body) : body)
    }
    const readJson = async () => {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 16_384) break
      }
      try {
        return JSON.parse(body || '{}')
      } catch {
        return null
      }
    }

    if (req.method === 'GET' && url.pathname === '/') {
      // The server's own screen, opened by the installer itself, shows the
      // code. Nobody reaching the company address from outside ever does.
      const local =
        isLoopback(req.socket.remoteAddress) &&
        ['127.0.0.1', 'localhost'].includes(hostOnly(req.headers.host))
      send(
        200,
        (local ? codeHtml() : uiHtml()).replace('__CODE__', code),
        'text/html; charset=utf-8'
      )
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/claim') {
      const body = await readJson()
      if (lockout.locked()) {
        send(429, { error: 'Too many wrong codes. Wait a few minutes and try again.' })
        return
      }
      if (!body || !sameSecret(normalizeCode(body.code), code)) {
        lockout.fail()
        send(403, {
          error: 'That installer code is not right. It is shown on the server’s screen.',
        })
        return
      }
      send(200, { ok: true }, 'application/json', {
        'Set-Cookie': `weehs_installer=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`,
      })
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      send(404, { error: 'not found' })
      return
    }
    // The backup is a download link, which cannot set a header; the cookie is
    // SameSite=Strict, so another site's link to it arrives without one.
    const header = url.pathname === '/api/backup' ? '1' : req.headers['x-installer']
    if (!actionAllowed({ cookie: req.headers.cookie, header, session })) {
      send(401, { error: 'Enter the installer code first.' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const installed = settingsOf(dir)
      send(200, {
        release: releaseInfo(),
        dir,
        addressHint: hostOnly(req.headers.host),
        checks: job.state === 'idle' ? await checks() : null,
        settings: installed,
        job: { state: job.state, steps: job.steps, log: job.log.slice(-60), error: job.error },
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/prepare') {
      if (job.state === 'running') {
        send(409, { error: 'Already preparing.' })
        return
      }
      const input = await readJson()
      if (!input) {
        send(400, { error: 'That could not be read.' })
        return
      }
      const wanted = String(input.dir || dir).trim()
      if (!path.isAbsolute(wanted) || !safeValue(wanted)) {
        send(400, { error: `The folder must be a full path, like ${defaultDir()}` })
        return
      }
      dir = path.resolve(wanted)
      const domain = String(input.domain || '')
        .trim()
        .toLowerCase()
      if (!fs.existsSync(path.join(dir, '.env')) && !validDomain(domain)) {
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
      prepare(dir, { domain, image: releaseInfo().image, mail })
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
    if (req.method === 'POST' && url.pathname === '/api/finish') {
      const installed = settingsOf(dir)
      if (job.state !== 'ready' || !installed) {
        send(409, { error: 'Not ready to start yet.' })
        return
      }
      job.state = 'handing-over'
      send(200, { ok: true, https: `https://${installed.domain}` })
      // Leave port 80 to WEEHS. Should the start fail, come back on it, so the
      // page that is waiting can show what went wrong.
      server.close()
      server.closeAllConnections?.()
      try {
        await start(dir, installed.domain)
        job.state = 'done'
        say(`WEEHS is running at https://${installed.domain}. The installer has finished.`)
        setTimeout(() => process.exit(0), 500)
      } catch (err) {
        fail(err)
        server.listen(port, '0.0.0.0')
      }
      return
    }
    send(404, { error: 'not found' })
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      // Shown on the server's screen, in its own small page, so the person
      // who double-clicked it is told why, without a terminal.
      const reason =
        err.code === 'EADDRINUSE'
          ? 'Another program on this server is using the web port (80): another web server such as IIS, Apache or nginx. Stop it, then open the WEEHS Installer again.'
          : 'This account may not use the web port (80). Open the WEEHS Installer as an administrator.'
      const fallback = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          codeHtml().replace(
            /<main[\s\S]*<\/main>/,
            `<main><h1>WEEHS Installer cannot start</h1><p>${reason}</p></main>`
          )
        )
      })
      fallback.listen(0, '127.0.0.1', () =>
        openBrowser(`http://127.0.0.1:${fallback.address().port}/`)
      )
      say(reason)
      return
    }
    throw err
  })

  server.listen(port, '0.0.0.0', () => {
    say('WEEHS Installer is running.')
    say(
      `On any computer, open your company's address (http://ehs.yourcompany.com) and enter the installer code ${code}.`
    )
    openBrowser(`http://127.0.0.1${port === 80 ? '' : `:${port}`}/`)
  })
}

module.exports = { main, checks, prepare, start, job }
