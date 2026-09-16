// ─────────────────────────────────────────────────────────────────────────────
// Pins the CI / Docker / hosting hygiene this review closed, so a later edit
// cannot quietly put the previous failure modes back.
//
// These are string assertions against YAML/JSON/JS, not a workflow runner.
// That is deliberate: the defects they catch are all of the form "the file
// says X when it must say Y", and they failed in production (or would have
// on `docker compose up`) without any test ever opening the file.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const read = (p) => readFileSync(p, 'utf8')

const WORKFLOWS = [
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/deploy-staging.yml',
]

describe('GitHub Actions least privilege', () => {
  it.each(WORKFLOWS)('%s declares permissions: contents: read', (file) => {
    const yml = read(file)
    // A missing block inherits the repository default, which is often write.
    // ISO 27001 LOW-28. The three workflows only check out the tree.
    expect(yml).toMatch(/permissions:\s*\n\s+contents:\s+read/)
  })
})

describe('service-account JSON is not interpolated into the shell', () => {
  it.each(['.github/workflows/deploy.yml', '.github/workflows/deploy-staging.yml'])(
    '%s does not echo a secret into the generated script',
    (file) => {
      const yml = read(file)
      // The unsafe form is a run-step command, not a comment describing it.
      // `env: SECRET: ${{ secrets.X }}` then `"$SECRET"` is the safe pattern
      // the creds-check step already used; echo '${{ secrets.… }}' is not.
      expect(yml).not.toMatch(/^\s*echo\s+['"]\$\{\{\s*secrets\./m)
    }
  )

  it('writes the key from an env var and removes it afterwards', () => {
    for (const file of ['.github/workflows/deploy.yml', '.github/workflows/deploy-staging.yml']) {
      const yml = read(file)
      expect(yml, file).toMatch(/printf '%s' "\$FIREBASE_SERVICE_ACCOUNT"/)
      expect(yml, file).toMatch(/Remove the service-account key/)
      expect(yml, file).toMatch(/rm -f "\$RUNNER_TEMP\//)
    }
  })
})

describe('Playwright does not reuse a CI dev server', () => {
  it('reuseExistingServer is off when CI is set', () => {
    const cfg = read('playwright.config.js')
    // Unconditional `true` would let the capped-reads job reuse the previous
    // step's Vite process, which was started without VITE_TEST_READ_CAP.
    expect(cfg).toMatch(/reuseExistingServer:\s*!process\.env\.CI/)
    expect(cfg).not.toMatch(/reuseExistingServer:\s*true/)
  })
})

describe('hosting CSP allows Sentry ingest', () => {
  it('connect-src names the ingest hosts the SDK actually calls', () => {
    const json = read('firebase.json')
    // VITE_SENTRY_DSN is wired into production and staging builds. Without
    // these origins a browser with a DSN set drops every event on the CSP
    // and the monitoring funnel is a no-op that looks configured.
    expect(json).toContain('https://*.ingest.sentry.io')
    expect(json).toContain('https://*.ingest.us.sentry.io')
  })
})

describe('Cloud Functions tests run on the runtime they deploy to', () => {
  it('the functions CI job uses Node 22', () => {
    const yml = read('.github/workflows/ci.yml')
    const engines = JSON.parse(read('functions/package.json')).engines.node
    expect(engines).toBe('22')
    // The functions job is the block that follows "name: Cloud Functions tests".
    const job = yml.split('name: Cloud Functions tests')[1]?.split(/^[ ]{2}[a-z]/m)[0] || ''
    expect(job).toMatch(/node-version:\s*22/)
    expect(job).toMatch(/cache-dependency-path:\s*functions\/package-lock\.json/)
  })
})

describe('staging deploys rules only after the rules suite', () => {
  it('installs a JDK and runs npm run test:rules', () => {
    const yml = read('.github/workflows/deploy-staging.yml')
    expect(yml).toMatch(/actions\/setup-java@v5/)
    expect(yml).toMatch(/npm run test:rules/)
  })
})

describe('docker compose can actually boot the emulators', () => {
  it('builds an image that has a JDK, rather than a bare Node image', () => {
    const compose = read('docker-compose.yml')
    const dockerfile = read('Dockerfile.emulators')
    expect(compose).toMatch(/dockerfile:\s*Dockerfile\.emulators/)
    expect(dockerfile).toMatch(/openjdk-17-jre-headless/)
  })

  it('binds the emulators on 0.0.0.0 so the web container can reach them', () => {
    const dockerCfg = JSON.parse(read('firebase.docker.json'))
    expect(dockerCfg.emulators.auth.host).toBe('0.0.0.0')
    expect(dockerCfg.emulators.firestore.host).toBe('0.0.0.0')
    expect(dockerCfg.emulators.storage.host).toBe('0.0.0.0')
    // The laptop config stays loopback — that is the whole reason there are two
    // files. A copy-paste that puts 0.0.0.0 into firebase.json is a laptop
    // listening on the LAN with no authentication on the emulator.
    const local = JSON.parse(read('firebase.json'))
    expect(local.emulators.auth.host == null || local.emulators.auth.host === '127.0.0.1').toBe(
      true
    )
  })

  it('creates the import directory before starting', () => {
    expect(read('docker-compose.yml')).toMatch(/mkdir -p \/app\/emulator-data/)
  })
})
