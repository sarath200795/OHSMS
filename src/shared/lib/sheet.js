// The one way an export builds a worksheet from data a person typed.
//
// json_to_sheet on this SheetJS build does not turn a leading "=" into a
// formula. sheetRows still runs first: the prefix is what keeps the same text
// from becoming one if the file is later saved as CSV. Developer-authored
// formulas are not a feature of these exports — nothing in the app sets cell.f.
import * as XLSX from 'xlsx'
import { sheetAoa, sheetRows } from './csv'

export function jsonToSheet(rows, opts) {
  const safe = sheetRows(rows)
  return opts ? XLSX.utils.json_to_sheet(safe, opts) : XLSX.utils.json_to_sheet(safe)
}

export function aoaToSheet(rows, opts) {
  const safe = sheetAoa(rows)
  return opts ? XLSX.utils.aoa_to_sheet(safe, opts) : XLSX.utils.aoa_to_sheet(safe)
}
