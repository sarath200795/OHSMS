// The report file a lifecycle mail attaches.
//
// The print the app shows — MockDrillReport, the committee minutes sheet,
// IncidentReportDoc (the initial report) and PermitPrintable — is HTML the
// browser prints. This process cannot run that print, and a Helvetica
// reconstruction of the same fields is a different document: recipients were
// opening one layout in the app and another from the mailbox.
//
// The client renders that same component to a PDF and uploads it under
// `mailed-reports` before the write that sends the mail. `reportPdfPath` on
// the document names the object. This file downloads that object and nothing
// else for the report itself. It does not draw a second layout. A missing
// object, a path outside this org's prefix, or bytes that are not a PDF are
// a skip: the body still goes out, and the ledger is not failed for a file
// that never left.
//
// Permit `documents` are separate. Those are files the user already uploaded.
// They are still attached after the report, through the same path check they
// had before.
import {
  decodeDataUrl,
  isSealedPointer,
  permitObjectPath,
  publicFileName,
  reportObjectPath,
  reportPdfName,
  sniffType,
  withExtension,
} from './mailAttachments.js'
import { readableText } from './mailTemplates/safe.js'

function asBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  return null
}

/**
 * The app-produced report PDF, or [] when this mail cannot attach one.
 * Never throws. A skip is not a failed mail.
 */
export async function loadAppReportAttachment({
  orgId,
  record,
  readObject,
  prefix,
  ref,
  logger,
  context = {},
}) {
  const named = record?.reportPdfPath
  const path = reportObjectPath(orgId, named)
  if (!path) {
    // A non-empty value that failed the prefix check is a path we will not
    // fetch — another tenant, another kind, a download URL. An empty value
    // means the client did not upload a print for this write.
    const reason = typeof named === 'string' && named.trim() ? 'foreign-path' : 'no-app-pdf'
    logger?.info?.('attachment skipped', { ...context, reason })
    return []
  }
  if (typeof readObject !== 'function') {
    logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
    return []
  }
  let raw
  try {
    raw = await readObject(path)
  } catch (err) {
    logger?.info?.('attachment skipped', {
      ...context,
      reason: 'missing',
      error: err?.message || 'missing',
    })
    return []
  }
  const content = asBuffer(raw)
  if (!content || !content.length) {
    logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
    return []
  }
  return [
    {
      filename: reportPdfName(prefix, ref),
      content,
      contentType: 'application/pdf',
    },
  ]
}

function storedFileName(data, contentType) {
  const named = readableText(data?.fileName) || readableText(data?.label) || 'Permit-attachment'
  return withExtension(publicFileName(named, 'Permit-attachment'), contentType)
}

/**
 * Files already stored on this permit: the documents subcollection, nothing
 * else in the bucket. Inline data URLs from the pre-storage fallback are read
 * here. A Storage object is read only through `readObject`, and only when
 * `permitObjectPath` accepts it. A download URL is not fetched.
 */
export async function permitStoredFiles({ db, orgId, permitId, readObject, logger, context = {} }) {
  const meta = []
  const files = []
  if (
    typeof permitId !== 'string' ||
    !permitId ||
    permitId.includes('/') ||
    permitId.includes('..')
  ) {
    return { meta, files }
  }
  if (typeof orgId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orgId)) return { meta, files }
  let snap
  try {
    snap = await db.collection(`organizations/${orgId}/permits/${permitId}/documents`).get()
  } catch (err) {
    logger?.error?.('permit attachments unreadable', {
      ...context,
      error: err?.message || 'read-failed',
    })
    return { meta, files }
  }
  const docs = Array.isArray(snap?.docs) ? snap.docs : []
  for (const doc of docs.slice(0, 25)) {
    const data = typeof doc?.data === 'function' ? doc.data() || {} : {}
    meta.push(data)
    const file = await onePermitFile(data, { orgId, readObject, logger, context })
    if (file) files.push(file)
  }
  if (docs.length > 25) logger?.info?.('attachment skipped', { ...context, reason: 'count' })
  return { meta, files }
}

async function onePermitFile(data, { orgId, readObject, logger, context }) {
  if (isSealedPointer(data)) {
    logger?.info?.('attachment skipped', { ...context, reason: 'sealed' })
    return null
  }
  let content = null
  const inlineRaw = typeof data.fileData === 'string' ? data.fileData.trim() : ''
  if (inlineRaw) {
    const inline = decodeDataUrl(inlineRaw)
    if (!inline) {
      logger?.info?.('attachment skipped', { ...context, reason: 'unreadable' })
      return null
    }
    content = inline.content
  } else {
    const path = permitObjectPath(orgId, data.filePath)
    if (!path) {
      if (data.filePath || data.fileUrl) {
        logger?.info?.('attachment skipped', {
          ...context,
          reason: data.filePath ? 'foreign-path' : 'no-path',
        })
      }
      return null
    }
    if (typeof readObject !== 'function') {
      logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
      return null
    }
    try {
      const raw = await readObject(path)
      content = asBuffer(raw)
    } catch (err) {
      logger?.info?.('attachment skipped', {
        ...context,
        reason: 'missing',
        error: err?.message || 'missing',
      })
      return null
    }
  }
  if (!content || !content.length) {
    logger?.info?.('attachment skipped', { ...context, reason: 'missing' })
    return null
  }
  const contentType = sniffType(content)
  return {
    filename: storedFileName(data, contentType || 'application/octet-stream'),
    content,
    contentType: contentType || 'application/octet-stream',
  }
}

/**
 * The app's permit PDF, then every extra file on that permit we could
 * actually read. A missing or sealed file is omitted. The extra files are
 * still returned when the report PDF is not there.
 */
export async function permitMailAttachments({
  db,
  orgId,
  permitId,
  permit,
  readObject,
  logger,
  context = {},
}) {
  let copy = []
  try {
    copy = await loadAppReportAttachment({
      orgId,
      record: permit,
      readObject,
      prefix: 'Permit-to-Work',
      ref: permit?.permitNo || permit?.docId,
      logger,
      context,
    })
  } catch (err) {
    logger?.error?.('attachment skipped', {
      ...context,
      reason: 'build-failed',
      error: err?.message || 'attachment-failed',
    })
  }
  let files = []
  try {
    const loaded = await permitStoredFiles({ db, orgId, permitId, readObject, logger, context })
    files = loaded.files
  } catch (err) {
    logger?.error?.('attachment skipped', {
      ...context,
      reason: 'build-failed',
      error: err?.message || 'attachment-failed',
    })
  }
  return [...copy, ...files]
}
