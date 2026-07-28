import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc, collection } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app); const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const uid = cred.user.uid
const orgId = (await getDoc(doc(db, 'users', uid))).data().orgId
const snap = await getDocs(collection(db, 'organizations', orgId, 'illnesses'))
const target = snap.docs.find((d) => (d.data().refNo || '') === 'ILL-2026-9001') || snap.docs[0]
if (!target) { console.log('NO-ILLNESS-FOUND'); process.exit(0) }
await updateDoc(doc(db, 'organizations', orgId, 'illnesses', target.id), {
  actions: [
    { id: 'ill-act-1', kind: 'corrective', description: 'Fit local exhaust ventilation at the paint booth', ownerUid: '', ownerName: 'Ravi Menon', dueDate: '2026-08-10', status: 'open', closedAt: null },
    { id: 'ill-act-2', kind: 'corrective', description: 'Retrain staff on respirator fit-testing', ownerUid: '', ownerName: 'Alex Admin', dueDate: '2026-07-20', status: 'in_progress', closedAt: null },
  ],
})
console.log('ILLNESS-ACTIONS-ADDED to', target.id)
