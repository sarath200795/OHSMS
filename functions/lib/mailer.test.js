import { describe, it, expect, vi } from 'vitest'
import {
  parseFrom,
  mailConfigFrom,
  describeMailGap,
  safeOrigin,
  createMailer,
  transportOptions,
} from './mailer.js'

describe('parseFrom', () => {
  it('accepts a bare address and a named address', () => {
    expect(parseFrom(' safety@example.com ')).toBe('safety@example.com')
    expect(parseFrom('Ops <safety@example.com>')).toBe('Ops <safety@example.com>')
  })

  it('strips a newline so the header cannot be split', () => {
    expect(parseFrom('safety@example.com\nBcc: evil@example.com')).toBe('')
    expect(parseFrom('Evil\r\nBcc: x@y.z <safety@example.com>')).toBe('safety@example.com')
  })

  it('refuses a value that is not an address', () => {
    expect(parseFrom('not an email')).toBe('')
    expect(parseFrom('')).toBe('')
  })
})

describe('safeOrigin', () => {
  it('keeps an http(s) origin and drops the path', () => {
    expect(safeOrigin('https://app.example/ohsms/')).toBe('https://app.example')
  })

  it('refuses an origin that would copy credentials into every mail', () => {
    expect(safeOrigin('https://user:pass@app.example')).toBe('')
  })

  it('refuses anything that is not a URL', () => {
    expect(safeOrigin('javascript:alert(1)')).toBe('')
    expect(safeOrigin('/incidents')).toBe('')
    expect(safeOrigin('')).toBe('')
  })
})

describe('mail configuration', () => {
  it('uses the Brevo relay and info@weehs.org as From, and does not invent an SMTP login', () => {
    const config = mailConfigFrom({})
    expect(config).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      user: '',
      from: 'EHS notifications <info@weehs.org>',
      appOrigin: 'https://suite.weehs.org',
      configured: false,
    })
    expect(describeMailGap(config)).toEqual(['SMTP_USER', 'SMTP_PASS'])
    expect(
      mailConfigFrom({
        SMTP_HOST: 'smtp.example',
        SMTP_USER: 'login@example.com',
        MAIL_FROM: 'a@b.co',
        SMTP_PASS: '',
      }).configured
    ).toBe(false)
  })

  it('is configured only when host, from and password are all set', () => {
    const config = mailConfigFrom({
      SMTP_HOST: 'smtp.example',
      SMTP_PORT: '2525',
      SMTP_USER: 'safety',
      SMTP_PASS: 'secret',
      MAIL_FROM: 'Ops <safety@example.com>',
      APP_ORIGIN: 'https://app.example',
    })
    expect(config).toMatchObject({
      host: 'smtp.example',
      port: 2525,
      user: 'safety',
      pass: 'secret',
      from: 'Ops <safety@example.com>',
      appOrigin: 'https://app.example',
      configured: true,
    })
  })

  it('replaces a product-name display name and keeps the mailbox address', () => {
    expect(mailConfigFrom({ MAIL_FROM: 'WEEHS <info@weehs.org>' }).from).toBe(
      'EHS notifications <info@weehs.org>'
    )
    expect(mailConfigFrom({ MAIL_FROM: 'WEHS OHSMS <safety@example.com>' }).from).toBe(
      'EHS notifications <safety@example.com>'
    )
    expect(mailConfigFrom({ MAIL_FROM: 'Ops <ops@example.com>' }).from).toBe(
      'Ops <ops@example.com>'
    )
  })

  it('defaults a nonsense port to the Brevo submission port rather than failing open on port 0', () => {
    expect(
      mailConfigFrom({ SMTP_HOST: 'h', MAIL_FROM: 'a@b.co', SMTP_PASS: 'p', SMTP_PORT: 'nope' })
        .port
    ).toBe(587)
  })

  it('uses STARTTLS on 587 and implicit TLS only on 465', () => {
    const brevo = transportOptions(
      mailConfigFrom({ SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' })
    )
    expect(brevo).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'login@example.com', pass: 'secret' },
    })
    const implicit = transportOptions(
      mailConfigFrom({ SMTP_PASS: 'secret', SMTP_USER: 'login@example.com', SMTP_PORT: '465' })
    )
    expect(implicit).toMatchObject({ port: 465, secure: true, requireTLS: false })
  })
})

describe('createMailer', () => {
  it('refuses to send when the provider is not configured, and does not call the transport', async () => {
    const transport = { sendMail: vi.fn() }
    const mailer = createMailer({}, { transport })
    await expect(mailer.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toMatchObject({
      code: 'mail/not-configured',
    })
    expect(transport.sendMail).not.toHaveBeenCalled()
  })

  it('puts the organisation name in front of the mailbox address', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
      senderName: 'Northwind Steel',
    })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'Northwind Steel <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
    })
  })

  it('does not send a product name when that is the name it was given', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com', MAIL_FROM: 'WEEHS <info@weehs.org>' },
      { transport }
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
      senderName: 'WEEHS',
    })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'EHS notifications <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
    })
  })

  it('sends as info@weehs.org when the From address is left at the default', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    await mailer.send({ to: 'person@example.com', subject: 'Assigned', text: 'body' })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'EHS notifications <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
    })
  })

  it('forwards an html body so nodemailer can send multipart/alternative', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
      html: '<p>body</p>',
    })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'EHS notifications <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
      html: '<p>body</p>',
    })
  })

  it('lets nodemailer build multipart/alternative when both parts are present', async () => {
    const nodemailer = await import('nodemailer')
    const lib = typeof nodemailer.createTransport === 'function' ? nodemailer : nodemailer.default
    const transport = lib.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    })
    const sent = []
    const sendMail = transport.sendMail.bind(transport)
    transport.sendMail = async (message) => {
      const info = await sendMail(message)
      sent.push(info)
      return info
    }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'plain body',
      html: '<p>html body</p>',
    })
    const raw = Buffer.isBuffer(sent[0].message)
      ? sent[0].message.toString()
      : String(sent[0].message)
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('plain body')
    expect(raw).toContain('<p>html body</p>')
  })

  it('attaches a buffer and drops a sealed one without failing the send', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    const report = Buffer.from('%PDF-1.4\n% drill\n')
    await mailer.send({
      to: 'person@example.com',
      subject: 'Mock drill report',
      text: 'body',
      html: '<p>body</p>',
      attachments: [
        { filename: 'Mock-Drill-Report-DR-1.pdf', content: report, contentType: 'application/pdf' },
        {
          filename: 'secret.pdf',
          content: Buffer.from('enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
        },
      ],
    })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'EHS notifications <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Mock drill report',
      text: 'body',
      html: '<p>body</p>',
      attachments: [
        {
          filename: 'Mock-Drill-Report-DR-1.pdf',
          content: report,
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
        },
      ],
    })
  })

  it('puts the filename on the wire when file and URL access are disabled', async () => {
    const nodemailer = await import('nodemailer')
    const lib = typeof nodemailer.createTransport === 'function' ? nodemailer : nodemailer.default
    const transport = lib.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    })
    const sent = []
    const sendMail = transport.sendMail.bind(transport)
    transport.sendMail = async (message) => {
      const info = await sendMail(message)
      sent.push(info)
      return info
    }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'plain body',
      attachments: [
        {
          filename: 'Incident-Report-IRA-2026-0007.pdf',
          content: Buffer.from('%PDF-1.4\n% incident\n'),
        },
      ],
    })
    const raw = Buffer.isBuffer(sent[0].message)
      ? sent[0].message.toString()
      : String(sent[0].message)
    expect(raw).toContain('Incident-Report-IRA-2026-0007.pdf')
    expect(raw).toContain('Content-Disposition: attachment')
    expect(raw).toContain('application/pdf')
    expect(raw).not.toContain('\nBcc:')
  })

  it('inlines a png referenced by content id and leaves a pdf as an attachment', async () => {
    const nodemailer = await import('nodemailer')
    const lib = typeof nodemailer.createTransport === 'function' ? nodemailer : nodemailer.default
    const transport = lib.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    })
    const sent = []
    const sendMail = transport.sendMail.bind(transport)
    transport.sendMail = async (message) => {
      const info = await sendMail(message)
      sent.push(info)
      return info
    }
    const mailer = createMailer(
      { SMTP_PASS: 'secret', SMTP_USER: 'login@example.com' },
      { transport }
    )
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await mailer.send({
      to: 'person@example.com',
      subject: 'Weather risk',
      text: 'body',
      html: '<img src="cid:weather-risk-map" alt="Map">',
      attachments: [
        { filename: 'weather-risk-map.png', content: png, cid: 'weather-risk-map' },
        { filename: 'notes.pdf', content: Buffer.from('%PDF-1.4\n% notes\n') },
      ],
    })
    const raw = Buffer.isBuffer(sent[0].message)
      ? sent[0].message.toString()
      : String(sent[0].message)
    expect(raw).toContain('Content-ID: <weather-risk-map>')
    expect(raw).toContain('Content-Disposition: inline')
    expect(raw).toContain('filename=notes.pdf')
    expect(raw).toContain('Content-Disposition: attachment')
    expect(raw).toContain('cid:weather-risk-map')
  })

  it('sends through the injected transport with the configured from address', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer(
      {
        SMTP_HOST: 'smtp.example',
        MAIL_FROM: 'safety@example.com',
        SMTP_PASS: 'secret',
        SMTP_USER: 'safety',
      },
      { transport }
    )
    await mailer.send({ to: 'person@example.com', subject: 'Assigned', text: 'body' })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'safety@example.com',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
    })
  })
})
