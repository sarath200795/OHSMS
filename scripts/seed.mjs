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
  getFirestore, connectFirestoreEmulator, doc, setDoc, addDoc, collection,
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

  const orgRef = doc(collection(db, 'organizations'))
  const orgId = orgRef.id
  const batch = writeBatch(db)
  batch.set(orgRef, { name: ORG, nameLower: ORG.toLowerCase(), createdBy: uid, notificationEmail: ADMIN.email, createdAt: serverTimestamp() })
  batch.set(doc(db, 'users', uid), { name: ADMIN.name, email: ADMIN.email, orgId, orgName: ORG, role: 'admin', status: 'approved', createdAt: serverTimestamp() })
  batch.set(doc(db, 'orgIndex', ORG.toLowerCase()), { orgId, name: ORG })
  await batch.commit()

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
