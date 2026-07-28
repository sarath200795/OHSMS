import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app); const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const orgId = (await getDoc(doc(db, 'users', cred.user.uid))).data().orgId
await updateDoc(doc(db, 'organizations', orgId), {
  activityTypes: ['Fitness & Recreation', 'Retail', 'Facilities Management'],
  locations: ['Reception', 'Gym Floor', 'Changing Rooms', 'Plant / Equipment Room', 'Car Park', 'Cafe / Kitchen'],
})
console.log('✓ Set activityTypes + 6 locations on org ' + orgId)
process.exit(0)
