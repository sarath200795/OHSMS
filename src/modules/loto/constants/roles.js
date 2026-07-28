// ---------------------------------------------------------------------------
// Role-Based Access Control model for HECP / LOTO operations.
// Permission keys are the single source of truth used across every phase.
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  PROCEDURE_VIEW: 'procedure.view',
  PROCEDURE_CREATE: 'procedure.create',
  PROCEDURE_REVISE: 'procedure.revise',
  PROCEDURE_SEND_FOR_APPROVAL: 'procedure.sendForApproval',
  PROCEDURE_APPROVE: 'procedure.approve',
  PROCEDURE_DELETE: 'procedure.delete',
  LOTO_PERFORM: 'loto.perform',
  USERS_MANAGE: 'users.manage',
}

// Human-readable labels for the permission toggles in the admin UI.
export const PERMISSION_LABELS = {
  [PERMISSIONS.PROCEDURE_VIEW]: 'View procedures',
  [PERMISSIONS.PROCEDURE_CREATE]: 'Create LOTO procedures',
  [PERMISSIONS.PROCEDURE_REVISE]: 'Revise procedures',
  [PERMISSIONS.PROCEDURE_SEND_FOR_APPROVAL]: 'Send for approval',
  [PERMISSIONS.PROCEDURE_APPROVE]: 'Approve procedures',
  [PERMISSIONS.PROCEDURE_DELETE]: 'Delete procedures',
  [PERMISSIONS.LOTO_PERFORM]: 'Perform LOTO actions',
  [PERMISSIONS.USERS_MANAGE]: 'Manage users',
}

export const ROLES = {
  ADMIN: 'admin',
  SAFETY: 'safety',
  ENGINEERING: 'engineering',
  TECHNICIAN: 'technician',
}

const P = PERMISSIONS

// Default permission set seeded onto a user when a role is assigned.
// An admin can then grant/revoke individual permissions beyond this default.
export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(P),
  [ROLES.SAFETY]: [
    P.PROCEDURE_VIEW,
    P.PROCEDURE_CREATE,
    P.PROCEDURE_REVISE,
    P.PROCEDURE_APPROVE,
    P.PROCEDURE_DELETE,
    P.LOTO_PERFORM,
  ],
  [ROLES.ENGINEERING]: [
    P.PROCEDURE_VIEW,
    P.PROCEDURE_CREATE,
    P.PROCEDURE_REVISE,
    P.PROCEDURE_SEND_FOR_APPROVAL,
    P.LOTO_PERFORM,
  ],
  [ROLES.TECHNICIAN]: [P.PROCEDURE_VIEW, P.LOTO_PERFORM],
}

export const ROLE_META = {
  [ROLES.ADMIN]: {
    label: 'Administrator',
    short: 'Admin',
    description: 'Full access to all modules and user management.',
    color: '#e23b2e',
    accent: 'bg-danger/15 text-danger border-danger/40',
  },
  [ROLES.SAFETY]: {
    label: 'Safety Team',
    short: 'Safety',
    description: 'Create, approve, revise & delete procedures; perform LOTO.',
    color: '#f5a800',
    accent: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  [ROLES.ENGINEERING]: {
    label: 'Engineering Team',
    short: 'Engineering',
    description: 'Create & revise procedures, send for approval, perform LOTO.',
    color: '#506f9b',
    accent: 'bg-steel-500/20 text-steel-300 border-steel-500/40',
  },
  [ROLES.TECHNICIAN]: {
    label: 'Technician',
    short: 'Technician',
    description: 'View procedures and perform LOTO actions.',
    color: '#2faa57',
    accent: 'bg-safe/15 text-safe border-safe/40',
  },
}

export const ASSIGNABLE_ROLES = [
  ROLES.SAFETY,
  ROLES.ENGINEERING,
  ROLES.TECHNICIAN,
  ROLES.ADMIN,
]

export const USER_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

/** Returns the default permissions for a role (empty array for unknown). */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []
}

/** Union of default permissions across several roles (multi-role users). */
export function permissionsForRoles(roles) {
  const set = new Set()
  ;(roles || []).forEach((r) => permissionsForRole(r).forEach((p) => set.add(p)))
  return [...set]
}

/** Normalise a profile to multi-role: ensure roles[] and admin flag. */
export function rolesOf(profile) {
  if (Array.isArray(profile?.roles) && profile.roles.length) return profile.roles
  return profile?.role ? [profile.role] : []
}

/** True when the given permission list contains the key. */
export function hasPermission(permissions, key) {
  return Array.isArray(permissions) && permissions.includes(key)
}
