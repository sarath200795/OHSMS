// ─────────────────────────────────────────────────────────────────────────────
// Platform ownership — who operates the product, as distinct from who
// administers a tenant inside it.
//
// The grant is the existence of /platformAdmins/{uid}. No client operation can
// create, edit or delete one; the only ways in are the Firebase console and the
// Admin SDK, both of which already require project-level access. That is the
// point. An org admin edits /users for their own tenant every day, so a role or
// a claim derived from a role would be a grant they could reach.
//
// The check below is presentation only. It decides whether to offer the
// console; the rules decide whether the writes it makes are accepted. Someone
// who patched this to return true would get a page whose every save is refused.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export const PLATFORM_ADMINS_COLLECTION = 'platformAdmins'

export const platformAdminRef = (uid) => doc(db, PLATFORM_ADMINS_COLLECTION, uid)

/**
 * Watch whether `uid` holds the platform grant. Calls back with a boolean, and
 * with `false` on any read failure — the safe direction for a check that opens
 * a screen.
 *
 * Reading your OWN document is allowed even when it does not exist, so the
 * normal case for the overwhelming majority of users is a clean "not found"
 * rather than a permission error in the console.
 */
export function subscribePlatformAdmin(uid, cb) {
  if (!uid) {
    cb(false)
    return () => {}
  }
  return onSnapshot(
    platformAdminRef(uid),
    (snap) => cb(snap.exists()),
    () => cb(false)
  )
}
