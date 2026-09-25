import { describe, it, expect } from 'vitest'
import {
  weatherBucket,
  bucketFromSchedule,
  bucketWindowLabel,
  collectDigest,
  deliverWeatherDigest,
  DIGEST_FALLBACK_MS,
  slotStartMs,
} from './weatherDigest.js'
import { renderWeatherDigest } from './mailTemplates/lifecycle.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

describe('six-hour bucket', () => {
  it('gives each Asia/Kolkata slot its own key', () => {
    // 00:00, 06:00, 12:00, 18:00 IST are 18:30 the previous UTC date, then 00:30, 06:30, 12:30.
    expect(weatherBucket(new Date('2026-09-25T18:30:00.000Z'))).toBe('2026-09-26T00+0530')
    expect(weatherBucket(new Date('2026-09-26T00:30:00.000Z'))).toBe('2026-09-26T06+0530')
    expect(weatherBucket(new Date('2026-09-26T06:30:00.000Z'))).toBe('2026-09-26T12+0530')
    expect(weatherBucket(new Date('2026-09-26T12:30:00.000Z'))).toBe('2026-09-26T18+0530')
    const keys = [
      weatherBucket(new Date('2026-09-25T18:30:00.000Z')),
      weatherBucket(new Date('2026-09-26T00:30:00.000Z')),
      weatherBucket(new Date('2026-09-26T06:30:00.000Z')),
      weatherBucket(new Date('2026-09-26T12:30:00.000Z')),
    ]
    expect(new Set(keys).size).toBe(4)
  })

  it('keeps midnight IST distinct from the old 23:30 IST instant', () => {
    // 23:30 IST is 18:00 UTC. The following midnight is 18:30 UTC the same UTC date.
    expect(weatherBucket(new Date('2026-09-25T18:00:00.000Z'))).toBe('2026-09-25T18+0530')
    expect(weatherBucket(new Date('2026-09-25T18:30:00.000Z'))).toBe('2026-09-26T00+0530')
  })

  it('rolls the civil date at midnight IST, including across a month', () => {
    expect(weatherBucket(new Date('2026-09-30T18:29:00.000Z'))).toBe('2026-09-30T18+0530')
    expect(weatherBucket(new Date('2026-09-30T18:30:00.000Z'))).toBe('2026-10-01T00+0530')
  })

  it('keys a late retry off the scheduled slot, not the window now open', () => {
    const late = new Date('2026-09-26T07:10:00.000Z') // 12:40 IST
    expect(bucketFromSchedule('2026-09-26T00:30:00.000Z', late)).toBe('2026-09-26T06+0530')
  })

  it('does not let a forced run claim the next slot', () => {
    // 15:16 IST. The next cron instant is 18:00 IST (12:30Z).
    const now = new Date('2026-09-25T09:46:00.000Z')
    expect(bucketFromSchedule('2026-09-25T12:30:00.000Z', now)).toBe('2026-09-25T12+0530')
    expect(weatherBucket(new Date('2026-09-25T12:30:00.000Z'))).toBe('2026-09-25T18+0530')
  })

  it('still uses a scheduleTime only a few seconds ahead', () => {
    const now = new Date('2026-09-25T12:29:40.000Z') // 20s before 18:00 IST
    expect(bucketFromSchedule('2026-09-25T12:30:00.000Z', now)).toBe('2026-09-25T18+0530')
  })

  it('treats two minutes early as the window already open', () => {
    const now = new Date('2026-09-25T12:28:00.000Z') // 2 min before 18:00 IST
    expect(bucketFromSchedule('2026-09-25T12:30:00.000Z', now)).toBe('2026-09-25T12+0530')
  })

  it('floors the clock when there is no schedule time', () => {
    const now = new Date('2026-09-25T09:46:00.000Z') // 15:16 IST
    expect(bucketFromSchedule('', now)).toBe('2026-09-25T12+0530')
    expect(bucketFromSchedule('not-a-date', now)).toBe('2026-09-25T12+0530')
  })

  it('names the six-hour IST window the bucket already is', () => {
    expect(bucketWindowLabel('2026-09-23T06+0530')).toBe('2026-09-23 06:00-12:00 IST')
    expect(bucketWindowLabel('2026-09-23T00+0530')).toBe('2026-09-23 00:00-06:00 IST')
    expect(bucketWindowLabel('2026-09-23T18+0530')).toBe('2026-09-23 18:00-24:00 IST')
    expect(bucketWindowLabel('2026-09-23T06')).toBe('')
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
    expect(digest.unlocated).toBe(1)
    expect(digest.located).toBe(4)
    expect(digest.checked).toBe(3)
    expect(digest.complete).toBe(false)
  })

  it('reads every grid, and the risk count is not the table cap', async () => {
    const sites = Array.from({ length: 90 }, (_, i) => ({
      id: `s${i}`,
      name: `Site ${i}`,
      region: 'South',
      lat: 10 + Math.floor(i / 50),
      lng: 70 + (i % 50) * 0.05,
    }))
    const seen = []
    const digest = await collectDigest(sites, async (lat, lng) => {
      seen.push(`${lat},${lng}`)
      return { windKph: 55 }
    })
    expect(new Set(seen).size).toBe(90)
    expect(digest.located).toBe(90)
    expect(digest.unread).toBe(0)
    expect(digest.checked).toBe(90)
    expect(digest.areas).toHaveLength(90)
    const message = renderWeatherDigest(digest)
    expect(message.subject).toBe('Weather risk: 90 high, 0 medium')
    expect(message.text).toContain('Weather checked for 90 of 90 sites')
    expect(message.text).toContain('50 further areas are in the app')
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
      scheduleTime: '2026-09-23T00:40:00.000Z',
      now: () => new Date('2026-09-23T01:30:00.000Z'),
      orgIds: ['orgA'],
      fetchObs: mixed,
      renderMap: async () => ({ png: PNG }),
    }
    const first = await deliverWeatherDigest(args)
    expect(first.sent).toBe(3)
    expect(first.bucket).toBe('2026-09-23T06+0530')
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
    expect(blob).toContain('2026-09-23 06:00-12:00 IST')
    expect(blob).toContain('Weather checked for 2 of 2 sites')
    expect(blob).toContain('1 site has no usable coordinates and was not checked')
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
      // 00:05 IST, still inside the first 50 minutes, so a total miss waits.
      scheduleTime: '2026-09-22T18:35:00.000Z',
      now: () => new Date('2026-09-22T18:35:00.000Z'),
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

  it('holds the mail while a site is unread, then sends once that site arrives', async () => {
    const sent = []
    const store = db()
    const asked = []
    const slot = '2026-09-22T18:35:00.000Z'
    let depotTries = 0
    const args = {
      db: store,
      mailer: mailer(sent),
      logger,
      scheduleTime: slot,
      now: () => new Date(slot),
      orgIds: ['orgA'],
      fetchObs: async (lat) => {
        asked.push(Number(lat.toFixed(2)))
        if (lat < 15) {
          depotTries += 1
          if (depotTries === 1) return null
        }
        return lat > 15
          ? { windKph: 55, observedAt: '2026-09-23T01:00' }
          : { windKph: 40, observedAt: '2026-09-23T01:00' }
      },
      renderMap: async () => ({ png: PNG }),
    }
    const held = await deliverWeatherDigest(args)
    expect(held.sent).toBe(0)
    expect(sent).toHaveLength(0)
    expect(store.notifications()).toHaveLength(0)
    const progress = store.store.get(`organizations/orgA/weatherDigestRuns/${held.bucket}`)
    expect(progress.status).toBe('open')
    expect(progress.observations.map((row) => row.key)).toEqual(['17.44,78.39'])

    asked.length = 0
    const released = await deliverWeatherDigest({ ...args, mailer: mailer(sent) })
    expect(released.sent).toBe(3)
    expect(asked).toEqual([13.08])
    expect(sent[0].text).toContain('Weather checked for 2 of 2 sites')
    expect(sent[0].text).not.toContain('Could not fetch')
  })

  it('mails the partial picture 50 minutes into the slot, once, and names the gaps', async () => {
    const sent = []
    const store = db()
    const start = slotStartMs('2026-09-23T00+0530')
    const early = new Date(start + 5 * 60 * 1000)
    const late = new Date(start + DIGEST_FALLBACK_MS)
    let fetches = 0
    const args = {
      db: store,
      mailer: mailer(sent),
      logger,
      orgIds: ['orgA'],
      renderMap: async () => ({ png: PNG }),
      fetchObs: async (lat) => {
        fetches += 1
        if (lat < 15) return null
        return { windKph: 55, observedAt: '2026-09-23T01:00' }
      },
    }
    const held = await deliverWeatherDigest({
      ...args,
      scheduleTime: early.toISOString(),
      now: () => early,
    })
    expect(held.sent).toBe(0)
    expect(sent).toHaveLength(0)
    const fetchesBeforeFallback = fetches

    const mailed = await deliverWeatherDigest({
      ...args,
      mailer: mailer(sent),
      scheduleTime: late.toISOString(),
      now: () => late,
    })
    expect(mailed.sent).toBe(3)
    expect(sent).toHaveLength(3)
    expect(sent[0].text).toContain('Weather checked for 1 of 2 sites')
    expect(sent[0].text).toContain('Could not fetch weather for 1 site: Depot')
    expect(sent[0].text).toContain('This is not an all-clear for them')
    expect(sent[0].subject).toBe('Weather risk: 1 high, 0 medium')
    expect(fetches).toBeGreaterThan(fetchesBeforeFallback)

    fetches = 0
    const again = await deliverWeatherDigest({
      ...args,
      mailer: mailer(sent),
      scheduleTime: late.toISOString(),
      now: () => new Date(late.getTime() + 60 * 1000),
      fetchObs: async () => {
        fetches += 1
        return { windKph: 80 }
      },
    })
    expect(again.sent).toBe(0)
    expect(sent).toHaveLength(3)
    expect(fetches).toBe(0)
  })

  it('still mails when every read is still failing at the fallback', async () => {
    const sent = []
    const start = slotStartMs('2026-09-23T00+0530')
    const late = new Date(start + DIGEST_FALLBACK_MS)
    await deliverWeatherDigest({
      db: db(),
      mailer: mailer(sent),
      logger,
      scheduleTime: late.toISOString(),
      now: () => late,
      orgIds: ['orgA'],
      fetchObs: async () => null,
      renderMap: async () => ({ png: PNG }),
    })
    expect(sent).toHaveLength(3)
    expect(sent[0].text).toContain('Weather checked for 0 of 2 sites')
    expect(sent[0].text).toContain('Depot')
    expect(sent[0].text).toContain('Plant 2')
    expect(sent[0].text).toContain('This is not an all-clear for them')
    expect(sent[0].text).not.toContain('High risk')
  })
})
