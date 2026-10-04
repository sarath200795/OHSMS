import * as XLSX from 'xlsx'
import { PERMIT_HEADERS, POINT_HEADERS, permitSheetRows, pointSheetRows } from './permitExport'

const PERMIT_WIDTHS = [
  14, 20, 20, 24, 20, 18, 28, 10, 28, 50, 14, 8, 20, 20, 12, 20, 20, 20, 20, 10, 20, 36, 36, 10, 20,
  20, 20, 40,
]
const POINT_WIDTHS = [14, 24, 8, 16, 28, 10, 12, 20, 20, 14, 20]

// An empty sheet still gets its header row: a download that opens blank looks
// like a broken button.
function sheet(rows, headers, widths) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
  ws['!cols'] = widths.map((wch) => ({ wch }))
  return ws
}

/**
 * Write the permit register as a workbook: "Permits" (one row per permit) and
 * "Isolation points" (one row per point, with the lock and the scan). Returns
 * the counts so the caller can say what it did.
 */
export function exportPermitsXlsx(
  permits = [],
  filename = 'LOTO_Permits.xlsx',
  nowMs = Date.now()
) {
  const permitRows = permitSheetRows(permits, nowMs)
  const pointRows = pointSheetRows(permits)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet(permitRows, PERMIT_HEADERS, PERMIT_WIDTHS), 'Permits')
  XLSX.utils.book_append_sheet(
    wb,
    sheet(pointRows, POINT_HEADERS, POINT_WIDTHS),
    'Isolation points'
  )
  XLSX.writeFile(wb, filename)
  return { permits: permitRows.length, points: pointRows.length }
}
