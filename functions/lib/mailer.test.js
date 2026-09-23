import { describe, it, expect, vi } from 'vitest'
import { parseFrom, mailConfigFrom, describeMailGap, safeOrigin, createMailer } from './mailer.js'

describe('parseFrom', () => {
  it('accepts a bare address and a named address', () => {
    expect(parseFrom(' safety@example.com ')).toBe('safety@example.com')
    expect(parseFrom('WEHS <safety@example.com>')).toBe('WEHS <safety@example.com>')
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
  it('uses info@weehs.org unless overridden, and the password is the only gap', () => {
    const config = mailConfigFrom({})
    expect(config).toMatchObject({
      host: 'mail.privateemail.com',
      port: 465,
      user: 'info@weehs.org',
      from: 'WEEHS <info@weehs.org>',
      appOrigin: 'https://suite.weehs.org',
      configured: false,
    })
    expect(describeMailGap(config)).toEqual(['SMTP_PASS'])
    expect(
      mailConfigFrom({ SMTP_HOST: 'smtp.example', MAIL_FROM: 'a@b.co', SMTP_PASS: '' }).configured
    ).toBe(false)
  })

  it('is configured only when host, from and password are all set', () => {
    const config = mailConfigFrom({
      SMTP_HOST: 'smtp.example',
      SMTP_PORT: '2525',
      SMTP_USER: 'safety',
      SMTP_PASS: 'secret',
      MAIL_FROM: 'WEHS <safety@example.com>',
      APP_ORIGIN: 'https://app.example',
    })
    expect(config).toMatchObject({
      host: 'smtp.example',
      port: 2525,
      user: 'safety',
      pass: 'secret',
      from: 'WEHS <safety@example.com>',
      appOrigin: 'https://app.example',
      configured: true,
    })
  })

  it('defaults a nonsense port to the mailbox SSL port rather than failing open on port 0', () => {
    expect(
      mailConfigFrom({ SMTP_HOST: 'h', MAIL_FROM: 'a@b.co', SMTP_PASS: 'p', SMTP_PORT: 'nope' })
        .port
    ).toBe(465)
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

  it('sends as info@weehs.org when only the mailbox password is set', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer({ SMTP_PASS: 'secret' }, { transport })
    await mailer.send({ to: 'person@example.com', subject: 'Assigned', text: 'body' })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'WEEHS <info@weehs.org>',
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
    })
  })

  it('forwards an html body so nodemailer can send multipart/alternative', async () => {
    const transport = { sendMail: vi.fn(async () => {}) }
    const mailer = createMailer({ SMTP_PASS: 'secret' }, { transport })
    await mailer.send({
      to: 'person@example.com',
      subject: 'Assigned',
      text: 'body',
      html: '<p>body</p>',
    })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'WEEHS <info@weehs.org>',
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
    const mailer = createMailer({ SMTP_PASS: 'secret' }, { transport })
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
