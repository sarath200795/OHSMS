// Registration mail. The own-database request is filed without signing in, so
// most of these are about what a stranger can make this mailbox do: mail an
// address over and over, mail it from many requests, or get a link of their
// choosing into it. The welcome path is about whose address it uses.
import { describe, it, expect } from 'vitest'
import { memoryDb, mailer } from '../test-support/memoryDb.js'
import {
  deliverProvisioningMail,
  deliverWelcomeMail,
  renderRequestReceivedMail,
  renderWelcomeMail,
  GLOBAL_PER_HOUR,
  PER_ADDRESS_PER_DAY,
} from './registrationMail.js'

const NOW = new Date('2026-11-07T10:00:00Z')
const now = () => NOW

const request = (extra = {}) => ({
  status: 'requested',
  orgName: 'Northwind Metals',
  address: 'Pune',
  contactName: 'Asha Rao',
  contactEmail: 'asha@northwind.test',
  handoffContact: 'ops@northwind.test',
  mode: 'bring',
  engine: 'postgres',
  authMethod: 'saml',
  authIssuer: 'https://idp.northwind.test/saml',
  authClientId: 'ohsms-northwind',
  bucketMode: 'bring',
  bucketName: 'northwind-ehs',
  bucketRegion: 'ap-south-1',
  presignUrl: 'https://files.northwind.test/presign',
  ...extra,
})

const OPS = [{ uid: 'ops', email: 'ops-team@weehs.test' }]

function file(db, sent, id, extra = {}, operators = OPS) {
  return deliverProvisioningMail({
    db,
    requestId: id,
    request: request(extra),
    operators,
    mailer: mailer(sent),
    now,
  })
}

describe('own-database request: what the founder receives', () => {
  it('acknowledges the request to the contact and alerts the operator', async () => {
    const db = memoryDb()
    const sent = []
    const result = await file(db, sent, 'reqAAAAAAAAAA1')
    expect(result).toEqual({ founder: 'sent', operators: 1 })
    expect(sent.map((m) => m.to)).toEqual(['asha@northwind.test', 'ops-team@weehs.test'])
    const ack = sent[0]
    expect(ack.subject).toBe('We received your request for Northwind Metals')
    expect(ack.text).toContain('reqAAAAAAAAAA1')
    expect(ack.text).toContain('Company SAML')
    expect(ack.text).toContain('ops@northwind.test will receive a separate one-time secure link')
    expect(ack.text).toContain('nothing was created and no account exists')
    expect(sent[1].text).toContain('https://suite.weehs.org/platform/provisioning')
  })

  it('carries no secret and no link to anything the filer typed', async () => {
    const message = renderRequestReceivedMail(request(), {
      requestId: 'reqAAAAAAAAAA1',
      appOrigin: 'https://suite.weehs.org',
    })
    const body = message.text + message.html
    for (const typed of [
      'https://idp.northwind.test/saml',
      'https://files.northwind.test/presign',
      'northwind-ehs',
    ]) {
      expect(body).not.toContain(typed)
    }
    expect(message.html).not.toMatch(/href="https:\/\/(?!suite\.weehs\.org)/)
  })

  it('escapes markup in the organization name', () => {
    const message = renderRequestReceivedMail(request({ orgName: '<b>Acme</b> & co' }), {
      requestId: 'r1',
    })
    expect(message.html).not.toContain('<b>Acme</b>')
    expect(message.html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; co')
  })

  it('does not mail twice when the trigger is retried', async () => {
    const db = memoryDb()
    const sent = []
    await file(db, sent, 'reqAAAAAAAAAA1')
    const again = await file(db, sent, 'reqAAAAAAAAAA1')
    expect(again).toEqual({ founder: 'skipped', operators: 0 })
    expect(sent).toHaveLength(2)
  })

  it('claims nothing when SMTP is not set, so the mail can still go once it is', async () => {
    const db = memoryDb()
    const sent = []
    const result = await deliverProvisioningMail({
      db,
      requestId: 'reqAAAAAAAAAA1',
      request: request(),
      operators: OPS,
      mailer: mailer(sent, { pass: '' }),
      now,
    })
    expect(result.reason).toBe('not-configured')
    expect(db.notifications()).toEqual([])
    expect(sent).toEqual([])
  })

  it('ignores a document that is not a fresh request', async () => {
    const sent = []
    const db = memoryDb()
    await file(db, sent, 'reqAAAAAAAAAA1', { status: 'live' })
    expect(sent).toEqual([])
  })
})

describe('own-database request: a stranger filing in someone else’s name', () => {
  it(`mails one address at most ${PER_ADDRESS_PER_DAY} times a day, however many requests name it`, async () => {
    const db = memoryDb()
    const sent = []
    for (let i = 0; i < PER_ADDRESS_PER_DAY + 4; i += 1) {
      await file(db, sent, `reqVICTIM00000${i}`, { contactEmail: 'victim@example.com' }, [])
    }
    expect(sent.filter((m) => m.to === 'victim@example.com')).toHaveLength(PER_ADDRESS_PER_DAY)
  })

  it('counts the address case-insensitively, so changing case does not reset it', async () => {
    const db = memoryDb()
    const sent = []
    const spellings = [
      'victim@example.com',
      'VICTIM@example.com',
      'Victim@Example.com',
      'vIcTiM@example.COM',
    ]
    for (const [i, contactEmail] of spellings.entries()) {
      await file(db, sent, `reqCASE0000000${i}`, { contactEmail }, [])
    }
    expect(sent).toHaveLength(PER_ADDRESS_PER_DAY)
  })

  it(`stops all acknowledgements after ${GLOBAL_PER_HOUR} in an hour`, async () => {
    const db = memoryDb()
    const sent = []
    for (let i = 0; i < GLOBAL_PER_HOUR + 5; i += 1) {
      await file(
        db,
        sent,
        `reqFLOOD${String(i).padStart(6, '0')}`,
        { contactEmail: `p${i}@example.com` },
        []
      )
    }
    expect(sent).toHaveLength(GLOBAL_PER_HOUR)
  })

  it('stores neither the address nor the request in the throttle', async () => {
    const db = memoryDb()
    await file(db, [], 'reqAAAAAAAAAA1', {}, [])
    const throttle = [...db.store.entries()].filter(([p]) => p.startsWith('mailThrottle/'))
    expect(throttle.length).toBeGreaterThan(0)
    const dump = JSON.stringify(throttle)
    expect(dump).not.toContain('asha@northwind.test')
    expect(dump).not.toContain('reqAAAAAAAAAA1')
  })

  it('records a throttled acknowledgement as failed, so a retry does not slip it through', async () => {
    const db = memoryDb()
    const sent = []
    for (let i = 0; i < PER_ADDRESS_PER_DAY; i += 1) {
      await file(db, sent, `reqFILL0000000${i}`, { contactEmail: 'victim@example.com' }, [])
    }
    const over = await file(db, sent, 'reqOVER00000001', { contactEmail: 'victim@example.com' }, [])
    expect(over.founder).toBe('failed')
    const retry = await file(
      db,
      sent,
      'reqOVER00000001',
      { contactEmail: 'victim@example.com' },
      []
    )
    expect(retry.founder).toBe('skipped')
    expect(sent).toHaveLength(PER_ADDRESS_PER_DAY)
  })

  it('caps operator alerts too, so a flood of requests does not flood the operators', async () => {
    const db = memoryDb()
    const sent = []
    for (let i = 0; i < GLOBAL_PER_HOUR + 5; i += 1) {
      await file(db, sent, `reqOPS${String(i).padStart(8, '0')}`, {
        contactEmail: `x${i}@example.com`,
      })
    }
    expect(sent.filter((m) => m.to === 'ops-team@weehs.test')).toHaveLength(GLOBAL_PER_HOUR)
  })
})

describe('WEEHS-database welcome', () => {
  const org = (extra = {}) => ({ name: 'Acme Manufacturing', createdBy: 'u-founder', ...extra })

  function welcome(db, sent, extra = {}) {
    return deliverWelcomeMail({
      db,
      orgId: 'orgA',
      org: org(extra.org),
      founderEmail: extra.founderEmail ?? 'jane@acme.test',
      founderName: 'Jane Doe',
      mailer: mailer(sent),
      now,
    })
  }

  it('welcomes the founder once, with a link to the suite', async () => {
    const db = memoryDb()
    const sent = []
    expect((await welcome(db, sent)).status).toBe('sent')
    expect((await welcome(db, sent)).status).toBe('skipped')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('jane@acme.test')
    expect(sent[0].subject).toBe('Welcome to WEEHS, Acme Manufacturing')
    expect(sent[0].text).toContain('https://suite.weehs.org/portal')
    expect(sent[0].text).toContain('Welcome, Jane Doe.')
  })

  it('does not welcome an organization created by own-stack provisioning', async () => {
    const sent = []
    await welcome(memoryDb(), sent, { org: { createdBy: 'provisioning' } })
    await welcome(memoryDb(), sent, { org: { stack: 'own' } })
    expect(sent).toEqual([])
  })

  it('sends nothing without a usable founder address', async () => {
    const sent = []
    const result = await welcome(memoryDb(), sent, { founderEmail: 'not-an-address' })
    expect(result).toEqual({ status: 'skipped', reason: 'no-email' })
    expect(sent).toEqual([])
  })

  it('escapes markup in the organization name', () => {
    const message = renderWelcomeMail({ orgName: '<img src=x>' }, {})
    expect(message.html).not.toContain('<img src=x>')
  })
})
