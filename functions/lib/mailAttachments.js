// What may ride along on a mail this process sends.
//
// The transport is created with disableFileAccess and disableUrlAccess, which
// stops nodemailer reading a path or fetching a URL out of the message. That
// is not the whole of the check. A buffer this process already holds can still
// be a sealed object, a file from another org, or a payload large enough to
// wedge the SMTP session. Callers hand candidate bytes in; this file decides
// which of them are allowed to leave.
import { classifyMailText, readableText } from './mailTemplates/safe.js'

// One permit file is allowed up to 10 MB in the app (src/modules/ptw/lib/files.js).
// The mailbox is not that bucket. 7 MB for one part and 15 MB for the whole
// message stays inside what a typical submission actually accepts, and leaves
// room for the body. Anything past the cap is skipped, not a reason to drop
// the mail.
export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024
export const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

const EXT = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/**
 * A filename safe to put in Content-Disposition. Same allowlist idea as
 * safeFileName in src/shared/storage: anything outside it, including a newline
 * that would split the MIME header, becomes an underscore.
 */
export function attachmentFileName(name, fallback = 'attachment') {
  const raw = String(name || '')
    .replace(/[^A-Za-z0-9._\-() ]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  const base = /[A-Za-z0-9]/.test(raw) ? raw : fallback
  return base.slice(0, 120)
}

/** A display name. A sealed string is not a filename — the envelope would leave. */
export function publicFileName(name, fallback = 'attachment') {
  if (typeof name === 'string' && /(?:enc|enk):1:/.test(name)) return fallback
  const text = readableText(name)
  if (!text) return fallback
  return attachmentFileName(text, fallback)
}

/** Report name. A sealed reference is not part of the filename. */
export function reportPdfName(prefix, ref) {
  const id = publicFileName(ref, '')
  const stem = id
    ? `${attachmentFileName(prefix, 'report')}-${id}`
    : attachmentFileName(prefix, 'report')
  return stem.toLowerCase().endsWith('.pdf') ? stem : `${stem}.pdf`
}

export function withExtension(name, contentType) {
  const ext = EXT[contentType]
  if (!ext) return name
  const lower = name.toLowerCase()
  if (lower.endsWith(ext)) return name
  if (contentType === 'image/jpeg' && lower.endsWith('.jpeg')) return name
  const stripped = name.replace(/\.[A-Za-z0-9]+$/, '')
  return `${stripped || 'attachment'}${ext}`
}

/**
 * Bytes this process will attach. The declared type is ignored: a client can
 * call an HTML file a PDF, and storage.rules allow-list the declared type.
 * The mailbox trusts the signature instead.
 */
export function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return ''
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 6) {
    const gif = buf.subarray(0, 6).toString('latin1')
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return ''
}

function asBuffer(content) {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content)
  return null
}

function isSealedContent(content) {
  if (typeof content === 'string') return classifyMailText(content).kind === 'sealed'
  const buf = asBuffer(content)
  if (!buf) return false
  const head = buf
    .subarray(0, 80)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()
  return classifyMailText(head).kind === 'sealed'
}

function loggedName(name) {
  if (typeof name !== 'string' || /(?:enc|enk):1:/.test(name)) return ''
  const text = readableText(name)
  return text ? attachmentFileName(text, '') : ''
}

function outgoingName(name, contentType) {
  return withExtension(publicFileName(name, 'attachment'), contentType)
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 2
  let next = `${stem}-${n}${ext}`
  while (used.has(next)) {
    n += 1
    next = `${stem}-${n}${ext}`
  }
  used.add(next)
  return next
}

/**
 * The attachments that will actually be sent, and why the rest were not.
 * Never throws. A skip is not a failed mail.
 */
export function prepareAttachments(list) {
  const accepted = []
  const skipped = []
  const used = new Set()
  let total = 0
  for (const item of Array.isArray(list) ? list : []) {
    const filename = loggedName(item?.filename)
    if (!item || typeof item !== 'object') {
      skipped.push({ filename, reason: 'invalid' })
      continue
    }
    // path and href are how a message asks the transport to read a file or
    // fetch a URL. The bytes, if we already hold them, are judged below.
    // The path itself is never forwarded.
    if (item.sealed || (item.encIv && item.encKeyId) || isSealedContent(item.content)) {
      skipped.push({ filename, reason: 'sealed' })
      continue
    }
    const content = asBuffer(item.content)
    if (!content || content.length === 0) {
      skipped.push({ filename, reason: 'empty' })
      continue
    }
    const contentType = sniffType(content)
    if (!contentType) {
      skipped.push({ filename, reason: 'type' })
      continue
    }
    if (content.length > MAX_ATTACHMENT_BYTES || total + content.length > MAX_ATTACHMENTS_BYTES) {
      skipped.push({ filename, reason: 'size' })
      continue
    }
    if (accepted.length >= MAX_ATTACHMENTS) {
      skipped.push({ filename, reason: 'count' })
      continue
    }
    const safe = uniqueName(outgoingName(item.filename, contentType), used)
    accepted.push({ filename: safe, content, contentType })
    total += content.length
  }
  return { accepted, skipped }
}

/**
 * Build the list, then filter it. A throw while building — a missing object,
 * a document that will not parse — is a skip. The body mail still goes out,
 * and the caller has not claimed the ledger yet, so the skip is not recorded
 * as a failed send.
 */
export async function loadReportAttachments(build, logger, context = {}) {
  try {
    const raw = await build()
    const { accepted, skipped } = prepareAttachments(raw)
    for (const skip of skipped) logger?.info?.('attachment skipped', { ...context, ...skip })
    return accepted
  } catch (err) {
    logger?.error?.('attachment skipped', {
      ...context,
      reason: 'build-failed',
      error: err?.message || 'attachment-failed',
    })
    return []
  }
}

const DATA_URL = /^data:([^;,]+)?(;base64)?,(.*)$/s

/** A legacy inline file, or null when it is not a data URL we can decode. */
export function decodeDataUrl(value) {
  if (classifyMailText(value).kind === 'sealed') return null
  if (typeof value !== 'string') return null
  const match = DATA_URL.exec(value.trim())
  if (!match) return null
  try {
    const content = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8')
    if (!content.length) return null
    return { content }
  } catch {
    return null
  }
}

/**
 * A Storage path this function may download for a permit attachment.
 *
 * Only this org's permit-documents prefix. Incident photos, another org's
 * files, a `.enc` object and a `..` segment are not this permit's copies.
 * A stored download URL is not a path: it is a bearer credential, and it is
 * not fetched from here.
 */
export function permitObjectPath(orgId, filePath) {
  if (typeof orgId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orgId)) return ''
  if (typeof filePath !== 'string') return ''
  const path = filePath.trim()
  if (!path || path.length > 512) return ''
  if (path.includes('..') || path.includes('\\') || path.includes('\0') || path.includes('//')) {
    return ''
  }
  if (path.endsWith('.enc')) return ''
  const prefix = `orgs/${orgId}/permit-documents/`
  if (!path.startsWith(prefix)) return ''
  const rest = path.slice(prefix.length)
  if (!rest || rest.includes('/')) return ''
  return path
}

/**
 * Pointer metadata from shared/crypto (`encIv` + `encKeyId`), or a path / inline
 * value that is already an envelope. A sealed filename alone is not enough:
 * the bytes may still be the plaintext file, and the name is replaced.
 */
export function isSealedPointer(doc) {
  if (!doc || typeof doc !== 'object') return false
  if (doc.encIv && doc.encKeyId) return true
  if (typeof doc.filePath === 'string' && doc.filePath.trim().endsWith('.enc')) return true
  if (classifyMailText(doc.fileData).kind === 'sealed') return true
  return false
}
