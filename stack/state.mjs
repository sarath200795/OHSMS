// What the control plane must remember across a restart.
//
// stack/server.mjs keeps the provisioning requests, the one-time intake slots
// and the company's sign-in configuration in Maps and a variable. That was
// enough for the demo and is not enough for a deployment: a redeploy or a
// Cloud Run instance replacement would forget the request, consume nobody's
// token, and drop the secrets a company had just submitted — after which the
// company could not sign in and the handoff link could not be sent again.
//
// This keeps them in one table on the same Postgres, write-through. The server
// still reads its Maps synchronously; every set and delete is queued to the
// database, and the server awaits flush() at the points where losing a write
// would matter (before a handoff link is mailed, before fulfillment runs).
//
// Secrets are sealed before they reach the table: AES-256-GCM under STATE_KEY,
// with the row's kind and id as associated data so a sealed value cannot be
// moved onto another row. A database dump without the key does not contain
// the database URL, DATA_KEY_MASTER, the IdP certificate or the token hash.
//
// The table is owned by the login role and granted to neither ohsms_browser
// nor ohsms_worker, so the data API — which always runs as one of those —
// cannot read it.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const STATE_SQL = `
CREATE TABLE IF NOT EXISTS control_state (
  kind text NOT NULL,
  id text NOT NULL,
  data jsonb,
  sealed text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
REVOKE ALL ON control_state FROM PUBLIC;
`

// Rows of these kinds hold secrets and are stored sealed, whole.
const SEALED_KINDS = new Set(['intake', 'auth'])

/** STATE_KEY: 32 random bytes, base64. Anything else refuses to start. */
export function parseStateKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64')
  if (key.length !== 32) {
    throw new Error('STATE_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)')
  }
  return key
}

export function seal(key, aad, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function unseal(key, aad, sealed) {
  const raw = Buffer.from(sealed, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(raw.subarray(12, 28))
  const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  return JSON.parse(text)
}

/**
 * A Map whose writes are queued to the database. Reads stay synchronous,
 * which is what the server's handlers already do. `flush()` resolves once
 * every queued write has landed, and rejects with the first that failed.
 */
export class PersistentMap extends Map {
  #write
  #remove
  #tail = Promise.resolve()
  #failure = null

  constructor(entries, { write, remove }) {
    // Loaded rows go in with Map's own set: they are already stored, and the
    // private fields this class's set() reads do not exist until super returns.
    super()
    for (const [key, value] of entries || []) super.set(key, value)
    this.#write = write
    this.#remove = remove
  }

  #queue(job) {
    this.#tail = this.#tail.then(job).catch((err) => {
      this.#failure ||= err
    })
  }

  set(key, value) {
    super.set(key, value)
    this.#queue(() => this.#write(key, value))
    return this
  }

  delete(key) {
    const had = super.delete(key)
    if (had) this.#queue(() => this.#remove(key))
    return had
  }

  async flush() {
    await this.#tail
    if (this.#failure) {
      const err = this.#failure
      this.#failure = null
      throw err
    }
  }
}

/**
 * Open (and create) the state table on `db` and load what it holds.
 * @returns {{ requests: PersistentMap, intake: PersistentMap, auth: object|null,
 *             saveAuth(auth): Promise<void> }}
 */
export async function openState(db, { key }) {
  await db.exec(STATE_SQL)

  async function put(kind, id, value) {
    const aad = `${kind}:${id}`
    const sealedKind = SEALED_KINDS.has(kind)
    await db.query(
      `INSERT INTO control_state (kind, id, data, sealed, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (kind, id) DO UPDATE
         SET data = EXCLUDED.data, sealed = EXCLUDED.sealed, updated_at = now()`,
      [
        kind,
        id,
        sealedKind ? null : JSON.stringify(value),
        sealedKind ? seal(key, aad, value) : null,
      ]
    )
  }

  async function drop(kind, id) {
    await db.query('DELETE FROM control_state WHERE kind = $1 AND id = $2', [kind, id])
  }

  const rows = (await db.query('SELECT kind, id, data, sealed FROM control_state')).rows
  const loaded = { request: [], intake: [], auth: null }
  for (const row of rows) {
    // A wrong STATE_KEY throws here, at start-up, rather than serving a host
    // that has silently forgotten every company's secrets.
    const value = row.sealed ? unseal(key, `${row.kind}:${row.id}`, row.sealed) : row.data
    if (row.kind === 'request') loaded.request.push([row.id, value])
    else if (row.kind === 'intake') loaded.intake.push([row.id, value])
    else if (row.kind === 'auth' && row.id === 'current') loaded.auth = value
  }

  return {
    requests: new PersistentMap(loaded.request, {
      write: (id, value) => put('request', id, value),
      remove: (id) => drop('request', id),
    }),
    intake: new PersistentMap(loaded.intake, {
      write: (id, value) => put('intake', id, value),
      remove: (id) => drop('intake', id),
    }),
    auth: loaded.auth,
    saveAuth: (auth) => put('auth', 'current', auth),
  }
}
