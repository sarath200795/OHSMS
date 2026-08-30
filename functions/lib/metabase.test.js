import { describe, it, expect } from 'vitest'
import {
  checkBaseUrl, parseCardId, normalizeConfig, redactConfig, readiness,
  cardQueryUrl, currentUserUrl, fieldForColumn, columnKey, normalizeStatus, sourcesFor,
  normalizeRow, normalizeRows, isoDate, capRows, MAX_ROWS, STATUSES,
  keyAge, asMillis, asDay, dateParameters, buildDateParams, defaultRange, safeRange, cardUrl, MAX_RANGE_DAYS,
} from './metabase.js'

describe('checkBaseUrl', () => {
  it('accepts an ordinary https instance and keeps only the origin', () => {
    // A path here would be silently dropped when the API path is appended, and
    // a setting that is accepted then ignored is worse than one refused.
    expect(checkBaseUrl('https://metabase.example.com/browse/1')).toEqual({
      ok: true, origin: 'https://metabase.example.com',
    })
  })

  it('assumes https for a bare hostname, because that is what people type', () => {
    expect(checkBaseUrl('metabase.example.com').origin).toBe('https://metabase.example.com')
  })

  it('keeps a non-default port', () => {
    expect(checkBaseUrl('https://mb.example.com:3000').origin).toBe('https://mb.example.com:3000')
  })

  it('refuses http, because the API key would travel in the clear', () => {
    const r = checkBaseUrl('http://metabase.example.com')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/https/)
  })

  it('refuses the addresses that make this an SSRF primitive', () => {
    // The function makes this request. On Cloud Run 169.254.169.254 hands out
    // service-account tokens to anything that asks.
    for (const bad of [
      'https://169.254.169.254', 'https://metadata.google.internal', 'https://localhost',
      'https://127.0.0.1', 'https://10.1.2.3', 'https://192.168.0.5', 'https://172.16.4.4',
      'https://mb.internal', 'https://box.local',
    ]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false)
    }
  })

  it('does not refuse a public address that merely looks similar', () => {
    expect(checkBaseUrl('https://172.15.0.1').ok).toBe(true)   // just below the private block
    expect(checkBaseUrl('https://172.32.0.1').ok).toBe(true)   // just above it
    expect(checkBaseUrl('https://internal-metabase.example.com').ok).toBe(true)
  })

  it('says what is wrong rather than just refusing — this is a settings form', () => {
    expect(checkBaseUrl('').reason).toMatch(/Enter/)
    expect(checkBaseUrl('not a url at all').ok).toBe(false)
  })
})

describe('parseCardId', () => {
  it('takes a number however it was typed', () => {
    expect(parseCardId('42')).toBe(42)
    expect(parseCardId(42)).toBe(42)
    expect(parseCardId(' 42 ')).toBe(42)
  })

  it('is null for anything that is not a saved-question id', () => {
    for (const bad of ['', null, undefined, 0, -3, 'abc', NaN]) expect(parseCardId(bad)).toBe(null)
  })
})

describe('redactConfig', () => {
  it('never returns the key — not masked, ABSENT', () => {
    // A masked credential in a JSON response is still a credential in a JSON
    // response as far as a cache or a support screenshot is concerned.
    const out = redactConfig({ baseUrl: 'https://mb.example.com', apiKey: 'mb_secret', cards: { findings: 7 } })
    expect(JSON.stringify(out)).not.toContain('mb_secret')
    expect(out).toMatchObject({ baseUrl: 'https://mb.example.com', hasKey: true, cards: { findings: 7, audits: null } })
  })

  it('never returns a source’s own key either', () => {
    const out = redactConfig({
      apiKey: 'mb_shared',
      sources: [
        { id: 'a', baseUrl: 'https://a.example.com', cards: { findings: 1 } },
        { id: 'b', baseUrl: 'https://b.example.com', apiKey: 'mb_own', cards: { findings: 2 } },
      ],
    })
    expect(JSON.stringify(out)).not.toContain('mb_shared')
    expect(JSON.stringify(out)).not.toContain('mb_own')
    // What the settings screen does need: which instances can be reached, and
    // which of them is on a key of its own.
    expect(out.sources.map((s) => [s.id, s.hasKey, s.ownKey])).toEqual([['a', true, false], ['b', true, true]])
  })

  it('reports no key as no key', () => {
    expect(redactConfig({ baseUrl: 'https://mb.example.com' }).hasKey).toBe(false)
  })

  it('survives a document that holds nothing at all', () => {
    expect(redactConfig(undefined)).toMatchObject({ baseUrl: '', hasKey: false, cards: { findings: null, audits: null } })
  })

  it('offers one empty source to fill in, rather than an empty list', () => {
    // A settings screen with no row at all has nothing to type into, and the
    // "add an instance" button becomes a step nobody knows they have to take.
    expect(redactConfig(undefined).sources).toHaveLength(1)
  })
})

describe('several instances, one key', () => {
  const multi = {
    apiKey: 'mb_shared',
    sources: [
      { id: 'grp', label: 'Group', baseUrl: 'https://group.example.com', cards: { findings: 11, audits: 12 } },
      { id: 'acq', label: 'Acquired region', baseUrl: 'https://acq.example.com', cards: { findings: 21 } },
      { id: 'new', label: 'Not set up yet', baseUrl: '', cards: {} },
    ],
  }

  it('gives every source the shared key, because the key belongs to the account', () => {
    const c = normalizeConfig(multi)
    expect(c.sources.map((s) => s.apiKey)).toEqual(['mb_shared', 'mb_shared', 'mb_shared'])
    expect(c.sources.every((s) => s.ownKey === false)).toBe(true)
  })

  it('lets one source override the key without disturbing the others', () => {
    const c = normalizeConfig({ ...multi, sources: [{ ...multi.sources[0], apiKey: 'mb_own' }, multi.sources[1]] })
    expect(c.sources.map((s) => s.apiKey)).toEqual(['mb_own', 'mb_shared'])
    expect(c.sources.map((s) => s.ownKey)).toEqual([true, false])
  })

  it('queries only the sources that have a question for the dataset', () => {
    expect(sourcesFor(multi, 'findings').map((s) => s.id)).toEqual(['grp', 'acq'])
    // The acquired region has no audits question yet; the group does.
    expect(sourcesFor(multi, 'audits').map((s) => s.id)).toEqual(['grp'])
  })

  it('skips a source with no URL, rather than building a request to nowhere', () => {
    expect(sourcesFor(multi, 'findings').some((s) => s.id === 'new')).toBe(false)
  })

  it('is ready when ANY source can answer', () => {
    // One instance being down, or not carrying the audits question, must not
    // blank a dashboard the other two can fill.
    expect(readiness(multi, 'findings')).toEqual({ ok: true })
    expect(readiness(multi, 'audits')).toEqual({ ok: true })
  })

  it('says no-card only when NO source has that question', () => {
    const noAudits = { ...multi, sources: multi.sources.map((s) => ({ ...s, cards: { findings: s.cards?.findings } })) }
    expect(readiness(noAudits, 'audits').reason).toBe('no-card')
  })

  it('says not-configured when no source has both a URL and a key', () => {
    expect(readiness({ sources: [{ baseUrl: 'https://a.example.com' }] }, 'findings').reason).toBe('not-configured')
  })

  it('still reads a document written before the list existed', () => {
    // Every tenant already using ODIN holds this shape. A normaliser that
    // stopped understanding it would disconnect all of them on deploy.
    const c = normalizeConfig({ baseUrl: 'https://mb.example.com', apiKey: 'k', cards: { findings: 7 } })
    expect(c.sources).toHaveLength(1)
    expect(c.sources[0]).toMatchObject({ baseUrl: 'https://mb.example.com', apiKey: 'k' })
    // And the flattened fields still mean what they always meant.
    expect(c.baseUrl).toBe('https://mb.example.com')
    expect(c.cards.findings).toBe(7)
  })

  it('gives an id to a source saved without one, so the UI can key on it', () => {
    const c = normalizeConfig({ apiKey: 'k', sources: [{ baseUrl: 'https://a.example.com' }, { baseUrl: 'https://b.example.com' }] })
    expect(new Set(c.sources.map((s) => s.id)).size).toBe(2)
  })

  it('ignores junk in the list rather than building a request from it', () => {
    const c = normalizeConfig({ apiKey: 'k', sources: [null, 'nope', { baseUrl: 'https://a.example.com' }] })
    expect(c.sources).toHaveLength(1)
  })
})

describe('normalizeConfig', () => {
  it('drops a card id that is not one, rather than putting it in a URL', () => {
    expect(normalizeConfig({ cards: { findings: 'seven' } }).cards.findings).toBe(null)
  })
})

describe('readiness', () => {
  const full = { baseUrl: 'https://mb.example.com', apiKey: 'k', cards: { findings: 7, audits: 8 } }

  it('is ready when a URL, a key and a card for that dataset all exist', () => {
    expect(readiness(full, 'findings')).toEqual({ ok: true })
  })

  it('distinguishes "nothing configured" from "that question is not set"', () => {
    // The tab shows a different screen for each: one sends an admin to the
    // settings page, the other names the missing question.
    expect(readiness({}, 'findings').reason).toBe('not-configured')
    expect(readiness({ ...full, cards: { findings: 7 } }, 'audits').reason).toBe('no-card')
  })

  it('refuses a dataset it has no idea about', () => {
    expect(readiness(full, 'whatever').reason).toBe('unknown-dataset')
  })
})

describe('endpoints', () => {
  it('builds the query and identity URLs Metabase actually serves', () => {
    expect(cardQueryUrl('https://mb.example.com', 7)).toBe('https://mb.example.com/api/card/7/query/json')
    expect(currentUserUrl('https://mb.example.com')).toBe('https://mb.example.com/api/user/current')
  })
})

describe('column mapping', () => {
  it('meets a warehouse halfway on spelling and case', () => {
    expect(columnKey('Site Name')).toBe('sitename')
    expect(fieldForColumn('Site Name')).toBe('site')
    expect(fieldForColumn('SITE_NAME')).toBe('site')
    expect(fieldForColumn('sub_category')).toBe('subCategory')
    expect(fieldForColumn('Sub Category of Finding')).toBe('subCategory')
    expect(fieldForColumn('Pass %')).toBe('passPct')
    expect(fieldForColumn('pass_pct_n7')).toBe('passPctN7')
  })

  it('keeps a percent sign as `pct`, so "Pass %" and "Pass" stay different columns', () => {
    // One is a percentage, the other is a COUNT of checks that passed. Reading
    // a count of 8 as "8%" draws a bar wrong by an order of magnitude that
    // looks entirely plausible.
    expect(columnKey('Pass %')).toBe('passpct')
    expect(columnKey('Pass')).toBe('pass')
    expect(fieldForColumn('Pass %')).toBe('passPct')
    expect(fieldForColumn('Pass')).toBe('checksPassed')
  })

  it('reads a bare Pass / Fail pair as counts', () => {
    expect(fieldForColumn('Pass')).toBe('checksPassed')
    expect(fieldForColumn('Fail')).toBe('checksFailed')
    expect(fieldForColumn('Failed')).toBe('checksFailed')
    expect(fieldForColumn('Non-Conformances')).toBe('checksFailed')
  })

  it('reads the N+7 re-check stated either way', () => {
    expect(fieldForColumn('Pass % N+7')).toBe('passPctN7')
    expect(fieldForColumn('Pass N+7')).toBe('checksPassedN7')
    expect(fieldForColumn('Fail N+7')).toBe('checksFailedN7')
  })

  it('claims nothing it was not asked to claim', () => {
    expect(fieldForColumn('reviewer')).toBe(null)
    expect(fieldForColumn('')).toBe(null)
  })
})

describe('normalizeStatus', () => {
  it('folds the words people actually use into the four the dashboard draws', () => {
    expect(normalizeStatus('Open')).toBe('open')
    expect(normalizeStatus('In Progress')).toBe('in_progress')
    expect(normalizeStatus('WIP')).toBe('in_progress')
    expect(normalizeStatus('On Hold')).toBe('on_hold')
    expect(normalizeStatus('Deferred')).toBe('on_hold')
    expect(normalizeStatus('Closed')).toBe('closed')
    expect(normalizeStatus('Resolved')).toBe('closed')
  })

  it('says unknown rather than guessing "open"', () => {
    // Folding an unrecognised status into Open produces a chart that is
    // confidently wrong, which is worse than one that admits a gap.
    expect(normalizeStatus('Escalated to legal')).toBe('unknown')
    expect(normalizeStatus('')).toBe('unknown')
    expect(STATUSES).not.toContain('unknown')
  })
})

describe('isoDate', () => {
  it('passes a date through, and parses a timestamp down to its day', () => {
    expect(isoDate('2026-03-14')).toBe('2026-03-14')
    expect(isoDate('2026-03-14T09:15:00Z')).toBe('2026-03-14')
  })

  it('is empty rather than Invalid Date', () => {
    expect(isoDate('')).toBe('')
    expect(isoDate('not a date')).toBe('')
    expect(isoDate(null)).toBe('')
  })
})

describe('normalizeRow', () => {
  it('maps a realistic warehouse row onto the canonical shape', () => {
    const r = normalizeRow({
      'Site Name': 'Plant 2', Region: 'South', 'Business Unit': 'Retail',
      Status: 'In Progress', 'Sub Category': 'Blocked fire exit',
      'Audit Date': '2026-03-14T00:00:00Z', Latitude: '12.97', Longitude: '77.59',
    })
    expect(r.site).toBe('Plant 2')
    expect(r.region).toBe('South')
    expect(r.entity).toBe('Retail')
    expect(r.status).toBe('in_progress')
    expect(r.subCategory).toBe('Blocked fire exit')
    expect(r.auditDate).toBe('2026-03-14')
    expect(r.lat).toBeCloseTo(12.97)
    expect(r.lng).toBeCloseTo(77.59)
  })

  it('keeps the raw status beside the mapped one, so a caveat can name it', () => {
    expect(normalizeRow({ status: 'Escalated' })).toMatchObject({ status: 'unknown', rawStatus: 'Escalated' })
  })

  it('counts one per row unless the question already grouped', () => {
    // Both shapes have to work through the same sum, which is why nothing
    // downstream counts rows.
    expect(normalizeRow({ site: 'A' }).count).toBe(1)
    expect(normalizeRow({ site: 'A', count: 14 }).count).toBe(14)
  })

  it('reads a percentage stored as a display string', () => {
    expect(normalizeRow({ 'Pass %': '87.5%' }).passPct).toBeCloseTo(87.5)
    expect(normalizeRow({ 'Pass %': '1,024' }).passPct).toBe(1024)
  })

  it('is null, not NaN, for a number that is not one', () => {
    expect(normalizeRow({ latitude: 'north-ish' }).lat).toBe(null)
  })

  it('derives the check total from a pass/fail pair, so no third column is needed', () => {
    const r = normalizeRow({ Site: 'A', Pass: 8, Fail: 2 })
    expect(r.checksPassed).toBe(8)
    expect(r.checksFailed).toBe(2)
    expect(r.checksTotal).toBe(10)
  })

  it('prefers a stated total over the derived one', () => {
    // The question is the authority on its own denominator: an audit can have
    // checks that were neither passed nor failed (not applicable, not reached).
    expect(normalizeRow({ Pass: 8, Fail: 2, 'Total Checks': 12 }).checksTotal).toBe(12)
  })

  it('refuses to derive a total from half a pair', () => {
    // Treating a missing fail count as zero turns "8 passed, failures not
    // recorded" into a 100% pass rate — an invented perfect audit.
    expect(normalizeRow({ Pass: 8 }).checksTotal).toBe(null)
    expect(normalizeRow({ Fail: 2 }).checksTotal).toBe(null)
  })

  it('derives the N+7 total the same way', () => {
    const r = normalizeRow({ 'Pass N+7': 9, 'Fail N+7': 1 })
    expect(r.checksPassedN7).toBe(9)
    expect(r.checksTotalN7).toBe(10)
  })

  it('keeps a column it has no use for rather than dropping it silently', () => {
    expect(normalizeRow({ site: 'A', Reviewer: 'Priya' }).extra).toEqual({ Reviewer: 'Priya' })
  })

  it('does not let JSON key order decide between two columns for one field', () => {
    const r = normalizeRow({ site: 'First', site_name: 'Second' })
    expect(r.site).toBe('First')
  })

  it('keeps the runner-up column too, instead of losing it entirely', () => {
    // The loser used to be dropped on the floor: absent from the row AND
    // absent from the unmapped list, so a question carrying two columns for
    // one field silently lost one with nothing on any screen to say so.
    const r = normalizeRow({ site: 'First', site_name: 'Second' })
    expect(r.extra).toEqual({ site_name: 'Second' })
  })

  it('maps the dimensions an estate is cut by', () => {
    const r = normalizeRow({
      centername: 'Cult Pitampura',
      cityName: 'Gurgaon',
      ownership_type: 'COCO',
      business_line: 'ELITE',
      center_type_1: 'GX',
      TypeOfAudit: 'Quarterly FLS Audit',
      Auditor_Name: 'Amit kumar Srivastava Curefit',
    })
    expect(r.site).toBe('Cult Pitampura')
    expect(r.city).toBe('Gurgaon')
    expect(r.ownership).toBe('COCO')
    expect(r.businessLine).toBe('ELITE')
    expect(r.centerType).toBe('GX')
    expect(r.auditType).toBe('Quarterly FLS Audit')
    // The company suffix warehouses glue onto an account name is dropped.
    expect(r.auditor).toBe('Amit kumar Srivastava')
  })

  it('reads all three CAS scores, misspelled column and all', () => {
    const r = normalizeRow({
      Oringinal_calcultated_CAS_score: 92.45,
      cas_seven_day_score: 96.23,
      cas_current_day_score: 100,
    })
    expect(r.passPct).toBe(92.45)
    expect(r.passPctN7).toBe(96.23)
    expect(r.passPctToDate).toBe(100)
  })

  it('does not let a ticket dump lose its L1 tag to a column called "type"', () => {
    // Both used to land on `category`, and whichever came second vanished.
    const r = normalizeRow({ type: 'Cult Pass', L1_tag: 'Facility', L2_Tag: 'FLS - Extinguisher' })
    expect(r.tenant).toBe('Cult Pass')
    expect(r.category).toBe('Facility')
    expect(r.subCategory).toBe('FLS - Extinguisher')
  })

  it('reads a ticket dump\'s remediation columns', () => {
    const r = normalizeRow({
      ticket_status: 'OPEN',
      SLA_status: 'open-SLA-Breached',
      priority_flag: 'Code_red',
      tat_closure_hour: 91,
      checkpoint: 'Are all extinguishers placed on metal stands?',
      labels: '[Quarterly FLS Audit]',
    })
    expect(r.status).toBe('open')
    expect(r.sla).toBe('open-SLA-Breached')
    expect(r.priority).toBe('Code_red')
    expect(r.tatHours).toBe(91)
    expect(r.checkpoint).toBe('Are all extinguishers placed on metal stands?')
    // The brackets a warehouse wraps a label array in are not part of the name.
    expect(r.auditType).toBe('Quarterly FLS Audit')
  })
})

describe('normalizeRows', () => {
  it('reports every column nothing claimed, once', () => {
    const out = normalizeRows([
      { site: 'A', Reviewer: 'Asha' },
      { site: 'B', Reviewer: 'Dev', Owner: 'Priya' },
    ])
    expect(out.rows).toHaveLength(2)
    expect(out.unmapped.sort()).toEqual(['Owner', 'Reviewer'])
  })

  it('ignores anything in the array that is not a row', () => {
    expect(normalizeRows([null, 'nope', { site: 'A' }]).rows).toHaveLength(1)
    expect(normalizeRows(undefined).rows).toEqual([])
  })
})

describe('capRows', () => {
  it('leaves an ordinary result alone', () => {
    expect(capRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], total: 3, capped: false })
  })

  it('truncates loudly, so the tab can say the totals are partial', () => {
    // A callable response is capped at 10MB. Truncating quietly would produce a
    // dashboard that is simply wrong about totals.
    const out = capRows(new Array(MAX_ROWS + 5).fill(0))
    expect(out.rows).toHaveLength(MAX_ROWS)
    expect(out.total).toBe(MAX_ROWS + 5)
    expect(out.capped).toBe(true)
  })
})

describe("keyAge", () => {
  const DAY = 86400000
  const NOW = Date.parse("2026-08-30T12:00:00Z")
  const cfg = (over) => ({ apiKey: "mb_x", baseUrl: "https://m.example.com", ...over })

  it("says nothing when no key is saved", () => {
    expect(keyAge({}, NOW).set).toBe(false)
  })

  it("reports the age but no countdown when keys here do not expire", () => {
    const a = keyAge(cfg({ apiKeyUpdatedAt: NOW - 5 * DAY }), NOW)
    expect(a).toMatchObject({ set: true, days: 5, expiresInDays: null, stale: false })
  })

  it("counts down when a lifetime is set", () => {
    const a = keyAge(cfg({ apiKeyUpdatedAt: NOW - 1 * DAY, apiKeyMaxAgeDays: 3 }), NOW)
    expect(a).toMatchObject({ days: 1, expiresInDays: 2, stale: false })
  })

  it("calls a key stale the day its lifetime runs out", () => {
    expect(keyAge(cfg({ apiKeyUpdatedAt: NOW - 3 * DAY, apiKeyMaxAgeDays: 3 }), NOW).stale).toBe(true)
    expect(keyAge(cfg({ apiKeyUpdatedAt: NOW - 9 * DAY, apiKeyMaxAgeDays: 3 }), NOW).stale).toBe(true)
  })

  it("does not guess an age for a key saved before this was tracked", () => {
    expect(keyAge(cfg({ apiKeyMaxAgeDays: 3 }), NOW)).toMatchObject({ set: true, days: null, stale: false })
  })

  it("reads a Firestore timestamp, an ISO string and epoch millis alike", () => {
    expect(asMillis({ toMillis: () => 1234 })).toBe(1234)
    expect(asMillis({ seconds: 2 })).toBe(2000)
    expect(asMillis("2026-08-30T12:00:00Z")).toBe(NOW)
    expect(asMillis(NOW)).toBe(NOW)
    expect(asMillis(null)).toBe(null)
    expect(asMillis("not a date")).toBe(null)
  })

  it("never lets the key itself into what a client is told", () => {
    const r = redactConfig(cfg({ apiKeyUpdatedAt: NOW - DAY, apiKeyMaxAgeDays: 3 }))
    expect(JSON.stringify(r)).not.toContain("mb_x")
    expect(r.hasKey).toBe(true)
    expect(r.apiKeyMaxAgeDays).toBe(3)
    expect(r.keyAge.set).toBe(true)
  })
})

describe("date parameters", () => {
  // The two questions this was built against, as Metabase describes them.
  const FLS = { parameters: [
    { id: "p1", slug: "ownership_type", type: "string/=", target: ["variable", ["template-tag", "ownership_type"]] },
    { id: "p2", slug: "city_name", type: "string/=", target: ["variable", ["template-tag", "city_name"]] },
    { id: "p3", slug: "Start", type: "date/single", target: ["variable", ["template-tag", "Start"]] },
    { id: "p4", slug: "End", type: "date/single", target: ["variable", ["template-tag", "End"]] },
  ] }

  it("names the card endpoint", () => {
    expect(cardUrl("https://mb.example.com", 7)).toBe("https://mb.example.com/api/card/7")
  })

  it("takes only a real calendar day", () => {
    expect(asDay("2026-08-30")).toBe("2026-08-30")
    expect(asDay("2026-02-31")).toBe("")     // not a day, and Metabase would misread it
    expect(asDay("2026-8-3")).toBe("")
    expect(asDay("2026-08")).toBe("")
    expect(asDay("")).toBe("")
    expect(asDay(null)).toBe("")
  })

  it("picks out the date parameters and ignores the rest", () => {
    expect(dateParameters(FLS).map((p) => p.slug)).toEqual(["Start", "End"])
    expect(dateParameters({ parameters: [] })).toEqual([])
    expect(dateParameters(undefined)).toEqual([])
  })

  it("binds the range to them in declaration order", () => {
    const { parameters, bound } = buildDateParams(FLS, { from: "2026-01-01", to: "2026-03-31" })
    expect(parameters).toEqual([
      { id: "p3", type: "date/single", target: ["variable", ["template-tag", "Start"]], value: "2026-01-01" },
      { id: "p4", type: "date/single", target: ["variable", ["template-tag", "End"]], value: "2026-03-31" },
    ])
    expect(bound).toEqual([{ slug: "Start", value: "2026-01-01" }, { slug: "End", value: "2026-03-31" }])
  })

  it("treats a lone date parameter as an as-at, not a start", () => {
    // Binding the START to a single "as of" variable silently turns "up to
    // today" into "from a year ago", which is a different question entirely.
    const one = { parameters: [{ id: "d", slug: "asOf", type: "date/single", target: ["variable", ["template-tag", "asOf"]] }] }
    expect(buildDateParams(one, { from: "2026-01-01", to: "2026-03-31" }).bound).toEqual([{ slug: "asOf", value: "2026-03-31" }])
  })

  it("sends nothing for a question that takes no dates, so it runs as it always did", () => {
    expect(buildDateParams({ parameters: [{ id: "x", slug: "region", type: "string/=" }] }, { from: "2026-01-01" }))
      .toEqual({ parameters: [], bound: [] })
    expect(buildDateParams(FLS, {})).toEqual({ parameters: [], bound: [] })
  })

  it("refuses to pass a malformed date through to the warehouse", () => {
    expect(buildDateParams(FLS, { from: "last tuesday", to: "2026-03-31" }).bound)
      .toEqual([{ slug: "End", value: "2026-03-31" }])
  })
})

describe("safeRange", () => {
  const NOW = Date.parse("2026-08-30T00:00:00Z")

  it("falls back to the last year when asked for nothing", () => {
    expect(safeRange({}, NOW)).toMatchObject({ from: "2025-08-30", to: "2026-08-30", clamped: false })
  })

  it("keeps a sensible range as given", () => {
    expect(safeRange({ from: "2026-06-01", to: "2026-08-01" }, NOW)).toMatchObject({ from: "2026-06-01", to: "2026-08-01" })
  })

  it("rights an inverted range rather than returning nothing", () => {
    expect(safeRange({ from: "2026-08-01", to: "2026-06-01" }, NOW)).toMatchObject({ from: "2026-06-01", to: "2026-08-01" })
  })

  it("clamps a range no warehouse will answer inside the timeout, and says so", () => {
    const r = safeRange({ from: "2015-01-01", to: "2026-08-30" }, NOW)
    expect(r.clamped).toBe(true)
    expect(r.to).toBe("2026-08-30")
    const span = (Date.parse(r.to) - Date.parse(r.from)) / 86400000
    expect(span).toBe(MAX_RANGE_DAYS)
  })

  it("defaultRange ends today", () => {
    expect(defaultRange(NOW, 30)).toEqual({ from: "2026-07-31", to: "2026-08-30" })
  })
})
