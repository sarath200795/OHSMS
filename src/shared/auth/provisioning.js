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

export const TEMP_PASSWORD = '12345678'

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
  const cred = await createUserWithEmailAndPassword(auth2, email.trim(), TEMP_PASSWORD)
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
  return cred.user.uid
}

/** Add a single employee. Throws with a friendly message on failure. */
export async function provisionEmployee(details, org, actor) {
  const { auth, cleanup } = createProvisioningAuth()
  try {
    const uid = await createOne(auth, details, org, actor)
    await logAudit(org.orgId, actor, 'user.provision', {
      target: 'user', targetId: uid, targetLabel: details.name || details.email,
      summary: `Provisioned employee ${details.email} (${details.role})`,
    })
    return uid
  } catch (e) {
    throw new Error(AUTH_ERRORS[e?.code] || e?.message || 'Could not create the account')
  } finally {
    await cleanup()
  }
}

/**
 * Bulk-provision employees over a small pool of parallel auth instances (large
 * uploads finish ~3× faster). Reports progress after each account and never
 * aborts the batch on a single failure. Returns { created, failed[] }.
 */
export async function provisionEmployees(rows, org, actor, onProgress) {
  const pool = Array.from({ length: Math.min(3, Math.max(1, rows.length)) }, () => createProvisioningAuth())
  const failed = []
  let created = 0
  let done = 0
  try {
    for (let i = 0; i < rows.length; i += pool.length) {
      const chunk = rows.slice(i, i + pool.length)
      await Promise.all(
        chunk.map(async (row, j) => {
          try {
            await createOne(pool[j].auth, row, org, actor)
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
  return { created, failed }
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
