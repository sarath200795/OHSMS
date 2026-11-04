import { describe, it, expect } from 'vitest'
import { activityLine, filterOrganizations, mailHref, organizationTitle } from './directoryQuery.js'

const rows = [
  {
    id: 'a',
    name: 'Acme Fitness',
    status: 'active',
    admins: [
      { uid: '1', name: 'Ada Admin', email: 'ada@acme.test', status: 'approved' },
      { uid: '2', name: 'Bea Admin', email: 'bea@other.test', status: 'suspended' },
    ],
    counts: {
      users: 4,
      approved: 2,
      pending: 1,
      suspended: 1,
      other: 0,
      sites: 3,
      recentRecords: 2,
    },
  },
  {
    id: 'b',
    name: 'Beacon Health',
    status: 'suspended',
    admins: [{ uid: '3', name: 'Sam', email: 'sam@beacon.test', status: 'suspended' }],
    counts: {
      users: 1,
      approved: 0,
      pending: 0,
      suspended: 1,
      other: 0,
      sites: null,
      recentRecords: 0,
    },
  },
  {
    id: 'c',
    name: '',
    status: 'none',
    admins: [],
    counts: { users: 0, sites: 0, recentRecords: null },
  },
]

describe('filterOrganizations', () => {
  it('matches an organization name, case-insensitively', () => {
    expect(filterOrganizations(rows, { name: 'acme' }).map((row) => row.id)).toEqual(['a'])
  })

  it('matches any admin email, and ignores a member who is not in the payload', () => {
    expect(filterOrganizations(rows, { email: 'BEA@other' }).map((row) => row.id)).toEqual(['a'])
    expect(filterOrganizations(rows, { email: 'mo@acme.test' })).toEqual([])
  })

  it('applies the name and the email together', () => {
    expect(filterOrganizations(rows, { name: 'acme', email: 'beacon.test' })).toEqual([])
    expect(
      filterOrganizations(rows, { name: 'beacon', email: 'sam@' }).map((row) => row.id)
    ).toEqual(['b'])
  })

  it('filters by the derived status', () => {
    expect(filterOrganizations(rows, { status: 'suspended' }).map((row) => row.id)).toEqual(['b'])
    expect(filterOrganizations(rows, { status: 'all' })).toHaveLength(3)
  })

  it('keeps an organization only when that activity type was recorded', () => {
    const typed = [
      { ...rows[0], activityTypes: [{ type: 'incidents', label: 'Incidents', count: 2 }] },
      { ...rows[1], activityTypes: [{ type: 'loto', label: 'LOTO', count: 1 }] },
    ]
    expect(filterOrganizations(typed, { activityType: 'loto' }).map((row) => row.id)).toEqual(['b'])
    expect(filterOrganizations(typed, { name: 'acme', activityType: 'loto' })).toEqual([])
  })

  it('names a blank organization rather than rendering an empty heading', () => {
    expect(organizationTitle(rows[2])).toBe('Unnamed organization')
  })
})

describe('activityLine', () => {
  it('prints the counts that were read, and refuses to call a failed read zero', () => {
    expect(activityLine(rows[0].counts, 30)).toBe(
      '4 users · 2 approved · 1 pending · 1 suspended · 3 sites · 2 records in 30 days'
    )
    expect(activityLine(rows[1].counts, 30)).toContain('Sites unavailable')
    expect(activityLine({ users: 1, sites: 1, recentRecords: 1 }, 30)).toBe(
      '1 user · 1 site · 1 record in 30 days'
    )
    expect(activityLine(rows[2].counts, 30)).toContain('Records in 30 days unavailable')
  })
})

describe('mailHref', () => {
  it('links a normal address and refuses one that would break out of mailto', () => {
    expect(mailHref(' ada@acme.test ')).toBe('mailto:ada@acme.test')
    expect(mailHref('ada@acme.test\nBcc: x')).toBe(null)
    expect(mailHref('')).toBe(null)
    expect(mailHref(null)).toBe(null)
  })
})
