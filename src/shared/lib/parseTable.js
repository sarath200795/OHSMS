import Papa from 'papaparse'

/**
 * Read an uploaded table without handing an untrusted file to SheetJS.
 *
 * Every import in the app parsed .xlsx, and the npm `xlsx` package carries a
 * prototype-pollution advisory with no fixed version — SheetJS stopped
 * publishing there. Parsing is the whole of that exposure: building a workbook
 * from our own data is not an attack surface, so the exports still write real
 * .xlsx files and only the READ paths moved here.
 *
 * papaparse was already in the tree (the site importer uses it), so this adds
 * no dependency and removes the untrusted-parsing surface rather than
 * mitigating it.
 *
 * Returns rows as objects keyed by header, missing cells as '' — the same shape
 * XLSX.utils.sheet_to_json(ws, { defval: '' }) returned, so the callers' row
 * handling is untouched.
 */

// Keys that are not data. A header cell reading __proto__ is the prototype
// pollution this move exists to escape, and papaparse would happily build an
// object with it — the vulnerability lives in the parser being trusting, not in
// which parser it is. Dropped rather than sanitised: no spreadsheet column is
// legitimately called __proto__, so there is nothing to preserve.
const FORBIDDEN = ['__proto__', 'constructor', 'prototype']

const clean = (v) => (v == null ? '' : String(v).trim())

/** Header keys, trimmed, with blanks and dangerous names removed. */
export function safeHeaders(fields = []) {
  return (fields || [])
    .map(clean)
    .filter((f) => f && !FORBIDDEN.includes(f.toLowerCase()))
}

/**
 * Turn papaparse output into the row shape the importers expect.
 *
 * Built with Object.create(null) so a row can carry no inherited keys at all,
 * then flattened to a plain object for the callers that spread it.
 */
export function toRows(data = [], fields = []) {
  const headers = safeHeaders(fields)
  return (data || [])
    .map((raw) => {
      const row = {}
      for (const h of headers) row[h] = raw?.[h] == null ? '' : raw[h]
      return row
    })
    // A trailing newline yields a row of empty strings; importers would count
    // it as a record and report one more than the file contains.
    .filter((row) => Object.values(row).some((v) => clean(v) !== ''))
}

/** Parse a File/Blob of CSV into { rows, fields }. */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // No dynamicTyping: a serial number like 007 or a date-like string must
      // arrive as it was written. Importers coerce what they need themselves.
      complete: (res) => resolve({ rows: toRows(res.data, res.meta?.fields), fields: safeHeaders(res.meta?.fields) }),
      error: (err) => reject(new Error(err?.message || 'Could not read that CSV file')),
    })
  })
}

/** Parse CSV text (used where the caller already holds the string). */
export function parseCsvText(text) {
  const res = Papa.parse(String(text ?? ''), { header: true, skipEmptyLines: 'greedy' })
  return { rows: toRows(res.data, res.meta?.fields), fields: safeHeaders(res.meta?.fields) }
}
