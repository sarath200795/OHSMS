import { describe, it, expect } from 'vitest'
import { notificationId, isAlreadyExists, sendOnce } from './notify.js'

const NOW = new Date('2026-01-04T09:00:00Z')

function memoryRef(store, path) {
  return {
    path,
    async create(data) {
      if (store.has(path)) {
        const err = new Error('already exists')
        err.code = 6
        throw err
      }
      store.set(path, { ...data })
    },
    async update(patch) {
      store.set(path, { ...store.get(path), ...patch })
    },
    async get() {
      const data = store.get(path)
      return { exists: data !== undefined, data: () => data }
    },
    async delete() {
      store.delete(path)
    },
  }
}

describe('notificationId', () => {
  it('is stable and does not depend on being called twice', () => {
    const key = ['orgA', 'incidents', 'i1', 'a1', 'u1', 'evt-1']
    expect(notificationId(key)).toBe(notificationId(key))
    expect(notificationId(key)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the assignee changes, so a reassignment is a new claim', () => {
    const base = ['orgA', 'incidents', 'i1', 'a1']
    expect(notificationId([...base, 'u1', 'evt-1'])).not.toBe(
      notificationId([...base, 'u2', 'evt-1'])
    )
  })

  it('changes when the event changes, so assigning the same person again can send', () => {
    const base = ['orgA', 'incidents', 'i1', 'a1', 'u1']
    expect(notificationId([...base, 'evt-1'])).not.toBe(notificationId([...base, 'evt-2']))
  })
})

describe('isAlreadyExists', () => {
  it('recognises both forms the Admin SDK reports', () => {
    expect(isAlreadyExists({ code: 6 })).toBe(true)
    expect(isAlreadyExists({ code: 'already-exists' })).toBe(true)
    expect(isAlreadyExists({ code: 'ALREADY_EXISTS' })).toBe(true)
    expect(isAlreadyExists({ code: 'unavailable' })).toBe(false)
    expect(isAlreadyExists(null)).toBe(false)
  })
})

describe('sendOnce', () => {
  it('claims the row the rules test describes, then sends, then marks it sent', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    const sent = []
    const result = await sendOnce({
      ref,
      kind: 'assignment.incident_capa',
      key: ['orgA', 'incidents', 'i1', 'a1', 'u1', 'evt-1'],
      uid: 'u1',
      subject: 'Assigned: Fix the guard (IRA-1)',
      now: NOW,
      send: async () => {
        // The claim has to exist before the send. A retry that lands in
        // between the two is how a mail goes out twice.
        expect(store.get(ref.path)).toMatchObject({ status: 'claimed', uid: 'u1' })
        sent.push('mail')
      },
    })

    expect(result).toEqual({ status: 'sent' })
    expect(sent).toEqual(['mail'])
    const row = store.get(ref.path)
    expect(row).toMatchObject({
      kind: 'assignment.incident_capa',
      uid: 'u1',
      subject: 'Assigned: Fix the guard (IRA-1)',
      status: 'sent',
      claimedAt: NOW,
    })
    expect(row.expiresAt.getTime() - NOW.getTime()).toBe(30 * 24 * 60 * 60 * 1000)
    // The claim is the document the second call sees. The send must not have
    // happened before the row existed — a retry in that window is the duplicate.
    expect(row.key).toEqual(['orgA', 'incidents', 'i1', 'a1', 'u1', 'evt-1'])
  })

  it('does not send when the claim is already there', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    store.set(ref.path, { status: 'sent' })
    let sends = 0
    const result = await sendOnce({
      ref,
      kind: 'assignment.incident_capa',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        sends += 1
      },
    })
    expect(result).toEqual({ status: 'skipped', reason: 'already-claimed' })
    expect(sends).toBe(0)
    expect(store.get(ref.path).status).toBe('sent')
  })

  it('records a failed send and does not throw, so the trigger does not retry into a second attempt that the claim would then skip', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    const result = await sendOnce({
      ref,
      kind: 'assignment.training',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        throw new Error('smtp down')
      },
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('send-failed')
    expect(result.error.message).toBe('smtp down')
    expect(store.get(ref.path).status).toBe('failed')
  })

  it('releases a rate-limit refusal so the same key can send later', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    const limited = Object.assign(
      new Error('554 5.7.1 Reject: too many messages from sender in last 60 minutes'),
      { responseCode: 554, response: '554 5.7.1 Reject: too many messages' }
    )
    const first = await sendOnce({
      ref,
      kind: 'permit.lifecycle',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        throw limited
      },
    })
    expect(first.reason).toBe('rate-limited')
    expect(store.has(ref.path)).toBe(false)

    const sent = []
    const second = await sendOnce({
      ref,
      kind: 'permit.lifecycle',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        sent.push('mail')
      },
    })
    expect(second.status).toBe('sent')
    expect(sent).toEqual(['mail'])
    expect(store.get(ref.path).status).toBe('sent')
  })

  it('releases a Brevo quota refusal so the same key can send later', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    const limited = Object.assign(
      new Error('554 5.7.1 You have exceeded your daily sending limit'),
      {
        responseCode: 554,
        response: '554 5.7.1 daily limit exceeded',
      }
    )
    const result = await sendOnce({
      ref,
      kind: 'defect.reported',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        throw limited
      },
    })
    expect(result.reason).toBe('rate-limited')
    expect(store.has(ref.path)).toBe(false)
  })

  it('keeps a 554 that is not a rate limit, so a permanent reject is not retried', async () => {
    const store = new Map()
    const ref = memoryRef(store, 'organizations/orgA/notifications/abc')
    const result = await sendOnce({
      ref,
      kind: 'permit.lifecycle',
      key: ['k'],
      uid: 'u1',
      subject: 's',
      now: NOW,
      send: async () => {
        const err = new Error('554 5.7.1 mailbox unavailable')
        err.responseCode = 554
        throw err
      },
    })
    expect(result.reason).toBe('send-failed')
    expect(store.get(ref.path).status).toBe('failed')
  })

  it('rethrows when the claim itself cannot be written', async () => {
    const ref = {
      async create() {
        const err = new Error('unavailable')
        err.code = 'unavailable'
        throw err
      },
      async update() {},
    }
    await expect(
      sendOnce({
        ref,
        kind: 'k',
        key: ['k'],
        uid: 'u1',
        subject: 's',
        now: NOW,
        send: async () => {},
      })
    ).rejects.toThrow('unavailable')
  })
})
