// ─────────────────────────────────────────────────────────────────────────────
// Canonical audit action keys. Every mutation across every module logs one of
// these to /organizations/{orgId}/auditLogs (append-only). Keeping them in one
// place makes the unified Audit Log viewer filterable and consistent.
// ─────────────────────────────────────────────────────────────────────────────
export const AUDIT = {
  // Org / user administration
  ORG_SETTINGS: 'org.settings.update',
  USER_STATUS: 'user.status.update',
  USER_ROLE: 'user.role.update',
  USER_INVITE: 'user.invite',
  SITE_CREATE: 'site.create',
  SITE_UPDATE: 'site.update',
  SITE_DELETE: 'site.delete',

  // Generic record lifecycle (used by every module with { target } set)
  CREATE: 'record.create',
  UPDATE: 'record.update',
  STATUS: 'record.status',
  CLOSE: 'record.close',
  DELETE: 'record.delete',
  RESTORE: 'record.restore',

  // CAPA / actions
  ACTION_CREATE: 'action.create',
  ACTION_UPDATE: 'action.update',
  ACTION_CLOSE: 'action.close',
}

// Human labels for the audit-log viewer.
export const AUDIT_LABEL = {
  [AUDIT.ORG_SETTINGS]: 'Updated org settings',
  [AUDIT.USER_STATUS]: 'Changed user status',
  [AUDIT.USER_ROLE]: 'Changed user role',
  [AUDIT.USER_INVITE]: 'Invited user',
  [AUDIT.SITE_CREATE]: 'Created site',
  [AUDIT.SITE_UPDATE]: 'Updated site',
  [AUDIT.SITE_DELETE]: 'Deleted site',
  [AUDIT.CREATE]: 'Created',
  [AUDIT.UPDATE]: 'Updated',
  [AUDIT.STATUS]: 'Changed status',
  [AUDIT.CLOSE]: 'Closed',
  [AUDIT.DELETE]: 'Deleted',
  [AUDIT.RESTORE]: 'Restored',
  [AUDIT.ACTION_CREATE]: 'Created action',
  [AUDIT.ACTION_UPDATE]: 'Updated action',
  [AUDIT.ACTION_CLOSE]: 'Closed action',
}

export const auditLabel = (action) => AUDIT_LABEL[action] || action
