// Strings that are allowed to leave the database and enter a mailbox.
//
// readableText and safeLine used to live next to the planner. The template
// layer has to call the same two functions: a second copy of the sealed-prefix
// check is how an envelope starts surviving into a subject line the day the
// prefix gains a character. A false positive only drops a line from a mail.

// Prefixes of the envelopes in src/shared/crypto/envelope.js. The full format
// is validated there; here a prefix is enough.
const SEALED_PREFIX = /^(?:enc|enk):1:/

/** Text that is safe to put in a mail, or '' when it is sealed or not text. */
export function readableText(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || SEALED_PREFIX.test(text)) return ''
  return text
}

/** One line, no header injection, bounded. */
export function safeLine(value, max = 140) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const HTML_ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape a string for an HTML text node or a double-quoted attribute. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch])
}

/**
 * An in-app path that can be concatenated onto an origin and placed in an
 * href. Anything else is dropped: a quote breaks out of the attribute, and a
 * scheme or a protocol-relative path would point the button somewhere else.
 */
export function safeMailPath(path) {
  if (typeof path !== 'string') return ''
  if (!path.startsWith('/') || path.startsWith('//')) return ''
  if (/[\s\\<>"']/.test(path)) return ''
  if (path.includes('://')) return ''
  return path
}
