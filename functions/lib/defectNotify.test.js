import { describe, it, expect } from 'vitest'
import {
  planDefectReport,
  planAssetDefects,
  reportCoversAssetDefect,
  deliverDefectReport,
  deliverAssetDefects,
} from './defectNotify.js'
import { memoryDb, mailer, user } from '../test-support/memoryDb.js'

const SEALED = 'enc:1:general:abcdefghijklmnop:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function people() {
  return [
    user('admin', { role: 'admin' }),
    user('posted', { siteId: 's1' }),
    user('region', { access: { regions: ['South'] } }),
    user('entity', { access: { entities: ['COCO'] } }),
    user('blank', { access: { regions: [''] } }),
    user('manager', { role: 'manager' }),
    user('other', { siteId: 's9' }),
    user('samebox', { email: 'posted@example.com', role: 'admin' }),
    user('suspended', { role: 'admin', status: 'suspended', email: 'off@example.com' }),
  ]
}

const ext = {
  siteId: 's1',
  region: '',
  entity: '',
  serialNo: 'SN-9',
  centerName: 'Plant 2',
}

describe('which writes are a defect', () => {
  it('plans a new extinguisher, AED and FAS report, and ignores the rest', () => {
    expect(
      planDefectReport(null, {
        kind: 'defect',
        defectType: 'pin',
        extId: 'e1',
        note: 'pin missing',
      }).assetKind
    ).toBe('extinguisher')
    expect(
      planDefectReport(null, {
        kind: 'asset_defect',
        assetKind: 'aed',
        assetRefId: 'a1',
        defect: 'Pads Expired',
      }).summary
    ).toBe('Pads Expired')
    expect(
      planDefectReport(null, {
        kind: 'asset_defect',
        assetKind: 'fas',
        assetRefId: 'f1',
        defect: 'Hooter Not Working',
      }).assetKind
    ).toBe('fas')
    expect(
      planDefectReport(
        { kind: 'defect' },
        { kind: 'defect', defectType: 'pin', approvalStatus: 'approved' }
      )
    ).toBeNull()
    expect(planDefectReport(null, { kind: 'status_change', newStatus: 'closed' })).toBeNull()
    expect(
      planDefectReport(null, { kind: 'asset_defect', assetKind: 'stretcher', defect: 'Torn' })
    ).toBeNull()
  })

  it('plans a new open defect on an existing asset, not a create and not a repeat', () => {
    expect(planAssetDefects('extinguishers', null, { physicalDefects: ['pin'] }, 'e1')).toEqual([])
    const added = planAssetDefects(
      'extinguishers',
      { physicalDefects: [] },
      { physicalDefects: ['pin'], updatedAt: { seconds: 10 } },
      'e1'
    )
    expect(added.map((p) => p.defectKey)).toEqual(['pin'])
    expect(added[0].stamp).toBe('10')
    expect(
      planAssetDefects(
        'extinguishers',
        { physicalDefects: ['pin'] },
        { physicalDefects: ['pin'] },
        'e1'
      )
    ).toEqual([])
    expect(
      planAssetDefects('aeds', { status: 'ready' }, { status: 'out_of_service' }, 'a1').map(
        (p) => p.summary
      )
    ).toEqual(['Out of service'])
    expect(
      planAssetDefects('fas', { status: 'operational' }, { status: 'faulty' }, 'f1')
    ).toHaveLength(1)
    expect(planAssetDefects('fas', { status: 'faulty' }, { status: 'faulty' }, 'f1')).toEqual([])
  })

  it('treats a non-rejected report as already owning the asset write', () => {
    const plan = { assetKind: 'extinguisher', assetId: 'e1', defectKey: 'pin' }
    expect(
      reportCoversAssetDefect(
        [{ kind: 'defect', extId: 'e1', defectType: 'pin', approvalStatus: 'pending' }],
        plan
      )
    ).toBe(true)
    expect(
      reportCoversAssetDefect(
        [{ kind: 'defect', extId: 'e1', defectType: 'pin', approvalStatus: 'rejected' }],
        plan
      )
    ).toBe(false)
    expect(
      reportCoversAssetDefect(
        [{ kind: 'asset_defect', assetKind: 'aed', assetRefId: 'a1', approvalStatus: 'approved' }],
        { assetKind: 'aed', assetId: 'a1', defectKey: 'out_of_service' }
      )
    ).toBe(true)
  })
})

describe('deliver defect mail', () => {
  const logger = { info() {}, error() {} }

  function db() {
    return memoryDb({
      'organizations/orgA/extinguishers/e1': ext,
      'organizations/orgA/sites/s1': { name: 'Plant 2', region: 'South', entity: 'COCO' },
      'organizations/orgA/aeds/a1': {
        siteId: 's1',
        region: 'South',
        entity: 'COCO',
        assetId: 'AED-4',
      },
    })
  }

  it('mails the scoped audience once, dedupes a shared mailbox, and fills region from the site', async () => {
    const sent = []
    const result = await deliverDefectReport({
      db: db(),
      orgId: 'orgA',
      docId: 'r1',
      before: null,
      after: {
        kind: 'defect',
        defectType: 'pin',
        extId: 'e1',
        extLabel: 'SN-9',
        note: 'pin missing',
      },
      mailer: mailer(sent),
      logger,
      users: people(),
    })
    // admin and samebox share posted@example.com? samebox email is posted@example.com
    // posted is posted@example.com from user() default `${uid}@example.com` = posted@example.com
    // samebox email override is posted@example.com. Lowest uid is admin vs samebox vs posted.
    // They don't all share one address. posted@example.com is posted and samebox.
    // admin is admin@example.com. region, entity have their own.
    // blank and manager and other do not match. suspended no.
    // Deduped: samebox and posted share posted@example.com. uid localeCompare: posted > samebox?
    // 'posted' vs 'samebox': 'p' < 's' so posted wins?
    // 'posted'.localeCompare('samebox') is negative so posted sorts first and wins the mailbox.
    // Recipients: admin, entity, posted (beats samebox), region. manager no, other no, blank no, suspended no.
    expect(result.sent).toBe(4)
    const tos = sent.map((m) => m.to).sort()
    expect(tos).toEqual([
      'admin@example.com',
      'entity@example.com',
      'posted@example.com',
      'region@example.com',
    ])
    expect(sent[0].text).toContain('PIN')
    expect(sent[0].text).toContain('Region: South')
    expect(sent[0].html).toContain('https://suite.weehs.org/equipment/approvals')
    const again = await deliverDefectReport({
      db: db(),
      orgId: 'orgA',
      docId: 'r1',
      before: null,
      after: { kind: 'defect', defectType: 'pin', extId: 'e1' },
      mailer: mailer(sent),
      logger,
      users: people(),
    })
    // fresh db, so this is not the idempotency case. Use one db below.
    expect(again.sent).toBe(4)
  })

  it('is idempotent for the same report and does not claim when unconfigured', async () => {
    const sent = []
    const store = db()
    const args = {
      db: store,
      orgId: 'orgA',
      docId: 'r1',
      before: null,
      after: { kind: 'defect', defectType: 'empty', extId: 'e1', note: SEALED },
      mailer: mailer(sent),
      logger,
      users: [user('admin', { role: 'admin' })],
    }
    expect((await deliverDefectReport(args)).sent).toBe(1)
    expect((await deliverDefectReport(args)).skipped).toBe(1)
    expect(sent).toHaveLength(1)
    const blob = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`
    expect(blob).not.toContain('enc:')
    expect(blob).toContain('Sealed — open the record in the app')

    const quiet = memoryDb({ 'organizations/orgA/extinguishers/e1': ext })
    const skipped = await deliverDefectReport({
      ...args,
      db: quiet,
      mailer: mailer([], { pass: '' }),
    })
    expect(skipped.reason).toBe('not-configured')
    expect(quiet.notifications()).toHaveLength(0)
  })

  it('does not mail an asset transition that a report already covers', async () => {
    const sent = []
    const store = db()
    store.store.set('organizations/orgA/reports/r1', {
      kind: 'defect',
      extId: 'e1',
      defectType: 'pin',
      approvalStatus: 'approved',
    })
    const result = await deliverAssetDefects({
      db: store,
      orgId: 'orgA',
      docId: 'e1',
      collection: 'extinguishers',
      before: { physicalDefects: [] },
      after: { physicalDefects: ['pin'], updatedAt: { seconds: 4 }, ...ext },
      mailer: mailer(sent),
      logger,
      users: people(),
    })
    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(sent).toHaveLength(0)
  })

  it('mails a direct defect that has no report, and a retry does not', async () => {
    const sent = []
    const store = db()
    const args = {
      db: store,
      orgId: 'orgA',
      docId: 'e1',
      collection: 'extinguishers',
      before: { physicalDefects: [] },
      after: { physicalDefects: ['hose_pipe'], updatedAt: { seconds: 8 }, ...ext },
      mailer: mailer(sent),
      logger,
      users: [user('admin', { role: 'admin' }), user('manager', { role: 'manager' })],
    }
    expect((await deliverAssetDefects(args)).sent).toBe(1)
    expect(sent[0].text).toContain('Hose pipe damage')
    expect(sent[0].html).toContain('/equipment/physical-defects')
    expect((await deliverAssetDefects(args)).skipped).toBe(1)
    expect(sent).toHaveLength(1)
  })

  it('caps the fan-out at 100', async () => {
    const sent = []
    const crowd = Array.from({ length: 101 }, (_, i) =>
      user(`u${String(i).padStart(3, '0')}`, { role: 'admin', email: `u${i}@example.com` })
    )
    const result = await deliverDefectReport({
      db: db(),
      orgId: 'orgA',
      docId: 'r-cap',
      before: null,
      after: {
        kind: 'asset_defect',
        assetKind: 'aed',
        assetRefId: 'a1',
        defect: 'Battery Discharged',
      },
      mailer: mailer(sent),
      logger,
      users: crowd,
    })
    expect(result.sent).toBe(100)
    expect(result.skipped).toBe(1)
    expect(sent).toHaveLength(100)
  })
})
