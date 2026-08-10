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

  const raw = String(value)
  const safe = FORMULA_LEAD.test(raw) ? `\t${raw}` : raw
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
