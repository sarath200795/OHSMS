// Which fire-alarm devices get a QR code, and which token they keep.
//
// A control panel is the scannable unit of a fire-alarm system: the sticker on
// the panel is how someone standing in front of it opens that panel's page.
// Detectors, call points and hooters do not get their own code — the panel's
// covers the system. That split was already how bulk import and the per-row
// generator worked. The single-add form did not: it stored the panel with no
// qrToken, so "Export QR codes" left it out and a scan had no document to open.
//
// An existing token is never replaced. The value is printed on a sticker; a
// second generate, a re-import or a backfill that minted a fresh one would
// make every label already on a panel scan to nothing.

import { FAS_DEVICE_TYPES } from './constants'
import { tokenFromQrValue } from './qr'

/** The device type that carries the system's QR code. Matches the register's select. */
export const FAS_CONTROL_PANEL = 'Control Panel'

export function isFasControlPanel(row) {
  return String(row?.deviceType || '').trim() === FAS_CONTROL_PANEL
}

/**
 * Token to store when a FAS device is created.
 *
 * '' for anything that is not a control panel. A usable token already on the
 * row is returned unchanged (a label the site has already printed). Anything
 * else is minted by `mint`.
 */
export function fasQrTokenForCreate(row, mint) {
  if (!isFasControlPanel(row)) return ''
  const adopted = tokenFromQrValue(row?.qrToken || row?.qrLink)
  if (adopted) return adopted
  if (typeof mint !== 'function') throw new Error('A control panel with no QR code needs a new token')
  return mint()
}

/**
 * Token to keep when a FAS device is saved.
 *
 * A stored token wins, including one this helper would not have minted: the
 * backfill and an edit must not decide a code already on the wall is "invalid"
 * and replace it. A control panel with no token gets one. Anything else is
 * left without.
 *
 * `minted` is true only when this call created the token, so the writer knows
 * to stamp it onto the asset. An existing token is already there.
 */
export function fasQrTokenForUpdate(existingToken, row, mint) {
  const existing = String(existingToken || '').trim()
  if (existing) return { qrToken: existing, minted: false }
  if (!isFasControlPanel(row)) return { qrToken: '', minted: false }
  if (typeof mint !== 'function') throw new Error('A control panel with no QR code needs a new token')
  return { qrToken: mint(), minted: true }
}

/**
 * Control panels that still have no QR code.
 *
 * Skips anything deleted, anything that is not a panel, and anything that
 * already carries a token — including a token that would not pass the create
 * grammar. Running this twice, after the first run's tokens are stored, yields
 * an empty `assign`.
 */
export function planFasPanelQrBackfill(rows) {
  const assign = []
  const kept = []
  for (const row of rows || []) {
    if (!row || !row.id) continue
    if (row.deletedAt) continue
    if (!isFasControlPanel(row)) continue
    const existing = String(row.qrToken || '').trim()
    if (existing) kept.push({ id: row.id, qrToken: existing })
    else assign.push(row)
  }
  return { assign, kept }
}

/** The type string the register offers, so a rename cannot drift from this file unnoticed. */
export function fasControlPanelIsADeviceType() {
  return FAS_DEVICE_TYPES.includes(FAS_CONTROL_PANEL)
}
