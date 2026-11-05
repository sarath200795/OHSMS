import { describe, it, expect } from 'vitest'
import { AUDIT, diffSummary } from './audit'

// The action strings written onto /auditLogs. Admin → Audit Log filters on the
// raw string, so renaming one is a behaviour change even though nothing in the
// UI imports this object by key. The user-admin keys that used to live beside
// these (`user.status`, `user.role`, `org.settings`, `org.backup`) were a second
// vocabulary: the live writers are shared/audit/audit.js and use `.update`.
describe('incident audit actions', () => {
  it('keeps the strings the incident, illness, injury and action writers emit', () => {
    expect(AUDIT).toEqual({
      INCIDENT_CREATE: 'incident.create',
      INCIDENT_UPDATE: 'incident.update',
      INCIDENT_STEP: 'incident.step',
      INCIDENT_CLOSE: 'incident.close',
      INCIDENT_DELETE: 'incident.delete',
      INCIDENT_RESTORE: 'incident.restore',
      INCIDENT_PURGE: 'incident.purge',
      ILLNESS_CREATE: 'illness.create',
      ILLNESS_UPDATE: 'illness.update',
      ILLNESS_CLOSE: 'illness.close',
      ILLNESS_DELETE: 'illness.delete',
      ILLNESS_RESTORE: 'illness.restore',
      ILLNESS_PURGE: 'illness.purge',
      ACTION_UPDATE: 'action.update',
      INJURY_SYNC: 'injury.sync',
      INJURY_UPDATE: 'injury.update',
      INJURY_VERIFY: 'injury.verify',
      INJURY_UNVERIFY: 'injury.unverify',
      INJURY_DELETE: 'injury.delete',
      INJURY_RESTORE: 'injury.restore',
      INJURY_PURGE: 'injury.purge',
    })
  })
})

describe('diffSummary', () => {
  it('reports a plaintext field as old → new', () => {
    expect(diffSummary({ severity: 'low' }, { severity: 'high' })).toBe('severity: low → high')
  })

  it('names a sealed field without copying either value into the audit log', () => {
    // isEnvelope requires the real wire shape (key id, 16-char iv, 22+ ciphertext),
    // not a string that merely starts with "enc:".
    const envelope = `enc:1:general.1:${'A'.repeat(16)}:${'A'.repeat(22)}`
    expect(diffSummary({ exposedToAgent: envelope }, { exposedToAgent: 'solvent' })).toBe(
      'exposedToAgent: changed'
    )
    expect(diffSummary({ exposedToAgent: 'solvent' }, { exposedToAgent: envelope })).toBe(
      'exposedToAgent: changed'
    )
  })

  it('ignores a tracked field the edit did not send', () => {
    expect(diffSummary({ severity: 'low', type: 'near_miss' }, { type: 'near_miss' })).toBe('')
  })
})
