// node-postgres-shaped handle for a real Postgres server.
//
// The engine was written against PGlite's { query, exec, transaction }.
// A self-hosted stack cannot keep that embedded database: a restart would
// drop the company. This wraps postgres.js so the same engine runs against
// a persistent server. The connection string is assembled by the process
// that read the password file. It is not logged here.

import postgres from 'postgres'

function pack(result) {
  const rows = Array.isArray(result) ? result : []
  return { rows, affectedRows: Number(result?.count ?? 0) }
}

export function createPgDatabase(url) {
  if (!url) throw new Error('postgres: a database URL is required')
  const sql = postgres(url, {
    max: 10,
    // Server notices are not secrets, but they are noise on a host whose
    // logs are kept. The application errors still throw.
    onnotice: () => {},
  })

  function bind(runner) {
    return {
      query: async (text, params = []) => pack(await runner.unsafe(text, params)),
      exec: async (text) => {
        await runner.unsafe(text)
      },
    }
  }

  const db = bind(sql)
  return {
    ...db,
    transaction: (fn) => sql.begin(async (tx) => fn(bind(tx))),
    close: () => sql.end({ timeout: 5 }),
  }
}
