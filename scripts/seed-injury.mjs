// Adds one incident-ira incident WITH an injury report (body parts) so the
// body-part map in the printable report can be verified. Requires emulators.
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, serverTimestamp,
} from 'firebase/firestore'

const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const uid = cred.user.uid
const orgId = (await getDoc(doc(db, 'users', uid))).data().orgId

const ref = doc(collection(db, 'organizations', orgId, 'incidents'))
await setDoc(ref, {
  refNo: 'IRA-2026-9001',
  lifecycle: 'investigation',
  stagesDone: { initial: true, team: true, investigation: false, capa: false, horizontal: false },
  deletedAt: null,
  incidentDate: '2026-07-20',
  incidentTime: '14:30',
  type: 'lost_time',
  severity: 'high',
  category: 'contact_with_machinery',
  location: 'Assembly line 2',
  narrative: 'Operator caught hand in conveyor guard while clearing a jam.',
  probableCause: 'Guard interlock bypassed',
  affectedPersonnel: [{ kind: 'internal', name: 'Priya Nair', id: 'EMP-104' }],
  photoCount: 0,
  injuryReports: [
    {
      personId: 'EMP-104',
      personName: 'Priya Nair',
      firstAidDone: true,
      firstAidDetail: 'Wound dressed on site',
      injuryType: 'Laceration',
      bodyParts: ['hand_l', 'wrist_l', 'arm_l', 'head'],
      medication: 'Analgesic',
      daysToReturnToWork: 5,
    },
  ],
  team: [],
  investigations: [],
  capa: [],
  horizontal: { required: null, locations: [], details: '', completedAt: null },
  createdBy: uid,
  createdByName: 'Alex Admin',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
})

console.log(`✓ Added incident IRA-2026-9001 (id=${ref.id}) with an injury (hand/wrist/arm/head) in org ${orgId}`)
process.exit(0)
