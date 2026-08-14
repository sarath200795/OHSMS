import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMailer, MailError } from './email.js'

// Capture what actually goes on the wire, because that is the only place the
// sanitisation can be proved — everything above it still holds the raw string.
let sent

function mockFetch(response = { ok: true, body: { id: 'msg_1' } }) {
  return vi.fn(async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) }
    return {
      ok: response.ok,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
      headers: { get: () => 'sg_1' },
    }
  })
}

const mailer = () => createMailer({ provider: 'resend', apiKey: 'test-key', from: 'a@b.test' })

beforeEach(() => {
  sent = null
  global.fetch = mockFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('header safety', () => {
  // The actual attack: a record title carrying a newline and a second header.
  // If the subject reached an SMTP transport intact, everything after the CRLF
  // would be parsed as headers rather than as part of the subject.
  it('collapses CRLF injected through a record title', async () => {
    await mailer().send({
      to: 'x@y.test',
      subject: 'Action assigned: Fix pump\r\nBcc: attacker@evil.test',
      text: 'body',
    })
    expect(sent.body.subject).toBe('Action assigned: Fix pump Bcc: attacker@evil.test')
    expect(sent.body.subject).not.toMatch(/[\r\n]/)
  })

  it('collapses a bare newline too', async () => {
    await mailer().send({ to: 'x@y.test', subject: 'One\nTwo', text: 'b' })
    expect(sent.body.subject).toBe('One Two')
  })

  it('collapses a run of breaks into a single space', async () => {
    await mailer().send({ to: 'x@y.test', subject: 'One\r\n\r\n\nTwo', text: 'b' })
    expect(sent.body.subject).toBe('One Two')
  })

  it('leaves an ordinary subject untouched', async () => {
    const clean = 'Permit PTW-0042 expires in 3 days'
    await mailer().send({ to: 'x@y.test', subject: clean, text: 'b' })
    expect(sent.body.subject).toBe(clean)
  })

  // Sanitising before the emptiness check is what makes this case reachable:
  // a subject of nothing but breaks must be refused, not sent blank.
  it('refuses a subject that is only line breaks', async () => {
    await expect(mailer().send({ to: 'x@y.test', subject: '\r\n\n', text: 'b' })).rejects.toThrow(
      MailError
    )
    expect(sent).toBeNull()
  })

  it('still refuses a missing subject', async () => {
    await expect(mailer().send({ to: 'x@y.test', text: 'b' })).rejects.toThrow(/no subject/i)
  })

  it('sanitises replyTo, which is also a header', async () => {
    await mailer().send({
      to: 'x@y.test',
      subject: 'Hello',
      text: 'b',
      replyTo: 'ok@y.test\r\nBcc: attacker@evil.test',
    })
    expect(sent.body.reply_to).toBe('ok@y.test Bcc: attacker@evil.test')
    expect(sent.body.reply_to).not.toMatch(/[\r\n]/)
  })

  // An absent replyTo must stay absent rather than becoming an empty header.
  it('omits reply_to entirely when none is configured', async () => {
    await mailer().send({ to: 'x@y.test', subject: 'Hello', text: 'b' })
    expect('reply_to' in sent.body).toBe(false)
  })
})

describe('send contract', () => {
  it('sends nothing when there is no recipient', async () => {
    const res = await mailer().send({ to: [], subject: 'Hello', text: 'b' })
    expect(res).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports a 4xx as non-retryable and a 5xx as retryable', async () => {
    global.fetch = mockFetch({ ok: false, status: 422, body: { message: 'bad address' } })
    await expect(mailer().send({ to: 'x@y.test', subject: 'S', text: 'b' })).rejects.toMatchObject({
      retryable: false,
    })

    global.fetch = mockFetch({ ok: false, status: 503, body: { message: 'down' } })
    await expect(mailer().send({ to: 'x@y.test', subject: 'S', text: 'b' })).rejects.toMatchObject({
      retryable: true,
    })
  })

  // A provider named but not credentialed falls back to console rather than
  // throwing, so a missing key never silently drops a safety notification.
  it('falls back to console output when the provider has no key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const m = createMailer({ provider: 'resend' })
    expect(m.provider).toBe('console')
    await m.send({ to: 'x@y.test', subject: 'Hello', text: 'b' })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalled()
  })

  it('sanitises the subject on the dryRun path as well', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const m = createMailer({ provider: 'resend', apiKey: 'k', dryRun: true })
    const id = await m.send({ to: 'x@y.test', subject: 'One\r\nTwo', text: 'b' })
    expect(global.fetch).not.toHaveBeenCalled()
    // The id is the only place the collapsed subject survives now — the dry run
    // reports the attempt without reproducing what was in it.
    expect(id).toContain('One Two')
    expect(info.mock.calls[0][0]).not.toContain('One Two')
  })

  it('rejects an unknown provider by name', () => {
    expect(() => createMailer({ provider: 'pigeon' })).toThrow(/pigeon/)
  })
})

// Nothing here is hypothetical: with no MAIL_PROVIDER set, this project sends
// every notification through the console provider, so whatever it writes is
// what platform operators can read in Cloud Logging.
describe('what the console provider writes to the log', () => {
  let info

  // An incident notification, which is the worst thing this path can be handed.
  const incident = {
    to: ['nurse@acme.test', 'hse@acme.test'],
    subject: 'Incident reported — chemical burn, Ravi Kumar',
    text: 'Ravi Kumar was treated on site for a chemical burn to the left forearm.',
  }

  const logged = () => info.mock.calls.map((c) => c.join(' ')).join('\n')

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    delete process.env.MAIL_LOG_BODY
  })

  afterEach(() => {
    delete process.env.MAIL_LOG_BODY
  })

  it('counts the recipients instead of naming them', async () => {
    await createMailer({}).send(incident)
    expect(logged()).toMatch(/recipients=2\b/)
    expect(logged()).not.toContain('nurse@acme.test')
    expect(logged()).not.toContain('hse@acme.test')
  })

  it('measures the subject and the body rather than reproducing them', async () => {
    await createMailer({}).send(incident)
    expect(logged()).not.toContain('Ravi Kumar')
    expect(logged()).not.toContain('chemical burn')
    expect(logged()).toMatch(new RegExp(`subject=${incident.subject.length} chars`))
    expect(logged()).toMatch(new RegExp(`body=${incident.text.length} chars`))
  })

  it('leaks nothing through the keyless fallback either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await createMailer({ provider: 'resend' }).send(incident)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(logged()).not.toContain('Ravi Kumar')
    expect(logged()).not.toContain('nurse@acme.test')
  })

  it('leaks nothing through a dry run either', async () => {
    await createMailer({ provider: 'resend', apiKey: 'k', dryRun: true }).send(incident)
    expect(logged()).not.toContain('Ravi Kumar')
    expect(logged()).not.toContain('nurse@acme.test')
  })

  it('still returns a message id, which the ledger records as proof of the send', async () => {
    const id = await createMailer({}).send(incident)
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
  })

  it('writes the body only when MAIL_LOG_BODY is switched on by hand', async () => {
    process.env.MAIL_LOG_BODY = 'true'
    await createMailer({}).send(incident)
    expect(logged()).toContain('chemical burn')
    expect(logged()).toContain('nurse@acme.test')
  })

  it('treats any other value of MAIL_LOG_BODY as off', async () => {
    for (const v of ['', '1', 'yes', 'false']) {
      info.mockClear()
      process.env.MAIL_LOG_BODY = v
      await createMailer({}).send(incident)
      expect(logged()).not.toContain('chemical burn')
    }
  })
})
