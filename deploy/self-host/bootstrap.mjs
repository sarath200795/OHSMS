// Create the secret files for a local self-hosted stack.
//
// The admin password is read from secrets/bootstrap-password. Generated
// service secrets are written next to it, mode 0600. This script prints
// file names only. It does not print passwords, keys, or tokens.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] || process.cwd()
const secrets = join(root, 'secrets')
const passwordFile = join(secrets, 'bootstrap-password')

function die(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(passwordFile)) {
  die(
    'Create secrets/bootstrap-password with mode 0600 and one line: the admin password. The file was not found.'
  )
}
const mode = statSync(passwordFile).mode & 0o077
if (process.platform !== 'win32' && mode !== 0) {
  die(
    'secrets/bootstrap-password must be mode 0600. It is readable by someone other than the owner.'
  )
}
const password = readFileSync(passwordFile, 'utf8').trim()
if (password.length < 12) die('The bootstrap password must be at least 12 characters.')

mkdirSync(secrets, { recursive: true })

function writeNew(name) {
  const path = join(secrets, name)
  if (existsSync(path)) {
    console.log(`${name} already exists; left unchanged`)
    return readFileSync(path, 'utf8').trim()
  }
  const value = randomBytes(24).toString('base64url')
  writeFileSync(path, `${value}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  console.log(`wrote secrets/${name}`)
  return value
}

const postgres = writeNew('postgres-password')
const minio = writeNew('minio-root-password')
const keycloak = writeNew('keycloak-admin-password')
writeNew('session-secret')
writeNew('data-key-master')
writeNew('control-token')

const envPath = join(secrets, 'compose.env')
writeFileSync(
  envPath,
  [
    `POSTGRES_PASSWORD=${postgres}`,
    'POSTGRES_USER=ohsms',
    'POSTGRES_DB=ohsms',
    'MINIO_ROOT_USER=ohsms',
    `MINIO_ROOT_PASSWORD=${minio}`,
    'KC_BOOTSTRAP_ADMIN_USERNAME=admin',
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${keycloak}`,
    '',
  ].join('\n'),
  { mode: 0o600 }
)
chmodSync(envPath, 0o600)
console.log('wrote secrets/compose.env')
console.log('Secret values were not printed.')
