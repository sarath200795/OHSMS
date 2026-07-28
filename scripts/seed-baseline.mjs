import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app); const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const orgId = (await getDoc(doc(db, 'users', cred.user.uid))).data().orgId
const ref = await addDoc(collection(db, 'organizations', orgId, 'assessments'), {
  name: 'Gym Floor Operations', kind: 'baseline', baselineId: '',
  siteName: '', region: '', entity: '', siteId: '', location: '',
  status: 'ACTIVE', refId: 'HIRA-BASE-GYM01', members: [],
  activities: [
    { id: 'a1', title: 'Free-weight training area', nature: 'Routine', hazards: [
      { id: 'h1', description: 'Manual handling of heavy plates', whoMightBeHarmed: 'Members, trainers', hazardGroup: 'Ergonomic', hazardCategory: '', hazardType: '', probability: 3, severity: 3, controls: [{ id: 'c1', hierarchy: 'Administrative', description: 'Lifting technique induction', status: 'Closed' }], alarp: false, additionalControls: [], projectedProbability: 2, projectedSeverity: 3 },
      { id: 'h2', description: 'Trip on stray equipment', whoMightBeHarmed: 'Members', hazardGroup: 'Physical', hazardCategory: '', hazardType: '', probability: 2, severity: 2, controls: [], alarp: false, additionalControls: [], projectedProbability: '', projectedSeverity: '' },
    ]},
    { id: 'a2', title: 'Cardio machines', nature: 'Routine', hazards: [
      { id: 'h3', description: 'Entanglement / fall from treadmill', whoMightBeHarmed: 'Members', hazardGroup: 'Mechanical', hazardCategory: '', hazardType: '', probability: 2, severity: 4, controls: [{ id: 'c2', hierarchy: 'Engineering', description: 'Auto-stop safety key', status: 'Closed' }], alarp: false, additionalControls: [], projectedProbability: 1, projectedSeverity: 4 },
    ]},
  ],
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
})
console.log('baseline id=' + ref.id)
process.exit(0)
