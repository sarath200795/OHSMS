// ─────────────────────────────────────────────────────────────────────────────
// One CSV cell serializer, for every export in the app.
//
// Quoting is the obvious half: a value containing a comma, quote or newline has
// to be wrapped or it silently becomes two columns — or two rows, which is how
// a training register quietly loses people.
//
// The other half is that a spreadsheet does not treat a CSV cell as text. Excel,
// LibreOffice and Sheets all evaluate a cell beginning =, +, - or @ as a
// formula, and =HYPERLINK, =WEBSERVICE and DDE payloads are the usual way that
// gets turned into something worse. The values here are typed by people —
// a person's name, an equipment location, a defect note — and several of those
// fields are editable by the very people the export is about. So a name typed
// as `=WEBSERVICE(...)` runs on the safety manager's machine when they open the
// register, not on the machine of whoever typed it.
//
// Prefixing with a tab is the standard neutralisation: the spreadsheet stops
// parsing the cell as a formula, and the tab is invisible in the cell.
// ─────────────────────────────────────────────────────────────────────────────

// Also \t and \r, because a leading tab or CR reaches the parser ahead of the
// character we are guarding against and would carry it in unnoticed.
const FORMULA_LEAD = /^[=+\-@\t\r]/
const FORMULA_CHAR = /^[=+\-@]/

// Spaces, NBSP, BOM and the C0 controls other than tab, LF and CR. Excel's
// CSV importer has been known to skip whitespace before it decides a cell is
// a formula. Tab, LF and CR are not skipped: a leading tab is itself the
// evasion, and csvCell's existing cases depend on prefixing it again.
function isLeadingNoise(code) {
  return (
    code === 0x20 ||
    code === 0xa0 ||
    code === 0xfeff ||
    code === 0x7f ||
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f)
  )
}

export function needsFormulaPrefix(raw) {
  if (FORMULA_LEAD.test(raw)) return true
  let i = 0
  while (i < raw.length && isLeadingNoise(raw.charCodeAt(i))) i += 1
  return i > 0 && FORMULA_CHAR.test(raw.slice(i))
}

/**
 * A value safe to put in a worksheet cell.
 *
 * xlsx 0.20.3 stores a string that starts with "=" as a string (`t="str"`),
 * not as `<f>`. Opening that file does not run the text. The tab is still
 * applied because saving the sheet back out as CSV, or an importer that looks
 * at the text and ignores the cell type, would. Numbers, booleans and Dates
 * are not strings: prefixing -3 would turn a measurement into text.
 *
 * Call this once. A second pass prefixes the tab that the first pass added.
 */
export function sheetValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value
  const raw = String(value)
  return needsFormulaPrefix(raw) ? `\t${raw}` : raw
}

export function sheetRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const out = {}
    for (const [key, value] of Object.entries(row)) out[key] = sheetValue(value)
    return out
  })
}

export function sheetAoa(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    Array.isArray(row) ? row.map((value) => sheetValue(value)) : row
  )
}

/**
 * One cell, quoted and de-fanged.
 *
 * A number stays a number: negative values are the reason '-' is on the list
 * above, and prefixing every -3 in a report would be worse than the problem.
 * Only strings can carry a payload, so only strings are neutralised.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const asText = value instanceof Date ? value.toISOString() : String(value)
  const safe = needsFormulaPrefix(asText) ? `\t${asText}` : asText
  return /[",\n\r\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** A whole row, already joined. */
export const csvRow = (cells) => cells.map(csvCell).join(',')

/**
 * Header row plus body. `columns` is [{ key, label }].
 *
 * Trailing newline: POSIX text files end with one, and its absence makes some
 * parsers drop the final record.
 */
export function toCsv(rows = [], columns = []) {
  const head = csvRow(columns.map((c) => c.label))
  const body = rows.map((r) => csvRow(columns.map((c) => r[c.key]))).join('\n')
  return rows.length ? `${head}\n${body}\n` : `${head}\n`
}
