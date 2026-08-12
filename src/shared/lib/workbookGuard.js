// ─────────────────────────────────────────────────────────────────────────────
// Limits applied to every spreadsheet the app parses.
//
// SheetJS parses synchronously on the main thread, so the size of the file is
// the length of time the tab is frozen. There is no CVE needed for this: a
// 200 MB workbook picked by mistake — or a small one crafted to expand — hangs
// the browser of whoever opened it, and the "Reading…" spinner never repaints
// to say why. A cap turns that into a sentence the person can act on.
//
// The row cap exists for the write that follows. Import commits go out in
// batches of 200-400, so a hundred-thousand-row sheet is hundreds of sequential
// round trips against Firestore, billed per document, with the tab held open
// for all of them. No legitimate single upload is that size; a mis-saved export
// with a million blank rows is.
//
// Both refuse rather than truncate. Importing the first 20,000 rows of a larger
// file and reporting success is the failure mode this app cannot have — the
// missing units look identical to units that were never entered.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_WORKBOOK_BYTES = 15 * 1024 * 1024
export const MAX_IMPORT_ROWS = 20000

/** Sizes as a person would write them, so the message names a real number. */
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '0 KB'
  if (n < 1024) return `${Math.round(n)} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * Refuse an oversized file before it is read into memory or handed to SheetJS.
 *
 * Called with `file.size` where a File is available, so a rejected upload is
 * never loaded at all; with `byteLength` where the caller already holds a
 * buffer.
 */
export function assertWorkbookSize(bytes, fileName = '') {
  const n = Number(bytes) || 0
  if (n <= MAX_WORKBOOK_BYTES) return n
  const named = fileName ? `${fileName} is` : 'That file is'
  throw new Error(
    `${named} ${formatBytes(n)}. The limit is ${formatBytes(MAX_WORKBOOK_BYTES)} — ` +
    `split it into smaller files and upload them one after another.`
  )
}

/** Refuse a sheet with more rows than one import should ever carry. */
export function assertRowCount(count) {
  const n = Number(count) || 0
  if (n <= MAX_IMPORT_ROWS) return n
  throw new Error(
    `That sheet has ${n.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} per upload — ` +
    `split it, or delete the empty rows below your data if the sheet looks shorter than this.`
  )
}
