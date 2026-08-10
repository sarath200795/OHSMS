// ─────────────────────────────────────────────────────────────────────────────
// Email delivery, behind an adapter — the same shape as src/shared/storage.
//
// The app's goal is to run against any client's infrastructure. Email is the
// most opinionated piece of that: some orgs mandate their own relay, some are
// on Microsoft 365, some just want a key pasted in. So nothing above this file
// knows which provider is in use; it calls send() and gets a message id back.
//
// Every provider here speaks plain HTTPS via fetch, so the deployed bundle
// carries no mail dependency at all and cold starts stay cheap. SMTP is the one
// case that genuinely needs a library — the extension point is documented at
// the bottom rather than pulling nodemailer in for a case nobody has asked for.
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown for a provider-side rejection, so callers can tell it from a bug. */
export class MailError extends Error {
  constructor(message, { status, provider, retryable = false } = {}) {
    super(message)
    this.name = 'MailError'
    this.status = status
    this.provider = provider
    // 4xx means the message is wrong and will be wrong next time; 5xx and
    // network faults are worth another attempt. Retrying a bad address forever
    // is how a mail integration gets an org's domain blocked.
    this.retryable = retryable
  }
}

const asArray = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean)

/**
 * Collapse anything that becomes a mail header onto one line.
 *
 * Subjects are built from record text — an action title, an incident ref — and
 * that is user input, while a header is terminated by a newline. Both providers
 * here take these as JSON fields and encode the headers themselves, so this is
 * not exploitable through either of them today.
 *
 * It becomes exploitable the day someone follows the SMTP note at the bottom of
 * this file, and the person doing that will be thinking about nodemailer, not
 * about what a title three modules away is allowed to contain. Enforcing it at
 * the one point every provider passes through is cheaper than remembering it
 * there — and it means the templates can keep composing subjects freely.
 */
const headerSafe = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()

/** 429 and 5xx are transient; everything else is our fault and stays our fault. */
const retryable = (status) => status === 429 || (status >= 500 && status < 600)

const providers = {
  // ── Resend ────────────────────────────────────────────────────────────────
  resend: {
    async send({ apiKey, from, to, subject, text, html, replyTo }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: asArray(to),
          subject,
          text,
          html,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new MailError(body?.message || `Resend rejected the message (${res.status})`, {
          status: res.status,
          provider: 'resend',
          retryable: retryable(res.status),
        })
      }
      return body?.id || null
    },
  },

  // ── SendGrid ──────────────────────────────────────────────────────────────
  sendgrid: {
    async send({ apiKey, from, to, subject, text, html, replyTo }) {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: asArray(to).map((email) => ({ email })) }],
          from: { email: from },
          subject,
          content: [
            { type: 'text/plain', value: text },
            ...(html ? [{ type: 'text/html', value: html }] : []),
          ],
          ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new MailError(body || `SendGrid rejected the message (${res.status})`, {
          status: res.status,
          provider: 'sendgrid',
          retryable: retryable(res.status),
        })
      }
      // SendGrid returns 202 with an empty body; the id is in a header.
      return res.headers.get('x-message-id') || null
    },
  },

  // ── Console ───────────────────────────────────────────────────────────────
  // The default. An unconfigured deployment logs what it *would* have sent
  // instead of throwing, so triggers can be exercised in the emulator and a
  // missing API key never turns into a failed incident report.
  console: {
    async send({ to, subject, text }) {
      // eslint-disable-next-line no-console
      console.info(`[mail:console] → ${asArray(to).join(', ')}\n  ${subject}\n  ${text?.slice(0, 400)}`)
      return `console-${subject}`
    },
  },
}

/**
 * Build a mailer from config.
 *
 * @param cfg { provider, apiKey, from, replyTo, dryRun }
 */
export function createMailer(cfg = {}) {
  const name = (cfg.provider || 'console').toLowerCase()
  const impl = providers[name]
  if (!impl) throw new MailError(`Unknown email provider "${name}"`, { provider: name })

  // A provider selected but not credentialed is a misconfiguration, and it is
  // better to say so at startup than to discover it when the first permit is
  // about to expire. Falling back to console keeps the trigger alive.
  const credentialed = name === 'console' || Boolean(cfg.apiKey)
  if (!credentialed) {
    // eslint-disable-next-line no-console
    console.error(`[mail] provider "${name}" has no API key — falling back to console output.`)
  }
  const active = credentialed ? impl : providers.console
  const from = cfg.from || 'OHS MS <onboarding@resend.dev>'

  return {
    provider: credentialed ? name : 'console',
    async send({ to, subject, text, html, replyTo }) {
      const recipients = asArray(to)
      if (!recipients.length) return null
      // Sanitised before the check, so a subject of nothing but newlines is
      // caught by it rather than sent as an empty one.
      const line = headerSafe(subject)
      if (!line) throw new MailError('Refusing to send a message with no subject')
      const reply = headerSafe(replyTo || cfg.replyTo) || undefined
      if (cfg.dryRun) return providers.console.send({ to: recipients, subject: line, text })
      return active.send({
        apiKey: cfg.apiKey,
        from,
        to: recipients,
        subject: line,
        text,
        html,
        replyTo: reply,
      })
    },
  }
}

// Adding a provider — say an org's own SMTP relay:
//   1. npm i nodemailer  (inside functions/)
//   2. add an `smtp` entry above with the same send() signature
//   3. set MAIL_PROVIDER=smtp plus whatever host/port/auth params it reads
// Nothing outside this file changes.
