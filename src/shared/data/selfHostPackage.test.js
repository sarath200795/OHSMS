import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REPO_ROOT,
  copyCovers,
  dockerCopies,
  productionPackages,
  runtimeClosure,
} from '../../../deploy/self-host/runtimeClosure.mjs'

const SECRET_ENV = [
  'POSTGRES_PASSWORD_FILE',
  'MINIO_PASSWORD_FILE',
  'KEYCLOAK_ADMIN_PASSWORD_FILE',
  'BOOTSTRAP_PASSWORD_FILE',
  'SESSION_SECRET_FILE',
  'DATA_KEY_MASTER_FILE',
  'CONTROL_TOKEN_FILE',
  'DATABASE_URL',
]

function stage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ohsms-image-'))
  for (const rel of files) {
    const dest = join(dir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(REPO_ROOT, rel), dest)
  }
  cpSync(join(REPO_ROOT, 'package.json'), join(dir, 'package.json'))
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

function smokeImport(cwd) {
  const env = { ...process.env }
  for (const key of SECRET_ENV) delete env[key]
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        'try { await import("./stack/self-host.mjs") }',
        'catch (e) {',
        '  const missing = e && (e.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/.test(String(e.message)))',
        '  if (missing) { console.error(e.message); process.exit(2) }',
        '  if (/secret file is missing/.test(String(e && e.message))) process.exit(0)',
        '  console.error(e && (e.stack || e.message))',
        '  process.exit(1)',
        '}',
        'console.error("self-host started without a secret file")',
        'process.exit(1)',
      ].join('\n'),
    ],
    { cwd, env, encoding: 'utf8', timeout: 30000 }
  )
}

describe('self-host image closure', () => {
  const closure = runtimeClosure()
  const dockerfile = readFileSync(join(REPO_ROOT, 'deploy/self-host/Dockerfile'), 'utf8')
  const copies = dockerCopies(dockerfile)

  it('covers every file the process imports, including functions/lib', () => {
    expect(closure.files).toContain('functions/lib/fileDelete.js')
    expect(closure.files).toContain('functions/lib/subjectData.js')
    expect(closure.files).toContain('stack/schema.sql')
    const missed = closure.files.filter((rel) => !copyCovers(copies, rel))
    expect(missed).toEqual([])
  })

  it('resolves bare imports from production dependencies, not devDependencies', () => {
    const prod = productionPackages()
    const missed = closure.packages.filter((name) => !prod.has(name))
    expect(missed).toEqual([])
    expect(prod.has('xml-crypto')).toBe(true)
    expect(prod.has('@electric-sql/pglite')).toBe(false)
  })

  it('imports the entrypoint from the packaged files and stops at the missing secret', () => {
    const dir = stage(closure.files)
    try {
      const result = smokeImport(dir)
      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails the same way the Mac image did when functions/lib is omitted', () => {
    const dir = stage(closure.files.filter((rel) => !rel.startsWith('functions/')))
    try {
      const result = smokeImport(dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/fileDelete\.js/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
