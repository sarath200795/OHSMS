// ─────────────────────────────────────────────────────────────────────────────
// One "save this to the user's disk" for every export in the app.
//
// This was hand-rolled in eleven places, in two variants that are NOT
// equivalent:
//
//   const a = document.createElement('a'); a.href = url; a.download = name
//   a.click(); URL.revokeObjectURL(url)                    ← six sites
//
//   ...document.body.appendChild(a); a.click()
//   document.body.removeChild(a); setTimeout(revoke, 1000) ← five sites
//
// The second is the correct one, for two reasons that only show up on some
// browsers and some file sizes:
//
//   1. Firefox will not action a click on an anchor that is not in the
//      document. The short version silently does nothing there.
//   2. Revoking the object URL on the same tick can race the browser's own read
//      of it, so a large export downloads as a zero-byte or truncated file —
//      intermittently, which is the worst way to find out.
//
// Both failures are invisible in Chrome on a small file, which is what makes
// this exactly the kind of thing that should exist once.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a Blob to the user's disk under `filename`.
 *
 * @param {Blob} blob     the bytes
 * @param {string} filename  the name offered in the save dialog
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Long enough for the browser to have started reading the blob. Revoking is
  // still required — an un-revoked object URL holds the whole blob in memory
  // for the lifetime of the document.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Save text as a file. The BOM is not optional for anything Excel will open:
 * without it a name carrying an accent or a non-Latin script arrives mojibake,
 * and the registers most likely to contain one are the registers most likely to
 * be read by someone who did not write them.
 */
export function downloadText(text, filename, { type = 'text/csv;charset=utf-8;', bom = true } = {}) {
  const parts = bom ? ['﻿', text] : [text]
  downloadBlob(new Blob(parts, { type }), filename)
}
