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

  // ── Emergency equipment ────────────────────────────────────────────────────
  //
  // The largest module in the app had no fixture at all, so its four dashboards
  // seeded to empty and every e2e assertion about them was really an assertion
  // about the empty state. Enough rows here to exercise the real thing: each
  // register has more than one row, so a lowered VITE_TEST_READ_CAP trips it and
  // e2e/capped-reads.spec.js can prove the "these figures are incomplete" notice
  // is actually wired to the page rather than merely existing.
  const nextYear = daysFromNow(300).toISOString().slice(0, 10)
  await add('extinguishers', { serialNo: 'FE-0001', type: 'CO2', capacity: '4.5kg', centerName: 'North Plant', region: 'North', entity: '1P', status: 'active', nextRefillDate: nextYear, nextHptDate: nextYear })
  await add('extinguishers', { serialNo: 'FE-0002', type: 'DCP', capacity: '9kg', centerName: 'South Warehouse', region: 'South', entity: '1P', status: 'active', nextRefillDate: nextYear, nextHptDate: nextYear })
  await add('extinguishers', { serialNo: 'FE-0003', type: 'Foam', capacity: '9L', centerName: 'North Plant', region: 'North', entity: '2P', status: 'to_be_refilled', nextRefillDate: daysFromNow(-5).toISOString().slice(0, 10), nextHptDate: nextYear })

  await add('aeds', { assetId: 'AED-0001', brand: 'Zoll', centerName: 'North Plant', region: 'North', entity: '1P', status: 'ready', batteryExpiry: nextYear, padExpiry: nextYear, nextInspection: nextYear })
  await add('aeds', { assetId: 'AED-0002', brand: 'Philips', centerName: 'South Warehouse', region: 'South', entity: '1P', status: 'ready', batteryExpiry: nextYear, padExpiry: nextYear, nextInspection: nextYear })

  await add('fas', { deviceId: 'FAS-0001', deviceType: 'Control Panel', zone: 'Zone 1', centerName: 'North Plant', region: 'North', entity: '1P', status: 'operational', nextService: nextYear })
  await add('fas', { deviceId: 'FAS-0002', deviceType: 'Smoke Detector', zone: 'Zone 2', centerName: 'South Warehouse', region: 'South', entity: '1P', status: 'operational', nextService: nextYear })

  await add('signages', { centerName: 'North Plant', region: 'North', entity: '1P', type: 'Fire Extinguisher Sign', location: 'Bay 3', condition: 'OK', quantity: 2 })
  await add('signages', { centerName: 'South Warehouse', region: 'South', entity: '1P', type: 'Assembly Point Signage', location: 'Car park', condition: 'OK', quantity: 1 })

  await add('mockDrills', { scenario: 'Fire', centerName: 'North Plant', date: daysFromNow(-20).toISOString().slice(0, 10), time: '10:00', commander: ADMIN.name, score: 88 })
  await add('mockDrills', { scenario: 'Medical Emergency', centerName: 'South Warehouse', date: daysFromNow(-8).toISOString().slice(0, 10), time: '14:30', commander: ADMIN.name, score: 72 })

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

  // ── The live permit ───────────────────────────────────────────────────────
  // The permit and its public mirror are built from ONE object, and that is the
  // whole point of the shape below.
  //
  // They used to be two hand-written literals: a permit carrying no hazards and
  // no crew, beside a mirror announcing two hazards and four people. Nothing
  // read the two together, so nothing noticed they disagreed — until the app
  // regenerated the mirror from the permit and the disagreement resolved itself
  // the only way it could, in favour of the permit. Which was empty.
  //
  // The regeneration is ordinary behaviour, not a bug. PermitContext auto-
  // expires permits whose stored status has drifted, and reconcilePermitStatus
  // rewrites the mirror's display half through liveFields(permit) on the way
  // past. A permit created through the app carries its own hazards and crew, so
  // the rewrite is a no-op there. Only this fixture claimed things its own
  // permit could not support, so only this fixture lost them — which is why the
  // two public-permit smoke tests failed intermittently rather than always:
  // they were racing a background write that blanked the very cards they assert.
  //
  // Counts are computed from the arrays here for the same reason crewSummary()
  // computes them from the arrays there. A literal `participantCount: 3` beside
  // a three-element list is a number that can go stale on its own.
  const liveWork = {
    hazards: ['Hot work', 'Working at height'],
    ppe: ['Face shield'],
    precautions: ['Fire watch'],
    jsa: [],
    // Names live on the permit, behind sign-in. The mirror gets counts only —
    // publishing a roster to an unauthenticated URL is the exposure the counts
    // exist to prevent, and the smoke suite asserts that difference.
    participants: [{ name: 'Jordan Kim' }, { name: 'Priya Raman' }, { name: 'Tom Okafor' }],
    fireWatchers: [{ name: 'Dev Sharma' }],
    confinedWatcher: null,
  }

  const livePermit = await add('permits', {
    permitNo: 'PTW-E2E-LIVE', typeOfWork: 'Hot Work', site: 'North Plant',
    jobLocation: 'Bay 3 mezzanine', jobDescription: 'Welding a handrail section.',
    issuingDepartment: 'Engineering', issuedToName: 'Jordan Kim',
    qrToken: 'e2e-live-permit',
    ...liveWork,
    validFrom: iso(-1), validTo: iso(1),
    // Both approved and inside its window derives to IN_PROGRESS. Storing that
    // is what stops the auto-expire effect firing at all: it only writes when
    // the stored status has drifted from the live one, and an absent field
    // drifts from everything.
    storedStatus: 'in_progress',
    engineering: { status: 'approved' }, operations: { status: 'approved' },
  })
  await setDoc(doc(db, 'permitQr', 'e2e-live-permit'), mirror('e2e-live-permit', {
    permitId: livePermit.id, permitNo: 'PTW-E2E-LIVE', docId: 'PTW-0001',
    jobLocation: 'Bay 3 mezzanine', jobDescription: 'Welding a handrail section.',
    issuingDepartment: 'Engineering', issuedToName: 'Jordan Kim',
    hazards: liveWork.hazards, ppe: liveWork.ppe, precautions: liveWork.precautions,
    jsa: liveWork.jsa,
    participantCount: liveWork.participants.length,
    fireWatcherCount: liveWork.fireWatchers.length,
    hasConfinedWatcher: Boolean(liveWork.confinedWatcher),
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
    // Long past its window derives to NOT_CLOSED. Stored for the same reason as
    // the live one: so nothing reconciles it in the background mid-suite. Its
    // display fields need no such care — a permit this stale regenerates to
    // withdrawnFields either way, which is exactly what the mirror below says.
    storedStatus: 'not_closed',
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
