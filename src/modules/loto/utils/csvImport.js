// Bulk CSV for equipment, locks, group numbers and technicians.
//
// Templates are invented examples. Nothing here is a roster or a plant list
// from another app. The parser does not write; the page does, through the
// same services a person would use one row at a time.

export const IMPORT_KINDS = {
  equipment: {
    label: 'Equipment',
    columns: ['equipment', 'site', 'energy'],
    example: 'Pump A,Site 1,electrical',
  },
  locks: {
    label: 'Locks',
    columns: ['lockNo', 'tagNo', 'color'],
    example: 'D-1,RED-1,red',
  },
  groups: {
    label: 'Group numbers',
    columns: ['no', 'description'],
    example: 'GL-1,Yard box',
  },
  technicians: {
    label: 'Technicians',
    columns: ['name', 'lockNo', 'licenceNo', 'licenceExp'],
    example: 'Asha Rao,P-1,WL-100,2027-12-31',
  },
}

export function templateCsv(kind) {
  const spec = IMPORT_KINDS[kind]
  if (!spec) return ''
  return `${spec.columns.join(',')}\r\n${spec.example}\r\n`
}

function parseLine(line) {
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1 }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cur.trim()); cur = '' }
    else cur += c
  }
  cells.push(cur.trim())
  return cells
}

export function parseCsv(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
}

/**
 * Rows ready to hand to the existing create functions, plus problems that
 * name the line. The header row is skipped when it matches the template.
 */
export function importRows(kind, text) {
  const spec = IMPORT_KINDS[kind]
  if (!spec) return { rows: [], errors: ['Choose what to import.'] }
  const table = parseCsv(text)
  if (!table.length) return { rows: [], errors: ['The file is empty.'] }
  const first = table[0].map((c) => c.toLowerCase())
  const start = first[0] === spec.columns[0].toLowerCase() ? 1 : 0
  const rows = []
  const errors = []
  table.slice(start).forEach((cells, i) => {
    const line = start + i + 1
    const rec = Object.fromEntries(spec.columns.map((col, idx) => [col, cells[idx] || '']))
    if (kind === 'equipment' && (!rec.equipment || !rec.site)) errors.push(`Line ${line}: equipment and site are required.`)
    else if (kind === 'locks' && !rec.lockNo) errors.push(`Line ${line}: lock number is required.`)
    else if (kind === 'groups' && !/^[A-Za-z0-9-]{1,40}$/.test(rec.no)) errors.push(`Line ${line}: group number must be letters, numbers and hyphens.`)
    else if (kind === 'technicians' && (!rec.name || !rec.lockNo)) errors.push(`Line ${line}: name and lock number are required.`)
    else if (kind === 'technicians' && rec.licenceExp && !/^\d{4}-\d{2}-\d{2}$/.test(rec.licenceExp)) {
      errors.push(`Line ${line}: licence expiry must be YYYY-MM-DD.`)
    } else rows.push(rec)
  })
  return { rows, errors }
}
