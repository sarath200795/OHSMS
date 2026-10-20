import { describe, it, expect } from 'vitest'
import {
  CONV_TTL_MS,
  resolveOrgQuery,
  orgsForLinkedUser,
  callerForOrg,
  shouldListOrgs,
  formatOrgPrompt,
  sitePrompt,
  pickListedOrg,
  onSiteStep,
  snapshotOrgIds,
  namedOrganisations,
  orgChoiceId,
  ORG_TOO_MANY,
} from './orgs.js'

const ORGS = [
  { id: 'o1', name: 'Acme Fitness' },
  { id: 'o2', name: 'Acme Logistics' },
  { id: 'o3', name: 'Beta Safety' },
]

const NOW = new Date('2026-10-12T05:00:00Z')
const member = (extra = {}) => ({
  orgId: 'o1',
  status: 'approved',
  orgName: 'Acme Fitness',
  ...extra,
})

describe('orgsForLinkedUser', () => {
  it('offers only the organisation the profile belongs to', () => {
    expect(orgsForLinkedUser(member(), { id: 'o1', name: 'Acme Fitness' })).toEqual([
      { id: 'o1', name: 'Acme Fitness' },
    ])
    expect(orgsForLinkedUser(member(), { id: 'o2', name: 'Beta Safety' })).toEqual([])
    expect(orgsForLinkedUser(member({ status: 'suspended' }), { id: 'o1', name: 'Acme' })).toEqual(
      []
    )
    expect(
      orgsForLinkedUser(member({ mustChangePassword: true }), { id: 'o1', name: 'Acme' })
    ).toEqual([])
  })

  it('uses the profile name when the organisation document has none', () => {
    expect(orgsForLinkedUser(member(), { id: 'o1', name: '' })).toEqual([
      { id: 'o1', name: 'Acme Fitness' },
    ])
  })
})

describe('callerForOrg', () => {
  it('does not move a member into another organisation', () => {
    const user = member({ role: 'admin', access: { sites: ['s1'] } })
    expect(callerForOrg(user, 'o1')).toBe(user)
    expect(callerForOrg(user, 'o2')).toBeNull()
  })

  it('makes the open channel an admin of the chosen organisation only', () => {
    const tg = { uid: null, role: 'admin', status: 'approved', channelAdmin: true }
    expect(callerForOrg(tg, 'o2')).toMatchObject({ orgId: 'o2', role: 'admin', uid: null })
  })
})

describe('resolveOrgQuery', () => {
  it('matches a name, a partial name, and nothing else', () => {
    expect(resolveOrgQuery('acme fitness', ORGS)).toMatchObject({ status: 'one', org: ORGS[0] })
    expect(resolveOrgQuery('ACME', ORGS).status).toBe('many')
    expect(resolveOrgQuery('ACME', ORGS).orgs.map((o) => o.id)).toEqual(['o1', 'o2'])
    expect(resolveOrgQuery('beta', ORGS)).toMatchObject({ status: 'one', org: ORGS[2] })
    expect(resolveOrgQuery('zz', ORGS).status).toBe('none')
    expect(resolveOrgQuery('a', ORGS).status).toBe('none')
    expect(resolveOrgQuery('nope nowhere', ORGS).status).toBe('none')
  })

  it('does not list more than ten matches', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, name: `Plant ${i} North` }))
    expect(resolveOrgQuery('plant north', many)).toEqual({ status: 'tooMany' })
    expect(ORG_TOO_MANY).not.toMatch(/\d/)
  })
})

describe('listing names', () => {
  it('lists one name, lists several only when allowed, and never lists more than ten', () => {
    expect(shouldListOrgs(ORGS.slice(0, 1), false)).toBe(true)
    expect(shouldListOrgs(ORGS, false)).toBe(false)
    expect(shouldListOrgs(ORGS, true)).toBe(true)
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, name: `Org ${i}` }))
    expect(shouldListOrgs(eleven, true)).toBe(false)
  })

  it('closed prompt contains no organisation name', () => {
    const prompt = formatOrgPrompt(ORGS, { list: false })
    expect(prompt.text).toMatch(/Which organisation/)
    expect(prompt.text).not.toMatch(/Acme|Beta/)
    expect(prompt.rows).toEqual([])
    expect(prompt.text).toMatch(/112/)
  })

  it('open prompt numbers the names and builds tappable rows', () => {
    const prompt = formatOrgPrompt(ORGS, { list: true })
    expect(prompt.text).toMatch(/1\. Acme Fitness/)
    expect(prompt.text).toMatch(/3\. Beta Safety/)
    expect(prompt.rows.map((r) => r.id)).toEqual(['org:o1', 'org:o2', 'org:o3'])
    expect(prompt.list.button.length).toBeLessThanOrEqual(20)
    expect(prompt.text.length).toBeLessThanOrEqual(1024)
  })

  it('a miss does not add names the caller did not already narrow to', () => {
    const prompt = formatOrgPrompt(ORGS, { list: false, query: 'demo001', missed: true })
    expect(prompt.text).toMatch(/No organisation matches "demo001"/)
    expect(prompt.text).not.toMatch(/Acme|Beta/)
  })

  it('refuses a choice id that would not round-trip through the parser', () => {
    expect(orgChoiceId('o1')).toBe('org:o1')
    expect(orgChoiceId('../users')).toBe('')
    expect(orgChoiceId('x'.repeat(61))).toBe('')
  })
})

describe('conversation memory', () => {
  const session = {
    uid: 'u1',
    step: 'org',
    choiceKind: 'org',
    choices: ['o2', 'o1'],
    choicesExpireAtMs: NOW.getTime() + 1000,
    expiresAtMs: NOW.getTime() + CONV_TTL_MS,
  }

  it('a number picks from the live list only, and only an allowed id', () => {
    expect(pickListedOrg(session, 'u1', 1, ORGS, NOW)?.id).toBe('o2')
    expect(pickListedOrg(session, 'u1', 2, ORGS, NOW)?.id).toBe('o1')
    expect(pickListedOrg(session, 'other', 1, ORGS, NOW)).toBeUndefined()
    expect(
      pickListedOrg({ ...session, choicesExpireAtMs: NOW.getTime() - 1 }, 'u1', 1, ORGS, NOW)
    ).toBe(undefined)
    expect(pickListedOrg(session, 'u1', 1, [ORGS[2]], NOW)).toBeNull()
  })

  it('the site step lasts until the conversation times out, not past a removed org', () => {
    const site = { ...session, step: 'site', orgId: 'o1', choiceKind: null }
    expect(onSiteStep(site, 'u1', ORGS, NOW)?.id).toBe('o1')
    expect(onSiteStep({ ...site, expiresAtMs: NOW.getTime() - 1 }, 'u1', ORGS, NOW)).toBeNull()
    expect(onSiteStep(site, 'u1', [ORGS[2]], NOW)).toBeNull()
    expect(onSiteStep({ ...site, step: 'org' }, 'u1', ORGS, NOW)).toBeNull()
  })

  it('names the organisation when asking for a site', () => {
    expect(sitePrompt(ORGS[0])).toMatch(/Acme Fitness/)
    expect(sitePrompt(ORGS[0])).toMatch(/Site ID or Centre ID/)
    expect(sitePrompt(ORGS[0])).toMatch(/CHANGE ORG/)
  })
})

describe('snapshot orgs', () => {
  it('keeps every real id once, including an organisation with no name', () => {
    expect(
      snapshotOrgIds([
        { id: 'o1', name: 'Acme' },
        { id: 'o1', name: 'Acme' },
        { id: 'o2', name: '' },
        { id: 'bad/id' },
        { id: '' },
        'o3',
      ])
    ).toEqual(['o1', 'o2', 'o3'])
  })

  it('does not offer a nameless organisation on the open channel', () => {
    expect(
      namedOrganisations([
        { id: 'o2', name: 'Beta' },
        { id: 'o1', name: '' },
        { id: 'a/b', name: 'X' },
      ])
    ).toEqual([{ id: 'o2', name: 'Beta' }])
  })
})
