// A real Postgres behind the interface engine.mjs was written against.
//
// The engine, fulfillment and the workers call three things on their database:
// exec(sql), query(sql, params) -> { rows, affectedRows }, and
// transaction(fn(tx)). PGlite provides those natively; this gives a pg Pool
// the same shape, so the same code runs on the embedded database in tests and
// on a managed Postgres in production.
//
// A transaction holds one pooled client from BEGIN to COMMIT. SET LOCAL ROLE
// and set_config(..., true) inside it are scoped to that transaction, which is
// what keeps one request's session uid off the next request that reuses the
// connection.

import pg from 'pg'

function wrapResult(res) {
  return { rows: res.rows, affectedRows: res.rowCount ?? 0 }
}

function runner(target) {
  return {
    async exec(sql) {
      await target.query(sql)
    },
    async query(sql, params = []) {
      return wrapResult(await target.query(sql, params))
    },
  }
}

/**
 * @param {string | import('pg').Pool} source a connection string, or a Pool
 * @param {object} [options] passed to the Pool when `source` is a string
 */
export function createPgDatabase(source, options = {}) {
  const pool =
    typeof source === 'string' ? new pg.Pool({ connectionString: source, ...options }) : source
  const direct = runner(pool)
  return {
    pool,
    exec: direct.exec,
    query: direct.query,
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(runner(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // The original error is the one worth reporting.
        }
        throw err
      } finally {
        client.release()
      }
    },
    end: () => pool.end(),
  }
}
