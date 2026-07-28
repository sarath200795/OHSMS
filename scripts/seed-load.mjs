// ─────────────────────────────────────────────────────────────────────────────
// Load seed — populates the emulator with 5 000 employee profiles, 3 courses
// and thousands of training records/assignments to prove the app stays
// responsive at target scale.  Run:  node scripts/seed-load.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, addDoc, collection,
  writeBatch, serverTimestamp,
} from 'firebase/firestore'

const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const orgId = (await getDoc(doc(db, 'users', cred.user.uid))).data().orgId
const orgName = 'Acme Manufacturing'

const N_EMPLOYEES = 5000
const N_RECORDS = 4000
const N_ASSIGNMENTS = 600

const FIRST = ['Ravi', 'Priya', 'Arjun', 'Sneha', 'Vikram', 'Anita', 'Karan', 'Divya', 'Rahul', 'Meera', 'Suresh', 'Pooja', 'Amit', 'Nisha', 'Rajesh', 'Kavya', 'Sanjay', 'Lakshmi', 'Deepak', 'Riya']
const LAST = ['Menon', 'Nair', 'Sharma', 'Patel', 'Reddy', 'Iyer', 'Gupta', 'Singh', 'Das', 'Bose', 'Rao', 'Joshi', 'Kulkarni', 'Verma', 'Pillai', 'Naidu', 'Shetty', 'Kapoor', 'Malhotra', 'Chopra']
const DEPTS = ['Safety', 'Facility', 'Operation', 'Projects']

const pad = (n, w = 4) => String(n).padStart(w, '0')
const dateStr = (d) => d.toISOString().slice(0, 10)
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + m); return dateStr(d) }
const rnd = (n) => Math.floor(Math.random() * n)

// 1) Employee profiles (rules: admin may create non-admin profiles for own org).
console.log(`Creating ${N_EMPLOYEES} employee profiles…`)
let written = 0
for (let start = 0; start < N_EMPLOYEES; start += 400) {
  const batch = writeBatch(db)
  for (let i = start; i < Math.min(start + 400, N_EMPLOYEES); i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${pad(i)}`
    batch.set(doc(db, 'users', `load-emp-${pad(i)}`), {
      name,
      email: `load${pad(i)}@acme.test`,
      orgId, orgName,
      role: i % 50 === 0 ? 'manager' : 'member',
      status: 'approved',
      dept: '',
      department: DEPTS[i % DEPTS.length],
      access: { sites: [], regions: [], entities: [] },
      accessRequest: null,
      seedLoad: true,
      createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
  written = Math.min(start + 400, N_EMPLOYEES)
  process.stdout.write(`  profiles: ${written}\r`)
}
console.log(`\n  ✓ ${written} profiles`)

// 2) Courses (ensure 3 exist).
const courseCol = collection(db, 'organizations', orgId, 'trainingCourses')
const existing = (await getDocs(courseCol)).docs.map((d) => ({ id: d.id, ...d.data() }))
const wanted = [
  { name: 'Fire Safety Awareness', category: 'Fire Safety', validityMonths: 12, mandatory: true },
  { name: 'First Aid at Work', category: 'First Aid', validityMonths: 12, mandatory: true },
  { name: 'Manual Handling', category: 'Manual Handling', validityMonths: 24, mandatory: false },
]
const courses = []
for (const w of wanted) {
  const found = existing.find((c) => c.name === w.name)
  if (found) { courses.push(found); continue }
  const ref = await addDoc(courseCol, { ...w, description: '', content: [], createdAt: serverTimestamp(), createdBy: cred.user.uid, createdByName: 'Alex Admin' })
  courses.push({ id: ref.id, ...w })
}
console.log(`  ✓ ${courses.length} courses ready`)

// 3) Training records (random employee × course, past 18 months).
console.log(`Creating ${N_RECORDS} training records…`)
const recCol = collection(db, 'organizations', orgId, 'trainingRecords')
for (let start = 0; start < N_RECORDS; start += 400) {
  const batch = writeBatch(db)
  for (let i = start; i < Math.min(start + 400, N_RECORDS); i++) {
    const emp = rnd(N_EMPLOYEES)
    const c = courses[rnd(courses.length)]
    const back = rnd(540) // days back
    const completedOn = dateStr(new Date(Date.now() - back * 86400000))
    batch.set(doc(recCol), {
      courseId: c.id, courseName: c.name, category: c.category, validityMonths: c.validityMonths,
      employeeUid: `load-emp-${pad(emp)}`,
      employeeName: `${FIRST[emp % FIRST.length]} ${LAST[Math.floor(emp / FIRST.length) % LAST.length]} ${pad(emp)}`,
      trainerName: 'Acme Academy', completedOn,
      expiresOn: c.validityMonths ? addMonths(completedOn, c.validityMonths) : '',
      region: '', entity: '', siteId: '', site: '', notes: '', seedLoad: true,
      createdAt: serverTimestamp(), createdBy: cred.user.uid, createdByName: 'Alex Admin',
    })
  }
  await batch.commit()
  process.stdout.write(`  records: ${Math.min(start + 400, N_RECORDS)}\r`)
}
console.log(`\n  ✓ ${N_RECORDS} records`)

// 4) Open assignments (due dates spread ±30 days).
console.log(`Creating ${N_ASSIGNMENTS} open assignments…`)
const asnCol = collection(db, 'organizations', orgId, 'trainingAssignments')
for (let start = 0; start < N_ASSIGNMENTS; start += 400) {
  const batch = writeBatch(db)
  for (let i = start; i < Math.min(start + 400, N_ASSIGNMENTS); i++) {
    const emp = rnd(N_EMPLOYEES)
    const c = courses[rnd(courses.length)]
    const offset = rnd(60) - 30
    batch.set(doc(asnCol), {
      courseId: c.id, courseName: c.name, category: c.category,
      employeeUid: `load-emp-${pad(emp)}`,
      employeeName: `${FIRST[emp % FIRST.length]} ${LAST[Math.floor(emp / FIRST.length) % LAST.length]} ${pad(emp)}`,
      dueDate: dateStr(new Date(Date.now() + offset * 86400000)),
      status: 'assigned', assignedBy: cred.user.uid, assignedByName: 'Alex Admin',
      seedLoad: true, createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
}
console.log(`  ✓ ${N_ASSIGNMENTS} assignments`)
console.log('LOAD-SEED-DONE')
process.exit(0)
