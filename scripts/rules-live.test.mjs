import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assess,
  fetchAccessToken,
  fetchLiveSnapshot,
  indexMatchesSpec,
  rulesetMatches,
  run,
} from './rules-live.mjs'

const PROJECT = 'ohsms-demo'
const BUCKET = 'ohsms-demo.appspot.com'

function ruleset(content, extra = {}) {
  return { source: { files: [{ name: 'firestore.rules', content, ...extra }] } }
}

function liveIndex(group, fields, queryScope = 'COLLECTION') {
  return {
    name: `projects/${PROJECT}/databases/(default)/collectionGroups/${group}/indexes/abc`,
    queryScope,
    fields,
    state: 'READY',
  }
}

const documents = {
  collectionGroup: 'documents',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'siteId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
  ],
}

test('ruleset match ignores fingerprint and accepts CRLF', () => {
  const local = "rules_version = '2';\nservice cloud.firestore {}\n"
  assert.equal(rulesetMatches(local, ruleset(local, { fingerprint: 'abc' })), true)
  assert.equal(rulesetMatches(local, ruleset(local.replace(/\n/g, '\r\n'))), true)
})

test('ruleset match refuses a different source, an empty file, or a second file', () => {
  const local = "rules_version = '2';\n"
  assert.equal(rulesetMatches(local, ruleset("rules_version = '1';\n")), false)
  assert.equal(rulesetMatches('', ruleset('')), false)
  assert.equal(
    rulesetMatches(local, { source: { files: [{ content: local }, { content: local }] } }),
    false
  )
  assert.equal(rulesetMatches(local, null), false)
})

test('index match appends __name__ in the direction of the last ordered field', () => {
  const ready = liveIndex('documents', [
    { fieldPath: 'siteId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ])
  assert.equal(indexMatchesSpec(ready, documents, 'STANDARD'), true)
  const wrongDirection = liveIndex('documents', [
    { fieldPath: 'siteId', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ])
  assert.equal(indexMatchesSpec(wrongDirection, documents, 'STANDARD'), false)
})

test('enterprise indexes are not given an implicit __name__ field', () => {
  const bare = liveIndex('documents', documents.fields)
  assert.equal(indexMatchesSpec(bare, documents, 'ENTERPRISE'), true)
  assert.equal(indexMatchesSpec(bare, documents, 'STANDARD'), false)
})

test('assess matches when released source matches and every local index is live', () => {
  const local = {
    firestoreRules: 'firestore\n',
    storageRules: 'storage\n',
    indexes: [documents],
    fieldOverrides: [],
  }
  const live = {
    firestoreRuleset: ruleset('firestore\n'),
    storageRuleset: ruleset('storage\n'),
    indexes: [
      liveIndex('documents', [...documents.fields, { fieldPath: '__name__', order: 'DESCENDING' }]),
      liveIndex('other', [
        { fieldPath: 'a', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ]),
    ],
    edition: 'STANDARD',
  }
  assert.deepEqual(assess(local, live), { kind: 'match' })
})

test('assess reports only the parts a deploy would still change', () => {
  const local = {
    firestoreRules: 'firestore\n',
    storageRules: 'storage-new\n',
    indexes: [documents],
    fieldOverrides: [],
  }
  const live = {
    firestoreRuleset: ruleset('firestore\n'),
    storageRuleset: ruleset('storage\n'),
    indexes: [],
    edition: 'STANDARD',
  }
  assert.deepEqual(assess(local, live), { kind: 'differ', parts: ['storage', 'indexes'] })
})

test('a missing release is a difference, not an unread release', () => {
  const local = {
    firestoreRules: 'firestore\n',
    storageRules: 'storage\n',
    indexes: [],
    fieldOverrides: [],
  }
  assert.deepEqual(
    assess(local, {
      firestoreRuleset: null,
      storageRuleset: ruleset('storage\n'),
      indexes: [],
      edition: 'STANDARD',
    }),
    { kind: 'differ', parts: ['firestore'] }
  )
})

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'ya29.test' }),
  }
}

test('access token request signs a JWT and does not send the private key', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  let body = ''
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    body = String(init.body)
    return tokenResponse()
  }
  const token = await fetchAccessToken(
    { client_email: 'deploy@ohsms-demo.iam.gserviceaccount.com', private_key: pem },
    fetchImpl
  )
  assert.equal(token, 'ya29.test')
  assert.equal(body.includes('PRIVATE KEY'), false)
  assert.equal(body.includes(pem), false)
  const params = new URLSearchParams(body)
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const assertion = params.get('assertion')
  const payload = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
  assert.equal(payload.iss, 'deploy@ohsms-demo.iam.gserviceaccount.com')
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/cloud-platform')
})

function router(handlers) {
  return async (url) => {
    const target = new URL(url)
    const key = `${target.origin}${target.pathname}`
    const handler = handlers[key]
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return handler(target)
  }
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body }
}

test('live snapshot uses the default bucket and the exact release names', async () => {
  const seen = []
  const fetchImpl = router({
    'https://firebaserules.googleapis.com/v1/projects/ohsms-demo/releases': (url) => {
      seen.push(url.searchParams.get('pageToken') || 'page-1')
      if (!url.searchParams.get('pageToken')) {
        return ok({
          releases: [
            {
              name: `projects/${PROJECT}/releases/firebase.storage/other.appspot.com`,
              rulesetName: `projects/${PROJECT}/rulesets/other`,
            },
          ],
          nextPageToken: 'next',
        })
      }
      return ok({
        releases: [
          {
            name: `projects/${PROJECT}/releases/cloud.firestore`,
            rulesetName: `projects/${PROJECT}/rulesets/fs`,
          },
          {
            name: `projects/${PROJECT}/releases/firebase.storage/${BUCKET}`,
            rulesetName: `projects/${PROJECT}/rulesets/st`,
          },
        ],
      })
    },
    'https://firebasestorage.googleapis.com/v1alpha/projects/ohsms-demo/defaultBucket': () =>
      ok({ bucket: { name: `projects/1/buckets/${BUCKET}` } }),
    [`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/fs`]: () =>
      ok(ruleset('firestore\n', { fingerprint: 'fs' })),
    [`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/st`]: () =>
      ok(ruleset('storage\n', { fingerprint: 'st' })),
    [`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/other`]: () => {
      throw new Error('compared the wrong storage bucket')
    },
    'https://firestore.googleapis.com/v1/projects/ohsms-demo/databases/(default)/collectionGroups/-/indexes':
      () =>
        ok({
          indexes: [
            liveIndex('documents', [
              ...documents.fields,
              { fieldPath: '__name__', order: 'DESCENDING' },
            ]),
          ],
        }),
    'https://firestore.googleapis.com/v1/projects/ohsms-demo/databases/(default)': () =>
      ok({ databaseEdition: 'STANDARD' }),
  })
  const live = await fetchLiveSnapshot(PROJECT, 'token', fetchImpl, { fieldOverrides: [] })
  assert.deepEqual(seen, ['page-1', 'next'])
  assert.deepEqual(
    assess(
      {
        firestoreRules: 'firestore\n',
        storageRules: 'storage\n',
        indexes: [documents],
        fieldOverrides: [],
      },
      live
    ),
    { kind: 'match' }
  )
})

test('a rules API failure is unknown, so the caller must not skip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-live-'))
  fs.writeFileSync(
    path.join(dir, 'firebase.json'),
    JSON.stringify({
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
      storage: { rules: 'storage.rules' },
    })
  )
  fs.writeFileSync(path.join(dir, 'firestore.rules'), 'firestore\n')
  fs.writeFileSync(path.join(dir, 'storage.rules'), 'storage\n')
  fs.writeFileSync(
    path.join(dir, 'firestore.indexes.json'),
    JSON.stringify({ indexes: [], fieldOverrides: [] })
  )
  const result = await run({
    cwd: dir,
    env: { PROJECT_ID: PROJECT },
    token: 'token',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  })
  assert.equal(result.code, 1)
  assert.equal(result.line, 'unknown')
  assert.equal(result.detail.includes('token'), false)
})

test('run reports a storage difference without calling the rules compiler', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-live-'))
  fs.writeFileSync(
    path.join(dir, 'firebase.json'),
    JSON.stringify({
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
      storage: { rules: 'storage.rules' },
    })
  )
  fs.writeFileSync(path.join(dir, 'firestore.rules'), 'firestore\n')
  fs.writeFileSync(path.join(dir, 'storage.rules'), 'storage-new\n')
  fs.writeFileSync(
    path.join(dir, 'firestore.indexes.json'),
    JSON.stringify({ indexes: [documents], fieldOverrides: [] })
  )
  const fetchImpl = router({
    'https://firebaserules.googleapis.com/v1/projects/ohsms-demo/releases': () =>
      ok({
        releases: [
          {
            name: `projects/${PROJECT}/releases/cloud.firestore`,
            rulesetName: `projects/${PROJECT}/rulesets/fs`,
          },
          {
            name: `projects/${PROJECT}/releases/firebase.storage/${BUCKET}`,
            rulesetName: `projects/${PROJECT}/rulesets/st`,
          },
        ],
      }),
    'https://firebasestorage.googleapis.com/v1alpha/projects/ohsms-demo/defaultBucket': () =>
      ok({ bucket: { name: BUCKET } }),
    [`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/fs`]: () =>
      ok(ruleset('firestore\n')),
    [`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/st`]: () =>
      ok(ruleset('storage\n')),
    'https://firestore.googleapis.com/v1/projects/ohsms-demo/databases/(default)/collectionGroups/-/indexes':
      () =>
        ok({
          indexes: [
            liveIndex('documents', [
              ...documents.fields,
              { fieldPath: '__name__', order: 'DESCENDING' },
            ]),
          ],
        }),
    'https://firestore.googleapis.com/v1/projects/ohsms-demo/databases/(default)': () =>
      ok({ databaseEdition: 'STANDARD' }),
  })
  const result = await run({
    cwd: dir,
    env: { PROJECT_ID: PROJECT },
    token: 'token',
    fetchImpl,
  })
  assert.equal(result.code, 10)
  assert.equal(result.line, 'differ storage')
})
