import { beforeEach, describe, expect, it } from 'vitest'
import { clearMetabaseCaches, queryDataset } from './metabaseRun.js'

// Stands in for DNS and for https.request. The suite must not resolve a name
// or open a socket — the assertion is that a private address never gets that far.
const miss = (code) => Object.assign(new Error(code), { code })

function dns(spec = {}) {
  const calls = []
  const read = async (name, value, fallback) => {
    calls.push(name)
    if (fallback) throw miss(fallback)
    return value
  }
  return {
    calls,
    lookup: async () =>
      read(
        'lookup',
        (spec.lookup || []).map((address) => ({
          address,
          family: String(address).includes(':') ? 6 : 4,
        }))
      ),
    resolve4: async () => read('resolve4', spec.resolve4 ?? spec.lookup ?? []),
    resolve6: async () => read('resolve6', spec.resolve6 || [], spec.resolve6 ? null : 'ENODATA'),
  }
}

function routedRequest(routes) {
  const calls = []
  const request = (options, onResponse) => {
    const route = routes.find((r) => options.path.includes(r.match))
    const hit = { path: options.path, headers: options.headers, body: null, route: route?.match || '' }
    calls.push(hit)
    const handlers = {}
    const res = {
      statusCode: route?.statusCode ?? 200,
      headers: { 'content-type': 'application/json' },
      on(ev, fn) {
        handlers[ev] = fn
        return res
      },
    }
    return {
      on() {
        return this
      },
      write(body) {
        hit.body = body
        return true
      },
      destroy() {
        return this
      },
      end() {
        onResponse(res)
        handlers.data?.(Buffer.from(route?.bodyText ?? '[]'))
        handlers.end?.()
        return this
      },
    }
  }
  return { request, calls }
}

const CARD = {
  match: '/query/json',
  bodyText: JSON.stringify([
    { 'Centre ID': 'DEMO001', 'Site Name': 'Demo North', Score: 82, 'Audit Date': '2026-03-02' },
  ]),
}

const SHAPE = {
  match: '/api/card/7',
  bodyText: JSON.stringify({
    dataset_query: { native: { query: 'select secret_column from warehouse' } },
    parameters: [
      { id: 'sd', type: 'date/single', slug: 'start', target: ['variable', ['template-tag', 'sd']] },
      { id: 'ed', type: 'date/single', slug: 'end', target: ['variable', ['template-tag', 'ed']] },
    ],
  }),
}

const config = {
  apiKey: 'mb_test_key',
  baseUrl: 'https://metabase.example.com',
  cards: { audits: 7, findings: 8 },
}

const range = { from: '2026-01-01', to: '2026-03-31' }

beforeEach(() => {
  clearMetabaseCaches()
})

describe('queryDataset', () => {
  it('refuses a private URL before any socket is opened', async () => {
    const transport = routedRequest([SHAPE, CARD])
    const result = await queryDataset(
      { ...config, baseUrl: 'https://127.0.0.1' },
      'audits',
      { orgId: 'o1', range, deps: { resolvers: dns({ lookup: ['127.0.0.1'] }), request: transport.request } }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bad-url')
    expect(transport.calls).toEqual([])
  })

  it('refuses a public name that resolves to a private address, and does not dial it', async () => {
    const transport = routedRequest([SHAPE, CARD])
    const resolvers = dns({ lookup: ['10.1.2.3'] })
    const result = await queryDataset(config, 'audits', {
      orgId: 'o1',
      range,
      deps: { resolvers, request: transport.request },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bad-url')
    expect(transport.calls).toEqual([])
    expect(resolvers.calls.length).toBeGreaterThan(0)
  })

  it('runs the saved question with the dashboard date binding and returns normalised rows', async () => {
    // Query path before the card path: '/api/card/7' is a prefix of the query URL.
    const transport = routedRequest([CARD, SHAPE])
    const result = await queryDataset(config, 'audits', {
      orgId: 'o1',
      range,
      deps: { resolvers: dns({ lookup: ['8.8.8.8'] }), request: transport.request },
    })
    expect(result.ok).toBe(true)
    expect(result.rows).toEqual([
      expect.objectContaining({
        siteId: 'DEMO001',
        site: 'Demo North',
        passPct: 82,
        auditDate: '2026-03-02',
      }),
    ])
    const post = transport.calls.find((c) => c.path.includes('/query/json'))
    expect(post.path).toBe('/api/card/7/query/json')
    expect(post.path).not.toContain('mb_test_key')
    expect(JSON.stringify(post.headers)).not.toMatch(/[?&]apiKey=/)
    expect(post.headers['x-api-key']).toBe('mb_test_key')
    const body = JSON.parse(post.body)
    expect(body.parameters.map((p) => p.value)).toEqual(['2026-01-01', '2026-03-31'])
    // The card document's SQL is not a row and not a bound parameter.
    expect(post.body).not.toContain('secret_column')
    expect(JSON.stringify(result.rows)).not.toContain('secret_column')
  })

  it('does not follow a redirect', async () => {
    const transport = routedRequest([
      { match: '/query/json', statusCode: 302, bodyText: '' },
      { match: '/api/card/7', statusCode: 302, bodyText: '' },
    ])
    const result = await queryDataset(config, 'audits', {
      orgId: 'o1',
      range,
      deps: { resolvers: dns({ lookup: ['8.8.8.8'] }), request: transport.request },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bad-url')
    expect(result.message || '').not.toMatch(/169\.254|metadata/i)
    expect(transport.calls).toHaveLength(1)
  })

  it('answers not-configured without a network call', async () => {
    const transport = routedRequest([CARD, SHAPE])
    const result = await queryDataset({}, 'audits', {
      deps: { request: transport.request, resolvers: dns({ lookup: ['8.8.8.8'] }) },
    })
    expect(result).toMatchObject({ ok: false, reason: 'not-configured' })
    expect(transport.calls).toEqual([])
  })
})
