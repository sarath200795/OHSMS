// Client-side view of the operator directory. The callable has already
// decided who may see the rows; this only narrows what is on screen.

export const STATUS_LABEL = {
  active: 'Active',
  suspended: 'Suspended',
  pending: 'Pending approval',
  none: 'No members',
  inactive: 'Inactive',
}

export const STATUS_TONE = {
  active: 'green',
  suspended: 'red',
  pending: 'amber',
  none: 'gray',
  inactive: 'gray',
}

export const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: STATUS_LABEL.active },
  { value: 'suspended', label: STATUS_LABEL.suspended },
  { value: 'pending', label: STATUS_LABEL.pending },
  { value: 'none', label: STATUS_LABEL.none },
  { value: 'inactive', label: STATUS_LABEL.inactive },
]

export function organizationTitle(row) {
  const name = typeof row?.name === 'string' ? row.name.trim() : ''
  return name || 'Unnamed organization'
}

/**
 * Both filters apply together. An empty box does not constrain that side,
 * so typing only an email still searches every organization.
 */
export function filterOrganizations(
  rows,
  { name = '', email = '', status = 'all', activityType = 'all' } = {}
) {
  const nameQuery = String(name || '')
    .trim()
    .toLowerCase()
  const emailQuery = String(email || '')
    .trim()
    .toLowerCase()
  return (rows || []).filter((row) => {
    if (status && status !== 'all' && row?.status !== status) return false
    if (nameQuery && !organizationTitle(row).toLowerCase().includes(nameQuery)) return false
    if (emailQuery) {
      const hit = (row?.admins || []).some((admin) =>
        String(admin?.email || '')
          .toLowerCase()
          .includes(emailQuery)
      )
      if (!hit) return false
    }
    if (activityType && activityType !== 'all') {
      const typed = (row?.activityTypes || []).some(
        (entry) => entry?.type === activityType && entry.count > 0
      )
      if (!typed) return false
    }
    return true
  })
}

/** Types that actually occurred, so the filter only offers something to find. */
export function activityTypeOptions(rows) {
  const labels = new Map()
  for (const row of rows || []) {
    for (const entry of row?.activityTypes || []) {
      if (!entry?.type || !entry.count) continue
      if (!labels.has(entry.type)) labels.set(entry.type, entry.label || entry.type)
    }
  }
  return [...labels.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function topActivityTypes(types, limit = 3) {
  return (types || []).filter((entry) => entry?.count > 0).slice(0, limit)
}

/** A mailto href, or null when the address would break out of the link. */
export function mailHref(email) {
  if (typeof email !== 'string') return null
  const value = email.trim()
  if (!value || /[\s<>"]/.test(value)) return null
  return `mailto:${value}`
}

export function activityFacts(counts = {}, windowDays = 30) {
  const facts = [{ label: 'Users', value: String(counts.users ?? 0) }]
  if (counts.approved) facts.push({ label: 'Approved', value: String(counts.approved) })
  if (counts.pending) facts.push({ label: 'Pending', value: String(counts.pending) })
  if (counts.suspended) facts.push({ label: 'Suspended', value: String(counts.suspended) })
  if (counts.other) facts.push({ label: 'Other', value: String(counts.other) })
  facts.push({
    label: 'Sites',
    value: counts.sites == null ? 'Unavailable' : String(counts.sites),
  })
  facts.push({
    label: `Records in ${windowDays} days`,
    value: counts.recentRecords == null ? 'Unavailable' : String(counts.recentRecords),
  })
  return facts
}

function factPhrase(fact) {
  if (fact.value === 'Unavailable') return `${fact.label} unavailable`
  const n = Number(fact.value)
  if (fact.label === 'Users') return `${fact.value} ${n === 1 ? 'user' : 'users'}`
  if (fact.label === 'Sites') return `${fact.value} ${n === 1 ? 'site' : 'sites'}`
  if (fact.label.startsWith('Records in ')) {
    const rest = fact.label.slice('Records'.length).toLowerCase()
    return `${fact.value} ${n === 1 ? 'record' : 'records'}${rest}`
  }
  return `${fact.value} ${fact.label.toLowerCase()}`
}

export function activityLine(counts, windowDays) {
  return activityFacts(counts, windowDays).map(factPhrase).join(' · ')
}
