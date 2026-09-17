// ─────────────────────────────────────────────────────────────────────────────
// The documents a brand-new organization is made of, as plain objects.
//
// createOrganization is the write. This is the payload, kept separate so a
// test can see that every registry module is seeded as a placeholder without
// standing up Firestore — and so the batch cannot quietly drop that write
// the next time someone edits the function.
// ─────────────────────────────────────────────────────────────────────────────
import { placeholderEntitlementFields } from '../modules/placeholders'

export function organizationCreatePayload({ orgName, address, uid, name, email }) {
  return {
    org: {
      name: orgName,
      nameLower: orgName.trim().toLowerCase(),
      address: address || '',
      createdBy: uid,
      notificationEmail: email,
    },
    user: {
      name,
      email,
      orgName,
      role: 'admin',
      status: 'approved',
      dept: '',
    },
    entitlement: placeholderEntitlementFields({ uid, email }),
  }
}
