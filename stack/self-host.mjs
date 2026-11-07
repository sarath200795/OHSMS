// Self-hosted process. Postgres, Keycloak, and MinIO are separate containers.
// This process is the dedicated host: it serves the SPA, files a local
// registration, and stores files in the bucket. Passwords are read from
// files. Nothing in this file writes them to stdout.

import { readFileSync } from 'node:fs'
import { createEngine, applySchema } from './engine.mjs'
import { reconcileOwnerGrants } from './ownerGrant.mjs'
import { createPgDatabase } from './pgdb.mjs'
import { s3Blobs } from './s3blob.mjs'
import { configureKeycloak } from './keycloakAdmin.mjs'
import { createOwnStackServer } from './server.mjs'

function secret(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`secret file is missing: ${path}`)
  }
  const value = text.trim()
  if (!value) throw new Error(`secret file is empty: ${path}`)
  return value
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function until(label, fn) {
  for (let i = 0; i < 90; i += 1) {
    try {
      return await fn()
    } catch {
      // The driver error can quote the connection string. The retry must
      // not print it.
      await wait(2000)
    }
  }
  throw new Error(`${label} did not become ready`)
}

const origin = process.env.OHSMS_ORIGIN || 'http://127.0.0.1:8787'
const keycloakPublic = process.env.KEYCLOAK_PUBLIC_URL || 'http://127.0.0.1:8080'
const keycloakInternal = process.env.KEYCLOAK_INTERNAL_URL || 'http://keycloak:8080'
const realm = 'ohsms'
const clientId = 'ohsms'
const minioUser = process.env.MINIO_ROOT_USER || 'ohsms'

const postgresPassword = secret(process.env.POSTGRES_PASSWORD_FILE)
const minioPassword = secret(process.env.MINIO_PASSWORD_FILE)
const keycloakAdminPassword = secret(process.env.KEYCLOAK_ADMIN_PASSWORD_FILE)
const bootstrapPassword = secret(process.env.BOOTSTRAP_PASSWORD_FILE)
const sessionSecret = secret(process.env.SESSION_SECRET_FILE)
const dataKeyMaster = secret(process.env.DATA_KEY_MASTER_FILE)
const controlToken = secret(process.env.CONTROL_TOKEN_FILE)

const databaseUrl = `postgres://ohsms:${encodeURIComponent(postgresPassword)}@${process.env.POSTGRES_HOST || 'postgres'}:5432/ohsms`
const db = createPgDatabase(databaseUrl)
await until('postgres', () => db.query('SELECT 1'))
await applySchema(db)
const engine = createEngine(db)
await reconcileOwnerGrants(engine, db)

const blobs = s3Blobs({
  endpoint: process.env.MINIO_ENDPOINT || 'http://minio:9000',
  bucket: 'ohsms',
  accessKeyId: minioUser,
  secretAccessKey: minioPassword,
  region: 'us-east-1',
})
await until('minio', () => blobs.ensureBucket())

const idp = await until('keycloak', () =>
  configureKeycloak({
    internalUrl: keycloakInternal,
    publicUrl: keycloakPublic,
    adminUser: process.env.KEYCLOAK_ADMIN || 'admin',
    adminPassword: keycloakAdminPassword,
    realm,
    clientId,
    acsUrl: `${origin}/auth/saml/acs`,
    sloUrl: `${origin}/auth/saml/slo`,
  })
)

const heldSecrets = {
  databaseUrl,
  samlIdpCert: idp.cert,
  samlEntryPoint: idp.entryPoint,
  s3AccessKeyId: minioUser,
  s3SecretAccessKey: minioPassword,
  sessionSecret,
  dataKeyMaster,
}

const server = createOwnStackServer({
  engine,
  db,
  sessionSecret,
  origin,
  auth: {
    method: 'saml',
    clientId,
    idpCert: idp.cert,
    entryPoint: idp.entryPoint,
    forceAuthn: true,
  },
  blobs,
  controlToken,
  dataKeyMaster,
  localFiling: true,
  heldSecrets,
  prepareIdentity: (request) =>
    configureKeycloak({
      internalUrl: keycloakInternal,
      publicUrl: keycloakPublic,
      adminUser: process.env.KEYCLOAK_ADMIN || 'admin',
      adminPassword: keycloakAdminPassword,
      realm,
      clientId,
      acsUrl: `${origin}/auth/saml/acs`,
      sloUrl: `${origin}/auth/saml/slo`,
      userEmail: request.contactEmail,
      userPassword: bootstrapPassword,
      userName: request.contactName,
    }),
  publicEnv: {
    VITE_DATA_DRIVER: 'postgres',
    VITE_DATA_GATEWAY: origin,
    VITE_STORAGE_DRIVER: 's3',
    VITE_S3_PRESIGN_ENDPOINT: `${origin}/presign`,
    VITE_AUTH_METHOD: 'saml',
    VITE_AUTH_ISSUER: `${keycloakPublic}/realms/${realm}`,
    VITE_AUTH_CLIENT_ID: clientId,
    VITE_AUTH_TOTP: 'off',
  },
  envExtras: { VITE_CONTROL_PLANE: 'local' },
  requests: new Map(),
})

await new Promise((resolve) => server.listen(8787, '0.0.0.0', resolve))
console.log(`OHSMS is listening on ${origin}`)
console.log(`SAML IdP entry point is ${idp.entryPoint}`)
console.log('Passwords and signing keys stay in the secret files. They are not printed.')
