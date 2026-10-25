#!/usr/bin/env node
/**
 * Compare the rules and indexes in this checkout with what the project is
 * already enforcing.
 *
 * v2.0.4 ran the rules deploy five times. Two attempts died on
 * firebaserules `:test` with HTTP 503; the other three compiled
 * firestore.rules and then died on POST /rulesets with the same 503. The
 * CLI still tried to upload. The files are the ruleset an earlier release
 * already published, so another upload cannot change what production
 * enforces and it blocks hosting behind a compiler call that is not
 * returning.
 *
 * Exit 0 and print `match` when the released Firestore rules, the released
 * Storage rules for the default bucket, and the composite indexes this
 * file requires are already live. The caller skips the Rules API.
 *
 * Exit 10 and print `differ <parts>` when the live release was read and at
 * least one of firestore, storage, indexes would still be deployed. The
 * caller deploys those parts. Hosting waits on that deploy.
 *
 * Exit 1 and print `unknown` when the live release could not be read. That
 * is not a match. The caller deploys everything and hosting still waits.
 *
 * The comparison is the Rules API and the Firestore Admin API. A release
 * tag is not an input: a tag can point at a commit whose rules never
 * became the release.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/
const RULESET = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/rulesets\/[A-Za-z0-9_-]+$/

export function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n')
}

/**
 * The released source is one file. A fingerprint on that file is output-only
 * and is not part of the source the CLI uploaded. Extra files mean this
 * deploy would replace a ruleset it does not fully describe.
 */
export function rulesetMatches(localText, ruleset) {
  const files = ruleset?.source?.files
  if (!Array.isArray(files) || files.length !== 1) return false
  const content = files[0]?.content
  if (typeof content !== 'string' || content.length === 0) return false
  if (typeof localText !== 'string' || localText.length === 0) return false
  return normalizeNewlines(content) === normalizeNewlines(localText)
}

export function collectionGroupFromIndexName(name) {
  const match = String(name).match(/\/collectionGroups\/([^/]+)\/indexes\/[^/]+$/)
  return match ? decodeURIComponent(match[1]) : null
}

export function collectionGroupFromFieldName(name) {
  const match = String(name).match(/\/collectionGroups\/([^/]+)\/fields\/([^/]+)$/)
  if (!match) return null
  return {
    collectionGroup: decodeURIComponent(match[1]),
    fieldPath: decodeURIComponent(match[2]),
  }
}

function lastFieldOrder(fields) {
  let order = 'ASCENDING'
  for (const field of fields) {
    if (field.order) order = field.order
  }
  return order
}

// STANDARD indexes store an implicit __name__ field. The indexes file does
// not. firebase-tools appends it before comparing, and so does this.
function fieldsForCompare(spec, edition) {
  const fields = (spec.fields || []).map((field) => ({ ...field }))
  if (edition === 'ENTERPRISE') return fields
  const last = fields[fields.length - 1]
  if (!last) return fields
  if (last.vectorConfig) {
    const vector = fields.pop()
    if (fields.length === 0 || fields[fields.length - 1].fieldPath !== '__name__') {
      fields.push({ fieldPath: '__name__', order: lastFieldOrder(fields) })
    }
    fields.push(vector)
    return fields
  }
  if (last.fieldPath !== '__name__') {
    fields.push({ fieldPath: '__name__', order: lastFieldOrder(fields) })
  }
  return fields
}

function sameOptional(left, right, fallback) {
  const l = left === undefined || left === null ? fallback : left
  const r = right === undefined || right === null ? fallback : right
  return l === r
}

function sameObject(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Same equivalence as firebase-tools FirestoreApi.indexMatchesSpec. Extra
 * live indexes are not a difference: this deploy does not pass --force, so
 * it would not delete them.
 */
export function indexMatchesSpec(live, spec, edition = 'STANDARD') {
  if (collectionGroupFromIndexName(live?.name) !== spec?.collectionGroup) return false
  if (live.queryScope !== spec.queryScope) return false
  if (!sameOptional(live.apiScope, spec.apiScope, 'ANY_API')) return false
  const densityDefault = edition === 'ENTERPRISE' ? 'DENSE' : 'SPARSE_ALL'
  if (!sameOptional(live.density, spec.density, densityDefault)) return false
  if (!sameOptional(live.multikey, spec.multikey, false)) return false

  const specFields = fieldsForCompare(spec, edition)
  const liveFields = live.fields || []
  if (liveFields.length !== specFields.length) return false
  for (let i = 0; i < liveFields.length; i++) {
    const got = liveFields[i]
    const want = specFields[i]
    if (got.fieldPath !== want.fieldPath) return false
    if ((got.order || undefined) !== (want.order || undefined)) return false
    if ((got.arrayConfig || undefined) !== (want.arrayConfig || undefined)) return false
    if (!sameObject(got.vectorConfig, want.vectorConfig)) return false
    if (!sameObject(got.searchConfig, want.searchConfig)) return false
  }
  return true
}

export function indexesSatisfied(localIndexes, liveIndexes, edition = 'STANDARD') {
  if (!Array.isArray(localIndexes) || !Array.isArray(liveIndexes)) return false
  return localIndexes.every((spec) =>
    liveIndexes.some((live) => indexMatchesSpec(live, spec, edition))
  )
}

function fieldModes(indexes) {
  return (indexes || []).map((index) => {
    const first = index.fields?.[0] || index
    return first.order || first.arrayConfig
  })
}

export function fieldMatchesSpec(live, spec) {
  const parsed = collectionGroupFromFieldName(live?.name)
  if (!parsed) return false
  if (parsed.collectionGroup !== spec.collectionGroup) return false
  if (parsed.fieldPath !== spec.fieldPath) return false
  if (typeof spec.ttl !== 'undefined' && !!live.ttlConfig !== !!spec.ttl) return false
  const liveIndexes = live.indexConfig?.indexes || []
  const specIndexes = spec.indexes || []
  if (liveIndexes.length !== specIndexes.length) return false
  const got = fieldModes(liveIndexes)
  const want = specIndexes.map((index) => index.order || index.arrayConfig)
  return want.every((mode) => got.includes(mode)) && got.every((mode) => want.includes(mode))
}

export function fieldOverridesSatisfied(localOverrides, liveFields) {
  if (!Array.isArray(localOverrides) || localOverrides.length === 0) return true
  if (!Array.isArray(liveFields)) return false
  return localOverrides.every((spec) => liveFields.some((live) => fieldMatchesSpec(live, spec)))
}

export function assess(local, live) {
  if (!live || !Array.isArray(live.indexes)) return { kind: 'unknown' }
  const parts = []
  if (!rulesetMatches(local.firestoreRules, live.firestoreRuleset)) parts.push('firestore')
  if (!rulesetMatches(local.storageRules, live.storageRuleset)) parts.push('storage')
  if (!indexesSatisfied(local.indexes, live.indexes, live.edition || 'STANDARD')) {
    parts.push('indexes')
  }
  if ((local.fieldOverrides || []).length > 0) {
    if (!Array.isArray(live.fieldOverrides)) return { kind: 'unknown' }
    if (!fieldOverridesSatisfied(local.fieldOverrides, live.fieldOverrides)) {
      if (!parts.includes('indexes')) parts.push('indexes')
    }
  }
  if (parts.length === 0) return { kind: 'match' }
  return { kind: 'differ', parts }
}

function fail(message) {
  const err = new Error(message)
  err.code = 'unknown'
  throw err
}

function assertProjectId(projectId) {
  if (!PROJECT_ID.test(projectId || '')) fail('PROJECT_ID is not a Firebase project id')
}

function safeRel(rel) {
  if (
    typeof rel !== 'string' ||
    rel.length === 0 ||
    path.isAbsolute(rel) ||
    rel.split(/[\\/]/).includes('..')
  ) {
    fail('firebase.json rules path is not a file inside this repo')
  }
}

export function loadLocal(cwd, readFile) {
  const firebaseJson = JSON.parse(readFile(path.join(cwd, 'firebase.json')))
  const rulesPath = firebaseJson?.firestore?.rules
  const indexesPath = firebaseJson?.firestore?.indexes
  const storage = firebaseJson?.storage
  if (Array.isArray(storage)) fail('firebase.json names more than one storage rules file')
  safeRel(rulesPath)
  safeRel(indexesPath)
  safeRel(storage?.rules)
  const indexes = JSON.parse(readFile(path.join(cwd, indexesPath)))
  if (!Array.isArray(indexes.indexes)) fail('firestore indexes file has no indexes array')
  return {
    firestoreRules: readFile(path.join(cwd, rulesPath)),
    storageRules: readFile(path.join(cwd, storage.rules)),
    indexes: indexes.indexes,
    fieldOverrides: Array.isArray(indexes.fieldOverrides) ? indexes.fieldOverrides : [],
  }
}

export function loadServiceAccount(env, readFile) {
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) fail('GOOGLE_APPLICATION_CREDENTIALS is not set')
  let parsed
  try {
    parsed = JSON.parse(readFile(credPath))
  } catch {
    fail('service account JSON could not be read')
  }
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    fail('service account JSON is missing client_email or private_key')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

export async function fetchAccessToken(serviceAccount, fetchImpl) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url')
  const unsigned = `${header}.${claim}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const assertion = `${unsigned}.${signer.sign(serviceAccount.private_key).toString('base64url')}`
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: globalThis.AbortSignal.timeout(20000),
  })
  if (!res.ok) fail(`token endpoint HTTP ${res.status}`)
  const body = await res.json()
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    fail('token endpoint returned no access_token')
  }
  return body.access_token
}

async function getJson(url, token, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: globalThis.AbortSignal.timeout(20000),
  })
  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return 'request'
    }
  })()
  if (!res.ok) fail(`GET ${pathname} HTTP ${res.status}`)
  return res.json()
}

async function getPaged(baseUrl, token, fetchImpl, listKey) {
  const items = []
  let pageToken = ''
  for (let page = 0; page < 20; page++) {
    const url = new URL(baseUrl)
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const body = await getJson(url, token, fetchImpl)
    if (Array.isArray(body[listKey])) items.push(...body[listKey])
    if (!body.nextPageToken) return items
    pageToken = body.nextPageToken
  }
  fail(`GET ${new URL(baseUrl).pathname} did not finish paging`)
}

function releaseRulesetName(releases, projectId, releaseId) {
  const full = `projects/${projectId}/releases/${releaseId}`
  const found = releases.find((release) => release?.name === full)
  return found?.rulesetName || null
}

async function getRuleset(rulesetName, token, fetchImpl) {
  if (!RULESET.test(rulesetName || '')) fail('ruleset name from the API was rejected')
  return getJson(`https://firebaserules.googleapis.com/v1/${rulesetName}`, token, fetchImpl)
}

async function defaultBucket(projectId, token, fetchImpl) {
  const body = await getJson(
    `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
    token,
    fetchImpl
  )
  const raw = body?.bucket?.name
  const name = typeof raw === 'string' ? raw.split('/').pop() : ''
  if (!BUCKET.test(name)) fail('default storage bucket name was rejected')
  return name
}

export async function fetchLiveSnapshot(projectId, token, fetchImpl, local) {
  assertProjectId(projectId)
  const releases = await getPaged(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
    token,
    fetchImpl,
    'releases'
  )
  const bucket = await defaultBucket(projectId, token, fetchImpl)
  const firestoreName = releaseRulesetName(releases, projectId, 'cloud.firestore')
  const storageName = releaseRulesetName(releases, projectId, `firebase.storage/${bucket}`)
  const firestoreRuleset = firestoreName ? await getRuleset(firestoreName, token, fetchImpl) : null
  const storageRuleset = storageName ? await getRuleset(storageName, token, fetchImpl) : null
  const indexes = await getPaged(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`,
    token,
    fetchImpl,
    'indexes'
  )
  let edition = 'STANDARD'
  try {
    const database = await getJson(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`,
      token,
      fetchImpl
    )
    if (database.databaseEdition === 'ENTERPRISE') edition = 'ENTERPRISE'
  } catch {
    edition = 'STANDARD'
  }
  let fieldOverrides
  if ((local.fieldOverrides || []).length > 0) {
    const parent = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/-/fields`
    const url = new URL(parent)
    url.searchParams.set('filter', 'indexConfig.usesAncestorConfig=false OR ttlConfig:*')
    const fields = await getPaged(url, token, fetchImpl, 'fields')
    fieldOverrides = fields.filter((field) => !String(field.name || '').includes('__default__'))
  }
  return { firestoreRuleset, storageRuleset, indexes, edition, fieldOverrides }
}

function resultFor(assessed, detail) {
  if (assessed.kind === 'match') return { code: 0, line: 'match', detail }
  if (assessed.kind === 'differ') {
    return { code: 10, line: ['differ', ...assessed.parts].join(' '), detail }
  }
  return { code: 1, line: 'unknown', detail }
}

export async function run(opts = {}) {
  const env = opts.env || process.env
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const cwd = opts.cwd || process.cwd()
  const readFile = opts.readFile || ((file) => fs.readFileSync(file, 'utf8'))
  try {
    const projectId = env.PROJECT_ID || ''
    assertProjectId(projectId)
    const local = loadLocal(cwd, readFile)
    const token =
      opts.token ||
      (await fetchAccessToken(opts.serviceAccount || loadServiceAccount(env, readFile), fetchImpl))
    const live = await fetchLiveSnapshot(projectId, token, fetchImpl, local)
    const assessed = assess(local, live)
    const detail =
      assessed.kind === 'match'
        ? 'Live Firestore rules, Storage rules and indexes match this commit.'
        : assessed.kind === 'differ'
          ? `Live release differs: ${assessed.parts.join(', ')}.`
          : 'Live release could not be compared.'
    return resultFor(assessed, detail)
  } catch (err) {
    const detail =
      err?.message && !/private_key|BEGIN /.test(err.message)
        ? err.message
        : 'live comparison failed'
    return { code: 1, line: 'unknown', detail }
  }
}

function invokedDirectly() {
  const self = fileURLToPath(import.meta.url)
  const arg = process.argv[1]
  return !!arg && path.resolve(arg) === self
}

if (invokedDirectly()) {
  const out = await run()
  if (out.detail) console.error(out.detail)
  console.log(out.line)
  process.exit(out.code)
}
