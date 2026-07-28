import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, serverTimestamp } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app); const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
const uid = cred.user.uid
const orgId = (await getDoc(doc(db, 'users', uid))).data().orgId
const col = (n) => collection(db, 'organizations', orgId, n)

// 1. Upsert two sites with full details + coordinates
const sitesSnap = await getDocs(col('sites'))
const byName = {}; sitesSnap.forEach(d => byName[(d.data().name||'').toLowerCase()] = d.id)
async function upsertSite(name, data) {
  const id = byName[name.toLowerCase()]
  if (id) { await updateDoc(doc(db,'organizations',orgId,'sites',id), data); return id }
  const ref = await addDoc(col('sites'), { name, ...data, createdAt: serverTimestamp() }); return ref.id
}
const northId = await upsertSite('North Plant', { name:'North Plant', region:'North', entity:'Acme Mfg', address:'Gelderd Rd, Leeds, UK', lat:53.7833, lng:-1.5766, firstAidBoxes:4 })
const southId = await upsertSite('South Warehouse', { name:'South Warehouse', region:'South', entity:'Acme Logistics', address:'Avonmouth, Bristol, UK', lat:51.5045, lng:-2.6997, firstAidBoxes:2 })

// 2. Equipment matched by region+entity
const mk = (n, region, entity, extra) => addDoc(col(n), { region, entity, status:'healthy', deletedAt:null, createdAt:serverTimestamp(), ...extra })
for (let i=1;i<=6;i++) await mk('extinguishers','North','Acme Mfg',{ serialNumber:`EXT-N-${i}`, type:'ABC', capacity:'6 Kg' })
for (let i=1;i<=2;i++) await mk('extinguishers','South','Acme Logistics',{ serialNumber:`EXT-S-${i}`, type:'CO2', capacity:'4.5 Kg' })
for (let i=1;i<=2;i++) await mk('aeds','North','Acme Mfg',{ serialNumber:`AED-N-${i}` })

// 3. Incidents whose location matches "North Plant"
const inc = (type, category, capa=[]) => addDoc(col('incidents'), { refNo:`IRA-S-${Math.floor(Math.random()*9999)}`, lifecycle:'investigation', deletedAt:null, type, category, location:'North Plant - Bay 1', capa, createdAt:serverTimestamp(), createdByName:'Alex Admin' })
await inc('reportable','fire_explosion', [{ id:'a1', title:'Install fire blanket', status:'open' }, { id:'a2', title:'Retrain staff', status:'in_progress' }])
await inc('property_damage','vehicle', [{ id:'a3', title:'Repair barrier', status:'closed' }])
await inc('near_miss','slip_trip_fall')
await inc('first_aid','manual_handling', [{ id:'a4', title:'Provide lifting aid', status:'open' }])

// 4. Map the admin to North Plant
await updateDoc(doc(db,'users',uid), { siteId: northId, siteName: 'North Plant' })

console.log(`✓ Sites seeded. North(${northId}) 6 ext + 2 aed + 4 incidents; South(${southId}) 2 ext. Admin mapped to North Plant.`)
process.exit(0)
