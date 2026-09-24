// What a recipient is allowed to see as the sender.
//
// The product name used to be the From display name and the header of every
// mail. That is who the message appeared to be from. The mailbox address
// stays; the words in front of it do not. An organisation document's name is
// used when the mail already has that document. Otherwise the neutral label.
//
// A display name that is only the old product name is dropped, including when
// MAIL_FROM still carries it. A name with a colon, quote or angle bracket is
// dropped too: that is how a display name becomes a second header.
import { readableText, safeLine } from './mailTemplates/safe.js'

export const NEUTRAL_SENDER = 'EHS notifications'

const BRAND_NAME = /^(?:weehs|wehs)(?:[\s-]+ohsms)?$/i

export function isProductBrandName(value) {
  return BRAND_NAME.test(String(value || '').trim())
}

/** A display name safe to put in a From header or a mail heading, or ''. */
export function mailSenderName(value) {
  const text = safeLine(readableText(value), 80)
  if (!text || /["<>:]/.test(text)) return ''
  if (isProductBrandName(text)) return ''
  return text
}

function safeOrgId(orgId) {
  if (typeof orgId !== 'string') return ''
  const id = orgId.trim()
  if (!id || id === '.' || id === '..' || id.includes('/')) return ''
  return id
}

/**
 * `organizations/{orgId}.name`, or '' when the document, the field, or the id
 * is not usable. A sealed name is '' — the envelope is not a display name.
 */
export async function loadOrgDisplayName(db, orgId) {
  const id = safeOrgId(orgId)
  if (!db || !id) return ''
  const snap = await db.doc(`organizations/${id}`).get()
  const exists = typeof snap?.exists === 'function' ? snap.exists() : Boolean(snap?.exists)
  if (!exists) return ''
  const data = typeof snap.data === 'function' ? snap.data() : null
  return mailSenderName(data?.name)
}
