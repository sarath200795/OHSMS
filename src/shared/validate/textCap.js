// Length caps shared by the forms and the writers.
//
// Firestore rules are the gate. These caps exist so a person typing into a
// field hears "too long" instead of a permission error, and so a spreadsheet
// cell cannot become a megabyte write. The numbers match the rules: a cap
// here that is higher than the rule rejects a legitimate save, and one that
// is lower silently drops text the rule would have kept.

export const TEXT = {
  note: 500,
  portalNote: 2000,
  name: 120,
  email: 200,
  orgName: 120,
  address: 300,
  label: 200,
  role: 60,
  token: 128,
  defect: 200,
  status: 60,
  site: 300,
  location: 500,
  serial: 120,
  short: 80,
  date: 40,
  narrative: 5000,
  probableCause: 2000,
  clinical: 8000,
  firstAid: 2000,
  medication: 2000,
  job: 4000,
  jsa: 2000,
  remarks: 2000,
}

/** String form of a cell or field, trimmed. Null and undefined are empty. */
export function asText(value) {
  if (value == null) return ''
  return String(value).trim()
}

/** Empty when the text fits, otherwise a sentence a form can show. */
export function tooLong(value, max, label) {
  const text = value == null ? '' : String(value)
  if (text.length <= max) return ''
  return `${label} must be ${max} characters or fewer`
}

/**
 * The first field in `limits` whose value is over its cap.
 * `limits` is `{ field: [max, label] }`.
 */
export function overlongField(data, limits) {
  if (!data) return ''
  for (const [field, [max, label]] of Object.entries(limits)) {
    const hit = tooLong(data[field], max, label)
    if (hit) return hit
  }
  return ''
}
