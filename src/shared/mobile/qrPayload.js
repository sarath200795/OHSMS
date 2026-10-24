// What a scanned code is allowed to open.
//
// Equipment labels encode publicQrUrl(token), which is `<origin>/qr/<token>`.
// Permits encode `/permit/<token>`, isolation procedures `/p/<id>`, and a tag
// hung on a valve `/t/<id>/<point>`. The origin varies: a label printed before
// the app moved host still says web.app, and one printed on site says
// suite.weehs.org. The path is the contract. The host is not.
//
// tokenFromQrValue (the bulk-import helper) takes the last segment of ANY url,
// which is right for a spreadsheet cell and wrong for a camera: a code from
// another system would be treated as one of ours and navigated to. This parser
// only accepts the paths this app prints. Anything else is unknown, and unknown
// is never followed — a scan must not become a navigation to someone else's host.

import { tokenFromQrValue } from '../../modules/fire/lib/qr'

/** A path segment that is safe to drop into one of our routes. */
function segment(value) {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(text)) return ''
  return text
}

function pathnameOf(raw) {
  try {
    return new URL(raw, 'https://qr.local').pathname
  } catch {
    return ''
  }
}

/**
 * @returns {{kind:'empty'}
 *   | {kind:'unknown'}
 *   | {kind:'equipment', token:string}
 *   | {kind:'permit', token:string}
 *   | {kind:'procedure', id:string}
 *   | {kind:'tag', id:string, point:string}}
 */
export function parseQrPayload(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { kind: 'empty' }

  // A bare token, as pasted from a label's text line. No slashes, no scheme.
  if (!raw.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const token = tokenFromQrValue(raw)
    return token ? { kind: 'equipment', token } : { kind: 'unknown' }
  }

  // javascript:, data:, and anything URL() refuses. Never a route.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return { kind: 'unknown' }

  const parts = pathnameOf(raw).split('/').filter(Boolean)
  if (parts[0] === 'qr' && parts.length >= 2) {
    const token = tokenFromQrValue(parts[1])
    return token ? { kind: 'equipment', token } : { kind: 'unknown' }
  }
  if (parts[0] === 'permit' && parts.length >= 2) {
    const token = tokenFromQrValue(parts[1])
    return token ? { kind: 'permit', token } : { kind: 'unknown' }
  }
  if (parts[0] === 'p' && parts.length >= 2) {
    const id = segment(parts[1])
    return id ? { kind: 'procedure', id } : { kind: 'unknown' }
  }
  if (parts[0] === 't' && parts.length >= 3) {
    const id = segment(parts[1])
    const point = segment(decodeURIComponent(parts[2]))
    return id && point ? { kind: 'tag', id, point } : { kind: 'unknown' }
  }
  return { kind: 'unknown' }
}

/**
 * An in-app path for a parsed code, or null when the code must not navigate.
 * The result is always a same-app path. It is never an absolute URL.
 */
export function routeForScan(parsed) {
  if (!parsed) return null
  if (parsed.kind === 'equipment' && parsed.token) {
    return `/field/asset/${encodeURIComponent(parsed.token)}`
  }
  if (parsed.kind === 'permit' && parsed.token) {
    return `/permit/${encodeURIComponent(parsed.token)}`
  }
  if (parsed.kind === 'procedure' && parsed.id) {
    return `/p/${encodeURIComponent(parsed.id)}`
  }
  if (parsed.kind === 'tag' && parsed.id && parsed.point) {
    return `/t/${encodeURIComponent(parsed.id)}/${encodeURIComponent(parsed.point)}`
  }
  return null
}
