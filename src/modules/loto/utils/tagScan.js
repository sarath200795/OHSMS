// ─────────────────────────────────────────────────────────────────────────────
// Reading what was scanned (or typed) at an isolation point.
//
// The tag QR encodes `/t/<procedureId>/<pointKey>` (utils/codes.js tagScanUrl).
// The manual fallback exists for a tag that is too scuffed or too dark to scan
// and a phone with no camera API, so it accepts the three things a person can
// reasonably read or paste: the whole link, the point key itself, or the short
// point number printed on the tag (E-1, H-2).
//
// Pure, so the rule "a tag from another machine never counts" is tested without
// a camera.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a scanned or typed code to one of this permit's isolation points.
 *
 * @param {string} raw  the QR payload or what the person typed
 * @param {{ procedureId: string, points: {key: string, pointId: string}[] }} permit
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
export function resolveTagCode(raw, { procedureId, points = [] }) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: 'Nothing was scanned.' }

  // A link: it must name THIS procedure. A tag from the machine next door is the
  // one mistake this check is for — it would otherwise count as a scan here.
  const link = /\/t\/([^/?#\s]+)\/([^/?#\s]+)/.exec(text)
  if (link) {
    let key
    try {
      key = decodeURIComponent(link[2])
    } catch {
      return { ok: false, reason: 'That tag code is not readable.' }
    }
    if (link[1] !== procedureId) {
      return { ok: false, reason: 'That tag belongs to different equipment.' }
    }
    const point = points.find((p) => p.key === key)
    return point ? { ok: true, point } : { ok: false, reason: 'That tag is not an isolation point of this permit.' }
  }

  const byKey = points.find((p) => p.key === text)
  if (byKey) return { ok: true, point: byKey }

  const wanted = text.toUpperCase().replace(/\s+/g, '')
  const byId = points.find((p) => String(p.pointId).toUpperCase() === wanted)
  if (byId) return { ok: true, point: byId }

  return { ok: false, reason: `“${text.slice(0, 40)}” is not an isolation point of this permit.` }
}

/** Which of the permit's points still have no scan. */
export function unscannedPoints(points = [], scans = {}) {
  return points.filter((p) => !scans[p.key])
}
