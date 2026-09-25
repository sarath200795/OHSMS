import { describe, it, expect } from 'vitest'
import {
  weatherBucket,
  bucketFromSchedule,
  bucketWindowLabel,
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

  it('names the six-hour window the bucket already is', () => {
    expect(bucketWindowLabel('2026-09-23T06')).toBe('2026-09-23 06:00-12:00 UTC')
    expect(bucketWindowLabel('2026-09-23T18')).toBe('2026-09-23 18:00-24:00 UTC')
    expect(bucketWindowLabel('nope')).toBe('')
  })
})

describe('collectDigest', () => {
  it('keeps high and medium, drops low, and counts a failed read', async () => {
    const sites = [
      { id: 's1', name: 'Plant 2', region: 'South', entity: 'COCO', lat: 17.44, lng: 78.39 },
      { id: 's2', name: 'Depot', region: 'East', entity: 'FOFO', lat: 13.08, lng: 80.27 },
      { id: 's3', name: 'Quiet', region: 'North', lat: 28.61, lng: 77.2 },
      { id: 's4', name: 'Dark', region: 'West', lat: 19.07, lng: 72.87 },
      { id: 's5', name: 'No pin', region: 'South', entity: 'COCO' },
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
    expect(digest.areas.some((a) => a.name === 'No pin')).toBe(false)
    expect(digest.areas[0]).toMatchObject({
      entity: 'COCO',
      lat: 17.44,
      lng: 78.39,
      drivers: [{ key: 'wind', label: 'High wind', value: '50 km/h' }],
    })
    expect(digest.areas[1].drivers).toEqual([{ key: 'wind', label: 'High wind', value: '39 km/h' }])
  })
})

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('deliverWeatherDigest', () => {
  const logger = { info() {}, error() {} }

  function db() {
    return memoryDb({
      'organizations/orgA': { name: 'Acme' },
      'organizations/orgA/sites/s1': {
        name: 'Plant 2',
        region: 'South',
        entity: 'COCO',
        lat: 17.44,
        lng: 78.39,
      },
      'organizations/orgA/sites/s2': {
        name: 'Depot',
        region: 'East',
        entity: 'FOFO',
        lat: 13.08,
        lng: 80.27,
      },
      'organizations/orgA/sites/s3': { name: 'No pin', region: 'West', entity: 'COCO' },
      'users/admin': user('admin', { role: 'admin' }),
      'users/region': user('region', {
        role: 'admin',
        email: 'region@example.com',
        access: { regions: ['South'] },
      }),
      'users/aaa': user('aaa', { role: 'admin', email: 'shared@example.com' }),
      'users/mmm': user('mmm', { role: 'admin', email: 'shared@example.com' }),
      'users/member': user('member', { role: 'member', siteId: 's1' }),
      'users/manager': user('manager', {
        role: 'manager',
        access: { regions: ['South'], entities: ['COCO'], sites: ['s1'] },
      }),
      'users/suspended': user('suspended', {
        role: 'admin',
        status: 'suspended',
        email: 'off@example.com',
      }),
      'users/other': user('other', { orgId: 'orgB', role: 'admin', email: 'other@example.com' }),
    })
  }

  const mixed = async (lat) =>
    lat > 15
      ? { windKph: 55, observedAt: '2026-09-23T11:00' }
      : { windKph: 40, observedAt: '2026-09-23T11:00' }

  it('mails each admin once, attaches the map by cid, and a retry in the same window does not', async () => {
    const sent = []
    const store = db()
    const args = {
      db: store,
      mailer: mailer(sent),
      logger,
      scheduleTime: '2026-09-23T06:10:00.000Z',
      now: () => new Date('2026-09-23T09:00:00.000Z'),
      orgIds: ['orgA'],
      fetchObs: mixed,
      renderMap: async () => ({ png: PNG }),
    }
    const first = await deliverWeatherDigest(args)
    expect(first.sent).toBe(3)
    expect(first.bucket).toBe('2026-09-23T06')
    expect(sent.map((m) => m.to).sort()).toEqual([
      'admin@example.com',
      'region@example.com',
      'shared@example.com',
    ])
    const blob = sent.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join('\n')
    expect(blob.indexOf('High risk')).toBeGreaterThan(-1)
    expect(blob.indexOf('High risk')).toBeLessThan(blob.indexOf('Medium risk'))
    expect(blob).toContain('South')
    expect(blob).toContain('Plant 2')
    expect(blob).toContain('COCO')
    expect(blob).toContain('55 km/h')
    expect(blob).toContain('East')
    expect(blob).toContain('Depot')
    expect(blob).toContain('2026-09-23T11:00')
    expect(blob).toContain('2026-09-23 06:00-12:00 UTC')
    expect(blob).toContain('https://suite.weehs.org/weather')
    expect(blob).toContain('src="cid:weather-risk-map"')
    expect(blob).toContain('Sent by Acme')
    expect(sent[0].senderName).toBe('Acme')
    expect(sent[0].attachments).toEqual([
      { filename: 'weather-risk-map.png', content: PNG, cid: 'weather-risk-map' },
    ])
    expect(blob).not.toContain('WEEHS')
    expect(blob).not.toContain('17.44')
    expect(blob).not.toContain('No pin')
    expect(blob).not.toContain('member@example.com')
    expect(blob).not.toContain('off@example.com')
    const second = await deliverWeatherDigest({ ...args, mailer: mailer(sent) })
    expect(second.sent).toBe(0)
    expect(sent).toHaveLength(3)
  })

  it('still sends the tables when the map cannot be drawn', async () => {
    const sent = []
    const errors = []
    await deliverWeatherDigest({
      db: db(),
      mailer: mailer(sent),
      logger: {
        info() {},
        error(_msg, extra) {
          errors.push(extra)
        },
      },
      scheduleTime: '2026-09-23T06:00:00.000Z',
      orgIds: ['orgA'],
      fetchObs: mixed,
      renderMap: async () => {
        throw new Error('tiles down')
      },
    })
    expect(sent).toHaveLength(3)
    expect(sent[0].html).not.toContain('cid:')
    expect(sent[0].attachments).toEqual([])
    expect(sent[0].text).toContain('Plant 2')
    expect(errors.some((extra) => extra?.error === 'tiles down')).toBe(true)
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
    let mapped = false
    await deliverWeatherDigest({
      db: calm,
      mailer: mailer(sent),
      logger,
      scheduleTime: '2026-09-23T00:00:00.000Z',
      orgIds: ['orgA'],
      fetchObs: async () => ({ windKph: 10, apparentTempC: 30 }),
      renderMap: async () => {
        mapped = true
        return { png: PNG }
      },
    })
    expect(sent).toHaveLength(0)
    expect(calm.notifications()).toHaveLength(0)
    expect(mapped).toBe(false)
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
