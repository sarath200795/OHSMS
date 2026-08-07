// ─────────────────────────────────────────────────────────────────────────────
// Employee provisioning — admins create login-ready accounts (one by one or
// from a CSV). Auth users are created on a throwaway SECONDARY Firebase app so
// the admin's own session is never replaced, then the org profile is written
// with the admin's primary session (rules allow admins to provision profiles).
// New accounts get the temporary password and must change it at first login.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import Papa from 'papaparse'
import { db, firebaseClientConfig, emulatorAuthUrl } from '../firebase'
import { logAudit } from '../org/orgData'

/**
 * A one-time password for a newly provisioned account.
 *
 * This used to be the constant '12345678', shared by every account the app ever
 * created and compiled into the public bundle. Accounts are written
 * status:'approved', and the "you must change it" gate is a React route guard —
 * so anyone who could guess a colleague's work email could sign in as them
 * through the REST API, get a real token, and never load the app that was
 * supposed to stop them. The window ran from provisioning until that person's
 * first login, which for a bulk import is indefinite.
 *
 * Now: 12 bytes from the CSPRNG, base32-ish and unambiguous (no O/0/I/1), so it
 * survives being read aloud or copied off a screen. Unique per account, so
 * knowing one tells you nothing about the next.
 */
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateTempPassword() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  // Rejection-free: 256 is a multiple of 32, so the modulo is unbiased.
  const raw = Array.from(bytes, (b) => PW_ALPHABET[b % PW_ALPHABET.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

// Roles an admin may provision directly. Admins are promoted afterwards via the
// normal role management flow (and the security rules enforce this too).
export const PROVISION_ROLES = ['member', 'manager', 'auditor']

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Email is already registered',
  'auth/invalid-email': 'Invalid email address',
  'auth/weak-password': 'Temp password rejected by auth policy',
}

/** One throwaway auth instance per batch; callers must always await cleanup. */
function createProvisioningAuth() {
  const app = initializeApp(firebaseClientConfig, `provision-${Date.now()}`)
  const auth = getAuth(app)
  if (emulatorAuthUrl) connectAuthEmulator(auth, emulatorAuthUrl, { disableWarnings: true })
  return {
    auth,
    cleanup: async () => {
      await signOut(auth).catch(() => {})
      await deleteApp(app).catch(() => {})
    },
  }
}

async function createOne(auth2, { name, email, role, department }, { orgId, orgName }, actor) {
  const tempPassword = generateTempPassword()
  const cred = await createUserWithEmailAndPassword(auth2, email.trim(), tempPassword)
  await setDoc(doc(db, 'users', cred.user.uid), {
    name: (name || '').trim(),
    email: email.trim().toLowerCase(),
    orgId,
    orgName: orgName || '',
    role: PROVISION_ROLES.includes(role) ? role : 'member',
    status: 'approved',
    dept: '',
    department: department || '',
    access: { sites: [], regions: [], entities: [] },
    accessRequest: null,
    mustChangePassword: true,
    provisionedBy: actor?.name || '',
    createdAt: serverTimestamp(),
  })
  // The password goes back to the caller so the admin can hand it over. It is
  // never written to Firestore and never reaches the audit log.
  return { uid: cred.user.uid, tempPassword }
}

/** Add a single employee. Returns { uid, tempPassword } — show it once, then it is gone. */
export async function provisionEmployee(details, org, actor) {
  const { auth, cleanup } = createProvisioningAuth()
  try {
    const { uid, tempPassword } = await createOne(auth, details, org, actor)
    await logAudit(org.orgId, actor, 'user.provision', {
      target: 'user', targetId: uid, targetLabel: details.name || details.email,
      summary: `Provisioned employee ${details.email} (${details.role})`,
    })
    return { uid, tempPassword }
  } catch (e) {
    throw new Error(AUTH_ERRORS[e?.code] || e?.message || 'Could not create the account')
  } finally {
    await cleanup()
  }
}

/**
 * Bulk-provision employees over a small pool of parallel auth instances (large
 * uploads finish ~3× faster). Reports progress after each account and never
 * aborts the batch on a single failure.
 *
 * Returns { created, failed[], credentials[] }. Each password is unique now, so
 * the admin can no longer be told one password for the whole import — the
 * caller has to hand out `credentials` per person.
 */
export async function provisionEmployees(rows, org, actor, onProgress) {
  const pool = Array.from({ length: Math.min(3, Math.max(1, rows.length)) }, () => createProvisioningAuth())
  const failed = []
  const credentials = []
  let created = 0
  let done = 0
  try {
    for (let i = 0; i < rows.length; i += pool.length) {
      const chunk = rows.slice(i, i + pool.length)
      await Promise.all(
        chunk.map(async (row, j) => {
          try {
            const { tempPassword } = await createOne(pool[j].auth, row, org, actor)
            credentials.push({ name: row.name || '', email: (row.email || '').trim().toLowerCase(), tempPassword })
            created += 1
          } catch (e) {
            failed.push({ ...row, reason: AUTH_ERRORS[e?.code] || e?.message || 'Failed' })
          } finally {
            done += 1
            onProgress?.(done, rows.length)
          }
        }),
      )
    }
  } finally {
    await Promise.all(pool.map((p) => p.cleanup()))
  }
  await logAudit(org.orgId, actor, 'user.provision', {
    target: 'user',
    summary: `Bulk provisioned ${created} employee(s)${failed.length ? `, ${failed.length} failed` : ''}`,
  })
  return { created, failed, credentials }
}

// ── CSV import ────────────────────────────────────────────────────────────────
const HEADER_ALIASES = {
  name: ['name', 'employee name', 'full name', 'employee'],
  email: ['email', 'e-mail', 'mail', 'mail id', 'email id'],
  role: ['role'],
  department: ['department', 'dept'],
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const EMPLOYEES_CSV_TEMPLATE =
  'Name,Email,Role,Department\n' +
  'Ravi Menon,ravi@acme.test,member,Operation\n' +
  'Priya Nair,priya@acme.test,manager,Safety\n'

/**
 * Parse an employees CSV. Resolves { headerOk, rows, valid, invalid }; each row
 * carries __row / __errors. Role defaults to member; unknown roles are errors.
 */
export function parseEmployeesCsv(file, existingEmails = []) {
  const taken = new Set(existingEmails.map((e) => (e || '').toLowerCase()))
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const km = {}
        ;(res.meta?.fields || []).forEach((raw) => {
          const norm = String(raw).trim().toLowerCase()
          for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
            if (aliases.includes(norm)) km[key] = raw
          }
        })
        const headerOk = Boolean(km.name && km.email)
        const seen = new Set()
        const rows = (res.data || []).map((r, i) => {
          const name = (km.name ? r[km.name] : '')?.toString().trim() || ''
          const email = ((km.email ? r[km.email] : '') || '').toString().trim().toLowerCase()
          const roleRaw = ((km.role ? r[km.role] : '') || '').toString().trim().toLowerCase()
          const role = roleRaw || 'member'
          const department = (km.department ? r[km.department] : '')?.toString().trim() || ''
          const errors = []
          if (!name) errors.push('Missing name')
          if (!email) errors.push('Missing email')
          else if (!EMAIL_RE.test(email)) errors.push('Invalid email')
          else if (taken.has(email)) errors.push('Already a user in this organization')
          else if (seen.has(email)) errors.push('Duplicate email in file')
          if (roleRaw && !PROVISION_ROLES.includes(role)) errors.push(`Role must be one of: ${PROVISION_ROLES.join(', ')}`)
          seen.add(email)
          return { __row: i + 2, __errors: errors, name, email, role, department }
        })
        resolve({
          headerOk,
          rows,
          valid: rows.filter((r) => r.__errors.length === 0),
          invalid: rows.filter((r) => r.__errors.length > 0),
        })
      },
      error: reject,
    })
  })
}
