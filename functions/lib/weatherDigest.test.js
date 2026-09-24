import { describe, it, expect } from 'vitest'
import {
  weatherBucket,
  bucketFromSchedule,
  collectDigest,
  deliverWeatherDigest,
} from './weatherDigest.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

describe('six-hour bucket', () => {
  it('groups a window, and the next window is a new key', () => {
    expect(weatherBucket(new Date('2026-09-23T00:30:00.000Z'))).toBe('2026-09-23T00')
    expect(weatherBucket(new Date('2026-09-23T05:59:00.000Z'))).toBe('2026-09-23T00')
    expect(weatherBucket(new Date('2026-09-23T06:00:00.000Z'))).toBe('2026-09-23T06')
  })

  it('keys off the scheduled instant, not the clock a retry happens to run on', () => {
    const late = new Date('2026-09-23T07:40:00.000Z')
    expect(bucketFromSchedule('2026-09-23T06:00:00.000Z', late)).toBe('2026-09-23T06')
  })
})

describe('collectDigest', () => {
  it('keeps high and medium, drops low, and counts a failed read', async () => {
    const sites = [
      { id: 's1', name: 'Plant 2', region: 'South', lat: 17.44, lng: 78.39 },
      { id: 's2', name: 'Depot', region: 'East', lat: 13.08, lng: 80.27 },
      { id: 's3', name: 'Quiet', region: 'North', lat: 28.61, lng: 77.2 },
      { id: 's4', name: 'Dark', region: 'West', lat: 19.07, lng: 72.87 },
      { id: 's5', name: 'No pin', region: 'South' },
    ]
    const byLat = {
      17.44: { windKph: 50 },
      13.08: { windKph: 39 },
      28.61: { windKph: 20 },
    }
    const digest = await collectDigest(sites, async (lat) => byLat[lat.toFixed(2)] || null)
    expect(digest.areas.map((a) => `${a.region}:${a.name}:${a.level}`)).toEqual([
      'South:Plant 2:High',
      'East:Depot:Medium',
    ])
    expect(digest.unread).toBe(1)
    expect(digest.areas.some((a) => a.name === 'Quiet')).toBe(false)
  })
})

describe('deliverWeatherDigest', () => {
  const logger = { info() {}, error() {} }

  function db() {
    return memoryDb({
      'organizations/orgA': { name: 'Acme' },
      'organizations/orgA/sites/s1': { name: 'Plant 2', region: 'South', lat: 17.44, lng: 78.39 },
      'organizations/orgA/sites/s2': { name: 'Depot', region: 'East', lat: 13.08, lng: 80.27 },
      'users/admin': user('admin', { role: 'admin' }),
      'users/member': user('member', { role: 'member' }),
      'users/suspended': user('suspended', {
        role: 'member',
        status: 'suspended',
        email: 'off@example.com',
      }),
      'users/other': user('other', { orgId: 'orgB', email: 'other@example.com' }),
    })
  }

  const high = async (lat) => (lat > 15 ? { windKph: 55 } : { windKph: 10 })

  it('mails every active member of the org, not another tenant, and a retry in the same window does not', async () => {
    const sent = []
    const store = db()
    const args = {
      db: store,
      mailer: mailer(sent),
      logger,
      scheduleTime: '2026-09-23T06:10:00.000Z',
      now: () => new Date('2026-09-23T09:00:00.000Z'),
      orgIds: ['orgA'],
      fetchObs: high,
    }
    const first = await deliverWeatherDigest(args)
    expect(first.sent).toBe(2)
    expect(first.bucket).toBe('2026-09-23T06')
    expect(sent.map((m) => m.to).sort()).toEqual(['admin@example.com', 'member@example.com'])
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob).toContain('South: Plant 2 — High')
    expect(blob).toContain('https://suite.weehs.org/weather')
    expect(blob).toContain('Sent by Acme')
    expect(sent[0].senderName).toBe('Acme')
    expect(blob).not.toContain('WEEHS')
    expect(blob).not.toContain('17.44')
    expect(blob).not.toContain('Quiet')
    expect(blob).not.toContain('off@example.com')
    const second = await deliverWeatherDigest({ ...args, mailer: mailer(sent) })
    expect(second.sent).toBe(0)
    expect(sent).toHaveLength(2)
  })

  it('does not send or claim when every read fails, or when nothing is elevated', async () => {
    const sent = []
    const failed = db()
    const none = await deliverWeatherDigest({
      db: failed,
      mailer: mailer(sent),
      logger,
      scheduleTime: '2026-09-23T00:00:00.000Z',
      orgIds: ['orgA'],
      fetchObs: async () => null,
    })
    expect(none.sent).toBe(0)
    expect(sent).toHaveLength(0)
    expect(failed.notifications()).toHaveLength(0)

    const calm = db()
    await deliverWeatherDigest({
      db: calm,
      mailer: mailer(sent),
      logger,
      scheduleTime: '2026-09-23T00:00:00.000Z',
      orgIds: ['orgA'],
      fetchObs: async () => ({ windKph: 10, apparentTempC: 30 }),
    })
    expect(sent).toHaveLength(0)
    expect(calm.notifications()).toHaveLength(0)
  })

  it('does not call the weather service when mail is not configured', async () => {
    let called = false
    const result = await deliverWeatherDigest({
      db: db(),
      mailer: mailer([], { pass: '' }),
      logger,
      scheduleTime: '2026-09-23T12:00:00.000Z',
      orgIds: ['orgA'],
      fetchObs: async () => {
        called = true
        return { windKph: 80 }
      },
    })
    expect(result.reason).toBe('not-configured')
    expect(called).toBe(false)
  })
})
