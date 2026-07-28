// Sequential auto-serial generation: FE-0001, FE-0002, …
// Used when a Serial No is left blank on the Add form or in a CSV import.

const SERIAL_RE = /^FE-(\d+)$/i

/** Highest numeric suffix among FE-#### serials; 0 if none. */
function maxSerialNumber(serials) {
  let max = 0
  for (const s of serials) {
    const m = SERIAL_RE.exec(String(s || '').trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

/** The next sequential serial after the highest existing FE-#### in `serials`. */
export function nextSerial(serials = []) {
  return format(maxSerialNumber(serials) + 1)
}

function format(n) {
  return `FE-${String(n).padStart(4, '0')}`
}

/**
 * Fill in blank serials for a batch of rows, never colliding with each other
 * or with `existingSerials`. Returns NEW row objects (does not mutate input).
 */
export function assignSerials(rows, existingSerials = []) {
  let counter = maxSerialNumber(existingSerials)
  const used = new Set(existingSerials.map((s) => String(s || '').trim().toLowerCase()))
  return rows.map((row) => {
    if (row.serialNo && row.serialNo.trim()) return row
    // find the next free FE-#### not already used
    let serial
    do {
      counter += 1
      serial = format(counter)
    } while (used.has(serial.toLowerCase()))
    used.add(serial.toLowerCase())
    return { ...row, serialNo: serial }
  })
}
