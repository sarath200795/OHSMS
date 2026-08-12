import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Action Tracker fans out over every module's collection, so this pins the
// contract five screens depend on: subscribeActions hands back the rows AND the
// reason they may be short, in one object.
//
// It matters more here than anywhere else in the app. The tracker's entire
// promise is that nothing outstanding is missed — an action list that is
// quietly truncated says "you are up to date" when you are not.

const listeners = {}

vi.mock('../../../shared/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: vi.fn(), updateDoc: vi.fn() }))
vi.mock('../../../shared/org/orgData', async () => {
  // The real notice builder — the wording is not what is under test here, but
  // using the real one means this breaks if the two drift apart.
  const actual = await vi.importActual('../../../shared/org/orgData.js')
    .catch(() => null)
  return {
    incompleteReadNotice: actual?.incompleteReadNotice ?? ((status) => {
      const capped = Object.keys(status).filter((k) => status[k] === 'capped')
      const failed = Object.keys(status).filter((k) => status[k] === 'failed')
      return capped.length || failed.length ? { capped, failed, message: 'incomplete' } : null
    }),
    subscribeOrgCollection: (orgId, name, cb) => {
      listeners[name] = cb
      return () => { listeners[name] = null }
    },
  }
})

const { subscribeActions, SOURCES } = await import('./sources')

// Every source's collection, deduplicated — two sources can share one.
const COLLECTIONS = [...new Set(SOURCES.map((s) => s.collection))]
const feedAll = (status = 'ok') =>
  COLLECTIONS.forEach((c) => listeners[c]?.({ rows: [], status }))

beforeEach(() => {
  Object.keys(listeners).forEach((k) => delete listeners[k])
})

describe('subscribeActions', () => {
  it('subscribes to every source collection', () => {
    subscribeActions('orgA', vi.fn())
    COLLECTIONS.forEach((c) => expect(listeners[c]).toBeTypeOf('function'))
  })

  it('always emits rows and the reason together', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    const payload = cb.mock.calls.at(-1)[0]
    expect(payload).toHaveProperty('rows')
    expect(payload).toHaveProperty('incomplete')
    expect(Array.isArray(payload.rows)).toBe(true)
  })

  it('says nothing when every source came back whole', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    expect(cb.mock.calls.at(-1)[0].incomplete).toBeNull()
  })

  it('reports a capped source', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    listeners.incidents({ rows: [], status: 'capped' })
    const { incomplete } = cb.mock.calls.at(-1)[0]
    expect(incomplete).not.toBeNull()
    expect(incomplete.capped).toContain('incidents')
  })

  // The one that used to render as "no outstanding actions".
  it('reports a failed source rather than an empty list', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    listeners.mockDrills({ rows: [], status: 'failed' })
    const { incomplete } = cb.mock.calls.at(-1)[0]
    expect(incomplete.failed).toContain('mockDrills')
  })

  it('clears the notice when a failed source recovers', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    listeners.incidents({ rows: [], status: 'failed' })
    expect(cb.mock.calls.at(-1)[0].incomplete).not.toBeNull()
    listeners.incidents({ rows: [], status: 'ok' })
    expect(cb.mock.calls.at(-1)[0].incomplete).toBeNull()
  })

  it('still flattens actions out of the rows it did get', () => {
    const cb = vi.fn()
    subscribeActions('orgA', cb)
    feedAll('ok')
    listeners.incidents({
      status: 'capped',
      rows: [{ id: 'i1', refNo: 'INC-1', capa: [{ id: 'a1', description: 'Fix it', status: 'open' }] }],
    })
    const { rows, incomplete } = cb.mock.calls.at(-1)[0]
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Fix it')
    // Truncated and still useful — the notice qualifies the list, it does not
    // replace it.
    expect(incomplete.capped).toContain('incidents')
  })

  it('unsubscribes every listener it opened', () => {
    const stop = subscribeActions('orgA', vi.fn())
    stop()
    COLLECTIONS.forEach((c) => expect(listeners[c]).toBeNull())
  })
})
