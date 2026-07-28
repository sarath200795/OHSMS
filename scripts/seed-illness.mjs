import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, serverTimestamp } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app); const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const uid = cred.user.uid
const orgId = (await getDoc(doc(db, 'users', uid))).data().orgId
const ref = doc(collection(db, 'organizations', orgId, 'illnesses'))
await setDoc(ref, {
  refNo: 'ILL-2026-9001', lifecycle: 'actions', stagesDone: { initial: true, actions: false }, deletedAt: null,
  affectedPersonnel: [{ kind: 'internal', name: 'Ravi Menon', id: 'EMP-210' }],
  date: '2026-07-18', time: '09:00', location: 'Paint shop', site: 'North Plant',
  exposedToAgent: 'Isocyanate vapour', exposureDuration: '3 hours', ppe: ['Respirator'],
  healthIssue: 'Occupational asthma — chest tightness and coughing after exposure.',
  affectedBodyParts: ['lung', 'chest', 'face'], fileCount: 0, actions: [],
  createdBy: uid, createdByName: 'Alex Admin', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
})
console.log('illness id=' + ref.id + ' org=' + orgId)
process.exit(0)
