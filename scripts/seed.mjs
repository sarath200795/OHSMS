// ─────────────────────────────────────────────────────────────────────────────
// Demo seed — populates the Firebase EMULATORS with one organization, an admin
// user, and sample records across modules so the app looks alive on first run.
//
//   npm run emulators           # in one terminal (needs Java)
//   npm run seed                # in another
//
// Then sign in with  admin@acme.test  /  password123
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, addDoc, setDoc, collection,
  serverTimestamp, writeBatch, getDocs,
} from 'firebase/firestore'

const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const ADMIN = { email: 'admin@acme.test', password: 'password123', name: 'Alex Admin' }
const ORG = 'Acme Manufacturing'

const daysFromNow = (n) => new Date(Date.now() + n * 86400000)

async function main() {
  // 1. Admin + organization (mirrors orgData.createOrganization)
  let uid
  try {
    const cred = await createUserWithEmailAndPassword(auth, ADMIN.email, ADMIN.password)
    uid = cred.user.uid
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(auth, ADMIN.email, ADMIN.password)
      uid = cred.user.uid
    } else throw e
  }

  // ── Reuse the organization this admin already belongs to ──────────────────
  //
  // This used to mint a fresh org id on every run and re-point the admin's
  // profile at it. That works exactly once. On the second run the profile
  // already exists, so the write is an UPDATE, and self-update pins `orgId`
  // (SECURITY.md S-10 — a member must not be able to move themselves between
  // tenants). The seed was refused.
  //
  // CI never noticed because its emulator is always brand new. A developer
  // re-seeding a running emulator got PERMISSION_DENIED listing a dozen rule
  // line numbers, none of which say "you have already seeded this one".
  const meRef = doc(db, 'users', uid)
  const existing = await getDoc(meRef)
  let orgId = existing.exists() ? existing.data()?.orgId || null : null

  if (orgId) {
    console.log(`  Reusing existing organization ${orgId} — re-seeding adds samples to it.`)
  } else {
    const orgRef = doc(collection(db, 'organizations'))
    orgId = orgRef.id
    const batch = writeBatch(db)
    batch.set(orgRef, { name: ORG, nameLower: ORG.toLowerCase(), createdBy: uid, notificationEmail: ADMIN.email, createdAt: serverTimestamp() })
    batch.set(meRef, { name: ADMIN.name, email: ADMIN.email, orgId, orgName: ORG, role: 'admin', status: 'approved', createdAt: serverTimestamp() })
    batch.set(doc(db, 'orgIndex', ORG.toLowerCase()), { orgId, name: ORG })
    await batch.commit()
  }

  const add = (col, data) =>
    addDoc(collection(db, 'organizations', orgId, col), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: uid, createdByName: ADMIN.name,
    })

  // 2. Sample records
  await add('sites', { name: 'North Plant', location: 'Leeds, UK' })
  await add('sites', { name: 'South Warehouse', location: 'Bristol, UK' })

  await add('incidents', { title: 'Forklift near-miss at loading bay', type: 'Near-miss', severity: 'High', category: 'Vehicle', site: 'North Plant', location: 'Bay 3', narrative: 'Pedestrian crossed forklift path.', status: 'investigating' })
  await add('incidents', { title: 'Minor laceration in packing', type: 'First-aid', severity: 'Low', category: 'Contact with machinery', site: 'South Warehouse', status: 'closed' })
  await add('incidents', { title: 'Chemical splash to eye', type: 'Reportable', severity: 'Critical', category: 'Exposure to substance', site: 'North Plant', status: 'reported' })

  await add('riskAssessments', { title: 'Working at height — mezzanine', activity: 'Stock picking at height', site: 'South Warehouse', hazard: 'Fall from mezzanine edge', likelihood: '3', severity: '4', riskScore: 12, riskLevel: 'High', riskTone: 'red', status: 'assessed' })
  await add('riskAssessments', { title: 'Manual handling — goods-in', activity: 'Lifting pallets', site: 'North Plant', hazard: 'Musculoskeletal injury', likelihood: '2', severity: '2', riskScore: 4, riskLevel: 'Low', riskTone: 'green', status: 'controlled' })

  await add('inspections', { title: 'Monthly fire-safety inspection', area: 'Whole site', site: 'North Plant', inspector: 'Sam Lee', scheduledDate: daysFromNow(3).toISOString().slice(0, 10), status: 'scheduled' })
  await add('permits', { title: 'Hot work — pipe welding', permitType: 'Hot Work', requestedBy: 'Contractor A', site: 'North Plant', validFrom: daysFromNow(0).toISOString().slice(0, 10), validTo: daysFromNow(1).toISOString().slice(0, 10), status: 'active' })
  await add('trainingRecords', { title: 'Working at Height', employee: 'Jordan Kim', trainer: 'SafetyCo', completedDate: daysFromNow(-350).toISOString().slice(0, 10), expiryDate: daysFromNow(15).toISOString().slice(0, 10), status: 'completed' })
  await add('documents', { title: 'Lockout/Tagout Policy', docType: 'Policy', version: '2.1', owner: 'HSE Manager', reviewDate: daysFromNow(-10).toISOString().slice(0, 10), status: 'active' })

  await addDoc(collection(db, 'organizations', orgId, 'auditLogs'), { at: serverTimestamp(), actorUid: uid, actorName: ADMIN.name, action: 'record.create', module: 'core', target: 'org', summary: 'Seeded demo organization' })

  // ── Public QR mirrors, with tokens the e2e suite can actually scan ─────────
  //
  // Until these existed, both public-surface e2e tests pointed at a made-up
  // token and asserted "code not recognised". That passes just as happily when
  // the page is broken for EVERY token, which is the failure it was written
  // after: the comment in smoke.spec.js records that a non-resolving public
  // page was a real shipped bug, and the test written in response covered only
  // the not-found branch.
  //
  // Two permits, because the interesting behaviour is the difference between
  // them (SECURITY.md S-20):
  //
  //   live      inside its window — a stranger at the barrier sees the job,
  //             the location, the hazards and who it was issued to.
  //   withdrawn long past its window — the same page must still answer, and
  //             must no longer describe the job or name anybody.
  //
  // Fixed tokens rather than random ones: the e2e suite navigates to these URLs
  // by hand, and a seeded value nobody can predict is a value nobody can visit.
  const iso = (n) => daysFromNow(n).toISOString()
  const mirror = (token, extra) => ({
    orgId, orgName: ORG, token,
    site: 'North Plant', typeOfWork: 'Hot Work',
    engineering: { status: 'approved' }, operations: { status: 'approved' },
    closure: null, extension: null, closedDueToObservation: null,
    updatedAt: serverTimestamp(),
    ...extra,
  })

  const livePermit = await add('permits', {
    permitNo: 'PTW-E2E-LIVE', typeOfWork: 'Hot Work', site: 'North Plant',
    jobLocation: 'Bay 3 mezzanine', jobDescription: 'Welding a handrail section.',
    issuedToName: 'Jordan Kim', qrToken: 'e2e-live-permit',
    validFrom: iso(-1), validTo: iso(1),
    engineering: { status: 'approved' }, operations: { status: 'approved' },
  })
  await setDoc(doc(db, 'permitQr', 'e2e-live-permit'), mirror('e2e-live-permit', {
    permitId: livePermit.id, permitNo: 'PTW-E2E-LIVE', docId: 'PTW-0001',
    jobLocation: 'Bay 3 mezzanine', jobDescription: 'Welding a handrail section.',
    issuingDepartment: 'Engineering', issuedToName: 'Jordan Kim',
    hazards: ['Hot work', 'Working at height'], ppe: ['Face shield'], precautions: ['Fire watch'],
    jsa: [], participantCount: 3, fireWatcherCount: 1, hasConfinedWatcher: false,
    withdrawn: false, storedStatus: 'in_progress', validFrom: iso(-1), validTo: iso(1),
  }))

  // Blanked exactly as withdrawnFields() writes it. The permit number, site,
  // type and status survive so a scan says "this is over" rather than 404 —
  // a 404 reads as a wrong code and sends someone hunting for a permit that
  // did its job properly.
  const stalePermit = await add('permits', {
    permitNo: 'PTW-E2E-OLD', typeOfWork: 'Hot Work', site: 'North Plant',
    jobLocation: 'Bay 1', jobDescription: 'Long-finished pipe weld.',
    issuedToName: 'Sam Lee', qrToken: 'e2e-stale-permit',
    validFrom: iso(-400), validTo: iso(-399),
    engineering: { status: 'approved' }, operations: { status: 'approved' },
  })
  await setDoc(doc(db, 'permitQr', 'e2e-stale-permit'), mirror('e2e-stale-permit', {
    permitId: stalePermit.id, permitNo: 'PTW-E2E-OLD', docId: 'PTW-0002',
    jobLocation: '', jobDescription: '', issuingDepartment: '', issuedToName: '',
    hazards: [], ppe: [], precautions: [], jsa: [],
    participantCount: 0, fireWatcherCount: 0, hasConfinedWatcher: false,
    withdrawn: true, storedStatus: 'not_closed', validFrom: iso(-400), validTo: iso(-399),
  }))

  // sanity read
  const snap = await getDocs(collection(db, 'organizations', orgId, 'incidents'))
  console.log(`✓ Seeded "${ORG}" (orgId=${orgId}) with ${snap.size} incidents + samples across modules.`)
  console.log(`  Sign in:  ${ADMIN.email}  /  ${ADMIN.password}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
