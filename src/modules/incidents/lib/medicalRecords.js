// ─────────────────────────────────────────────────────────────────────────────
// The FILES attached to an injury report — a GP letter, a fit note, a discharge
// summary — and the only place they are written or read.
//
// They used to be filed as incidents/{id}/photos with kind: 'medical_record',
// beside a photograph of a damaged guard rail. An ISO 27001 audit found what
// that meant: the generic {sub=**} at the bottom of firestore.rules grants
// `read` — get AND list — on that subtree to every approved member and to the
// external auditor, so one getDocs returned the filename, caption, size and
// download URL of every medical record in the tenant. A `kind` field could not
// close it, because rules cannot filter which documents a list returns; the
// COLLECTION had to differ.
//
// So they live at injuries/{injuryId}/records/{recordId}, nested under the
// collection that already holds the clinical fields (injuries.js). Two things
// follow, and both are the reason for the nesting rather than a new top-level
// name:
//
//   · The exclusion is free and permanent. `col` binds to 'injuries' for this
//     whole subtree, and 'injuries' is already excluded from the generic read
//     AND from its recursive wildcard. A new top-level collection would have to
//     be added to both lists, and one added to one list is the hole shipped.
//   · The PATH is the person key. injuryId is `${incidentId}__${personId}`, so
//     a record cannot be stored without being attributable. The old shape put
//     personId in a field the writer never persisted — see addIncidentPhoto's
//     ten named fields — which is why Step 1a's list was empty for everyone
//     while the files themselves were listable by everyone.
//
// Two further things this module does NOT do, deliberately:
//
//   · No `url`. getDownloadURL mints a permanent unauthenticated bearer link
//     that works from any browser, signed in or not, forever, and keeps working
//     after the holder leaves the organization — no rule is ever consulted. A
//     pointer carrying one IS the access, and every rule protecting the pointer
//     evaluates to nothing for anyone who copied the string. Only `path` is
//     stored; readers resolve it through useFileUrl → getBlob, an authenticated
//     request storage.rules actually decides.
//   · Its own Storage kind. putFile(orgId, 'medical-records', …) rather than
//     'incident-photos': storage.rules is a permissive union too, and the narrow
//     grant there is worth nothing unless the bytes sit at a path the generic
//     match can exclude. A medical record uploaded under the photo prefix is
//     byte-identical to a scene photo and indistinguishable to any rule.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../shared/firebase'
import { putFile, removeFile, MAX_INLINE_BYTES, tooLargeForInline } from '../../../shared/storage'
// Sealed under the MEDICAL class — the hybrid keypair — so the member who
// attaches a colleague's discharge summary cannot open it afterwards. That is
// what firestore.rules and storage.rules already claim about this collection
// and could not enforce against anyone holding the object itself.
import { sealDoc, openSnapshots } from '../../../shared/crypto'

/** The policy key for this collection. See src/shared/crypto/policy.js. */
const SEALED = 'injuries/records'

/**
 * The injury document id, and therefore the path a record hangs off.
 *
 * Defined HERE rather than in injuries.js so the import runs one way:
 * injuries.js needs it to clean up records when it deletes an injury, and this
 * module must not import injuries.js back. Kept identical to injuryDocId() in
 * functions/lib/incidentMedical.js, which joins the same two collections from
 * the other side.
 */
export const injuryDocId = (incidentId, personId) => `${incidentId}__${personId}`

/**
 * The Storage prefix. A literal, exported, and used by exactly one caller —
 * because the value is load-bearing: storage.rules excludes this exact string
 * from its generic `allow read: if inOrg(orgId)` and grants it narrowly
 * underneath. The hyphen survives storagePath()'s seg() sanitiser byte-identical
 * (it allows [A-Za-z0-9_-]); a kind with any other punctuation would be rewritten
 * on the way to the bucket and land outside the match that protects it.
 */
export const MEDICAL_RECORD_KIND = 'medical-records'

const injuryCol = (orgId) => collection(db, 'organizations', orgId, 'injuries')
const recordCol = (orgId, injuryId) =>
  collection(db, 'organizations', orgId, 'injuries', injuryId, 'records')
const recordRef = (orgId, injuryId, recordId) =>
  doc(db, 'organizations', orgId, 'injuries', injuryId, 'records', recordId)

/**
 * File a medical record against one injured person.
 *
 * Throws without a personId rather than storing the file somewhere it can still
 * be found. The path IS the key: there is no "unattributed medical record"
 * location, and inventing one would recreate exactly the state the old shape
 * left behind — files nobody could join to a person, sitting in a collection
 * everybody could list.
 */
export async function addMedicalRecord(orgId, incidentId, personId, file = {}) {
  if (!incidentId || !personId) {
    throw new Error('A medical record has to be filed against a person on an incident.')
  }
  // Cloud first, exactly as incident photos do it — but under this module's own
  // kind, which is what makes the bytes addressable by storage.rules.
  // `collection` names the POLICY, not the Storage prefix. The two are separate
  // vocabularies — MEDICAL_RECORD_KIND is a path segment storage.rules matches
  // on, SEALED is the Firestore collection the pointer lands in — and putFile
  // must not guess one from the other, or a file gets sealed under the wrong
  // key class while every path and rule still looks right.
  const up = file.dataUrl
    ? await putFile(orgId, MEDICAL_RECORD_KIND, file.dataUrl, file.name, { collection: SEALED })
    : null
  // No bucket: the file would be written base64 INSIDE this document, and
  // Firestore rejects anything over 1MB with an error nobody can act on. Refuse
  // it here with a sentence that says what to do instead.
  //
  // Note what the fallback means for this collection in particular: under it the
  // "pointer" IS the medical record, and storage.rules never runs. That is one
  // more reason the boundary had to be the collection rather than a `kind`
  // field — Firestore rules are the only control left on that path.
  if (!up && file.dataUrl && (file.size || 0) > MAX_INLINE_BYTES) {
    throw new Error(tooLargeForInline(file.name))
  }
  const ref = await addDoc(recordCol(orgId, injuryDocId(incidentId, personId)), await sealDoc(orgId, SEALED, {
    name: file.name || '',
    // NOT sealed, deliberately: the reader needs the real content type to
    // rebuild a Blob the browser will render, and a MIME type says nothing
    // about whose record it is. The bytes it describes are sealed; this is the
    // label on the envelope, not what is inside it.
    type: file.type || '',
    dataUrl: up ? '' : file.dataUrl || '',
    // No `url`. See the header: a stored getDownloadURL outlives the reader's
    // employment and answers to no rule.
    path: up?.path || '',
    size: file.size || 0,
    caption: file.caption || '',
    // Both denormalised although the path already carries them, because a
    // purge or a retention sweep reads the document, not the path it was found
    // at — and a record that cannot say which incident it belongs to survives
    // the incident it documents.
    incidentId,
    personId,
    uploadedBy: file.uploadedBy || '',
    uploadedAt: serverTimestamp(),
    // How to open the OBJECT: scheme, key id, IV and the wrapped content key,
    // as putFile returned them. On the pointer rather than prepended to the
    // bytes so a reader refused the key learns it from this document instead of
    // after downloading eight megabytes they cannot open — and so the object in
    // the bucket is exactly the length of its ciphertext. Absent when the file
    // was stored inline or before sealing was switched on, which is what
    // isSealedFile() tests.
    ...(up?.encIv ? {
      encScheme: up.encScheme,
      encKeyId: up.encKeyId,
      encIv: up.encIv,
      ...(up.encWrapped ? { encWrapped: up.encWrapped } : {}),
    } : {}),
  }))
  return ref.id
}

/**
 * Watch every medical record on one incident, keyed by person.
 *
 * One listener per injured person, because the records are nested per injury and
 * a collectionGroup query would need its own rules match — a second grant on the
 * same data, and the one that is easiest to write too wide. Incidents have one
 * or two injured people; this is not the query to optimise.
 *
 * `onError` is not optional in practice. A member may WRITE these and not read
 * them back (isWriterOf vs isManagerOf), so a refusal is the NORMAL outcome for
 * the role that files most of them — and an onSnapshot with no error callback
 * throws an uncaught permission-denied instead of telling the screen anything.
 * That is the defect in subscribeIncidentPhotos this module refuses to repeat.
 */
export function subscribeMedicalRecords(orgId, incidentId, personIds = [], cb, onError) {
  const ids = [...new Set((personIds || []).filter(Boolean))]
  if (!orgId || !incidentId || ids.length === 0) {
    cb({})
    return () => {}
  }

  const byPerson = {}
  let failed = false
  const emit = () => { if (!failed) cb({ ...byPerson }) }

  // One opener per person, each with its own sequence guard, so a slow batch
  // for one person cannot deliver stale rows over a newer batch for the same
  // one. Ordering ACROSS people does not matter — they are separate keys in
  // `byPerson` — which is why a single shared guard would be wrong here.
  const openers = Object.fromEntries(ids.map((personId) => [
    personId,
    openSnapshots(orgId, SEALED, (rows) => { byPerson[personId] = rows; emit() }),
  ]))

  const unsubs = ids.map((personId) => onSnapshot(
    query(recordCol(orgId, injuryDocId(incidentId, personId)), orderBy('uploadedAt', 'asc')),
    (snap) => openers[personId](snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      // One refusal condemns the whole set on purpose. Showing the two people
      // whose listener happened to succeed would read as "these are all the
      // records", which is the confusion this module exists to prevent.
      failed = true
      cb({})
      onError?.(err)
    },
  ))

  return () => unsubs.forEach((u) => u())
}

/** Remove one record and the object behind it. Manager-only at both surfaces. */
export async function deleteMedicalRecord(orgId, incidentId, personId, recordId) {
  const injuryId = injuryDocId(incidentId, personId)
  // The document is the only thing that remembers the Storage path — read it
  // before deleting it, or the object is orphaned in the bucket with nothing
  // left pointing at it (audit A.8.10).
  try {
    const snap = await getDoc(recordRef(orgId, injuryId, recordId))
    if (snap.data()?.path) await removeFile(snap.data().path)
  } catch { /* orphan tolerated — the pointer must still go */ }
  await deleteDoc(recordRef(orgId, injuryId, recordId))
}

/**
 * Destroy every record under one injury, files included.
 *
 * Deleting a Firestore document does NOT delete its subcollections, so an
 * injury doc removed without this leaves a medical record alive in a collection
 * no query in the product can reach — undeletable through the UI and invisible
 * to the retention sweep. Returns the number of documents removed so callers can
 * report it.
 */
export async function deleteInjuryRecords(orgId, injuryId) {
  if (!orgId || !injuryId) return 0
  const snap = await getDocs(recordCol(orgId, injuryId))
  for (const d of snap.docs) {
    if (d.data()?.path) await removeFile(d.data().path)
    await deleteDoc(d.ref)
  }
  return snap.docs.length
}

/**
 * Every medical record belonging to one incident, destroyed.
 *
 * purgeIncident used to reach these for free: they lived in the subcollection it
 * already emptied. They do not any more, and a confinement fix that leaves
 * health documents alive forever after the incident is purged is an A.8.10
 * finding traded for an A.8.3 one.
 *
 * The injury documents themselves are left alone — a verified injury report
 * outliving its incident is existing behaviour and a separate decision — but
 * their attachments go, because the Recycle Bin's 30-day promise is about the
 * data, and the files ARE the data.
 */
export async function purgeIncidentMedicalRecords(orgId, incidentId) {
  const injuries = await getDocs(query(injuryCol(orgId), where('incidentId', '==', incidentId)))
  let removed = 0
  for (const d of injuries.docs) removed += await deleteInjuryRecords(orgId, d.id)
  return removed
}
