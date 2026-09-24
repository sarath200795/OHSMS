// Shared chrome for assignment mail.
//
// One layout, four bodies, plus the incident-reported alert. Mail clients
// strip <style> and grid, so the structure is tables with the colour on each
// cell. There is no remote image: a client that fetched a logo would report
// that the message was opened, and the header is text, which survives
// image blocking. The text is the organisation name when the caller has
// one, and a neutral label when it does not.
//
// White on #1a4a44 is 9.97:1. The lighter brand teal (#3d7a72) is only 4.97:1
// under white and fails as a button fill in clients that ignore font-weight.
// The header and the button use the same pair so the four modules read as one
// product. Footer text is #246058 on white (7.27:1).
//
// `blocks` is optional. Assignment mail does not pass them. An empty list must
// not change that mail's text or HTML — the incident alert is the caller that
// needs a multi-line narrative and a 5 Why chain.
import { NEUTRAL_SENDER, mailSenderName } from '../mailBrand.js'
import { MAILBOX_ADDRESS } from '../mailer.js'
import { escapeHtml, safeLine } from './safe.js'

export const MAIL_SENDER = NEUTRAL_SENDER
// The From address. The Brevo SMTP login is a different value and is not
// printed here. The footer names this address even when the display name is
// the organisation, so a recipient can see which mailbox the message is from.
export const MAIL_ADDRESS = MAILBOX_ADDRESS
export const MAIL_FOOTER_NOTE = 'Please do not reply to this transactional message.'

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK = '#123632'
const MUTED = '#246058'
const TEAL = '#1a4a44'
const MIST = '#e8f4f2'
const LINE = '#d0e8e4'
const PAPER = '#ffffff'

export function senderLabel(sender) {
  return mailSenderName(sender) || MAIL_SENDER
}

export function footerLine(sender) {
  return `Sent by ${senderLabel(sender)} · ${MAIL_ADDRESS} · ${MAIL_FOOTER_NOTE}`
}

function detailTable(rows) {
  if (!rows.length) return ''
  const body = rows
    .map(
      (row) => `<tr>
<td valign="top" style="padding:7px 16px 7px 0;width:116px;font-family:${SANS};font-size:13px;line-height:1.4;color:${MUTED};">${escapeHtml(row.label)}</td>
<td valign="top" style="padding:7px 0;font-family:${SANS};font-size:15px;line-height:1.4;color:${INK};font-weight:600;">${escapeHtml(row.value)}</td>
</tr>`
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 8px;">${body}</table>`
}

function actionBlock({ actionLabel, url, path }) {
  if (url) {
    const href = escapeHtml(url)
    const label = escapeHtml(actionLabel || 'Open it')
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
<tr>
<td bgcolor="${TEAL}" style="background:${TEAL};border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:15px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;">${label}</a>
</td>
</tr>
</table>
<p style="margin:14px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};">Or copy this link:<br><a href="${href}" style="color:${TEAL};word-break:break-all;">${href}</a></p>`
  }
  if (path) {
    return `<p style="margin:20px 0 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${INK};">Open it in the app: ${escapeHtml(path)}</p>`
  }
  return ''
}

function presentBlocks(blocks) {
  if (!Array.isArray(blocks)) return []
  return blocks.filter(
    (block) => block && block.label && typeof block.text === 'string' && block.text.trim()
  )
}

// Longer than a detail row: the incident narrative and the 5 Why chain.
// pre-wrap keeps the line breaks the caller already sanitised. Weight stays
// regular so a few hundred words are not set in the bold used for short facts.
// Empty string, not a newline, so assignment HTML is unchanged when unused.
function proseBlocks(blocks) {
  if (!blocks.length) return ''
  return blocks
    .map(
      (
        block
      ) => `<h2 style="margin:18px 0 6px;font-family:${SANS};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};">${escapeHtml(block.label)}</h2>
<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.55;font-weight:400;color:${INK};white-space:pre-wrap;">${escapeHtml(block.text)}</p>`
    )
    .join('')
}

function renderText({ label, headline, rows, blocks, url, path, sender }) {
  const lines = [label, headline, '']
  for (const row of rows) lines.push(`${row.label}: ${row.value}`)
  if (rows.length) lines.push('')
  for (const block of blocks) {
    lines.push(block.label)
    lines.push(block.text)
    lines.push('')
  }
  // "Open it:" is the text client's button. The HTML part uses the module's
  // own action label; this line stays stable so a client that cannot render
  // HTML still has one unambiguous link.
  if (url) lines.push(`Open it: ${url}`)
  else if (path) lines.push(`Open it in the app: ${path}`)
  lines.push('', footerLine(sender))
  return lines.join('\n')
}

function renderHtml({ subject, label, headline, rows, blocks, actionLabel, url, path, sender }) {
  const preheader = safeLine(
    [headline, ...rows.map((row) => row.value), ...blocks.map((block) => block.text)]
      .filter(Boolean)
      .join(' · '),
    140
  )
  const chip = escapeHtml(label)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${MIST};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${MIST};">
<tr>
<td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;">
<tr>
<td style="padding:18px 28px;background:${TEAL};border-radius:12px 12px 0 0;">
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;color:${LINE};">${escapeHtml(senderLabel(sender))}</p>
</td>
</tr>
<tr>
<td style="padding:24px 28px 8px;">
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 10px;background:${MIST};border-radius:999px;font-family:${SANS};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${TEAL};">${chip}</span></p>
<h1 style="margin:0;font-family:${SANS};font-size:22px;line-height:1.35;font-weight:700;color:${INK};">${escapeHtml(headline)}</h1>
${detailTable(rows)}${proseBlocks(blocks)}
${actionBlock({ actionLabel, url, path })}
</td>
</tr>
<tr>
<td style="padding:16px 28px 22px;border-top:1px solid ${LINE};background:#f4faf8;">
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};">Sent by ${escapeHtml(senderLabel(sender))} · <a href="mailto:${escapeHtml(MAIL_ADDRESS)}" style="color:${TEAL};text-decoration:underline;">${escapeHtml(MAIL_ADDRESS)}</a><br>${escapeHtml(MAIL_FOOTER_NOTE)}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}

/**
 * HTML plus the plain-text equivalent. `rows` are already safe lines;
 * this still escapes them, because the caller that forgets is how a title
 * becomes a tag.
 */
export function renderLayout(message) {
  const rows = Array.isArray(message.rows) ? message.rows.filter((row) => row && row.value) : []
  const blocks = presentBlocks(message.blocks)
  const sender = senderLabel(message.sender)
  const view = { ...message, rows, blocks, sender }
  return {
    text: renderText(view),
    html: renderHtml(view),
    senderName: sender,
  }
}
