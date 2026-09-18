// ─────────────────────────────────────────────────────────────────────────────
// Inventory (and optionally revoke) legacy permanent download URLs.
//
// #49 stopped minting new ones. Every URL minted before that change still
// works as a bearer credential. Revoking them means stripping
// firebaseStorageDownloadTokens from the Storage object.
//
// Doing that blind permanently breaks any pointer that has a url and no path
// — fileUrl falls back to the stored url, so killing the token leaves a record
// that cannot be opened any other way. This script classifies first:
//
//   revoke  — token + stored path. Safe: getBlob still works after the token dies.
//   review  — token, no path. Printed, never stripped.
//
// Dry by default. Nothing is revoked without --apply. --apply still refuses
// without Admin credentials, and against a live project it also needs
// CONFIRM_REVOKE=yes. Review rows are never stripped.
//
//   node scripts/inventory-download-tokens.mjs                     (emulators, dry)
//   node scripts/inventory-download-tokens.mjs --json              (same, machine-readable)
//   node scripts/inventory-download-tokens.mjs --apply             (refuses: no Admin)
//
//   VITE_USE_EMULATORS=false VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=… \
//   VITE_FIREBASE_AUTH_DOMAIN=… SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… \
//     node scripts/inventory-download-tokens.mjs --prod            (production, dry)
//
//   CONFIRM_REVOKE=yes GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/inventory-download-tokens.mjs --prod --apply    (production, writes)
//
// Operator runbook: docs/LEGACY-DOWNLOAD-URLS.md
// Read the dry run. Re-run with --apply only after the review list is empty
// or accepted as a manual backfill, not as something this script will guess.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore'
import { connect, targetIsEmulator } from './_firebase.mjs'
import {
  classifyDoc,
  planRevoke,
  planBackfill,
  runRevoke,
  assertApplyAllowed,
  FILE_POINTER_ORG_COLLECTIONS,
  FILE_POINTER_TOP_LEVEL,
  POINTER_SUBCOLLECTIONS,
} from '../src/shared/storage/legacyDownloadUrls.js'

const APPLY = process.argv.includes('--apply')
const JSON_OUT = process.argv.includes('--json')
const hasAdminCreds = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT
)
const againstLiveProject = !targetIsEmulator
const applyGate = assertApplyAllowed({
  apply: APPLY,
  hasAdminCreds,
  againstLiveProject,
  confirmRevoke: process.env.CONFIRM_REVOKE,
})

const { db, orgId } = await connect()

const list = async (name) => {
  const snap = await getDocs(collection(db, 'organizations', orgId, name))
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

const classified = []

const orgSnap = await getDoc(doc(db, 'organizations', orgId))
if (orgSnap.exists()) {
  classified.push(...classifyDoc(orgSnap.data(), { collection: 'organizations', id: orgId }))
}

// listCollections is Admin-only. Walk the named file-bearing collections plus
// every subcollection in POINTER_SUBCOLLECTIONS and the top-level LOTO maps;
// a pointer in an unnamed collection is a gap this inventory will not see,
// which is why the dry run prints the walk list.
const NAMED = [...new Set(FILE_POINTER_ORG_COLLECTIONS)]

for (const name of NAMED) {
  let docs
  try {
    docs = await list(name)
  } catch {
    continue
  }
  for (const row of docs) {
    classified.push(...classifyDoc(row.data, { collection: name, id: row.id }))
  }
}

for (const { collection: name, orgField } of FILE_POINTER_TOP_LEVEL) {
  try {
    const snap = await getDocs(query(collection(db, name), where(orgField, '==', orgId)))
    for (const d of snap.docs) {
      classified.push(...classifyDoc(d.data(), { collection: name, id: d.id }))
    }
  } catch {
    continue
  }
}

for (const { parent, sub } of POINTER_SUBCOLLECTIONS) {
  let parents
  try {
    parents = await list(parent)
  } catch {
    continue
  }
  for (const p of parents) {
    const snap = await getDocs(collection(db, 'organizations', orgId, parent, p.id, sub))
    for (const d of snap.docs) {
      classified.push(...classifyDoc(d.data(), { collection: `${parent}/${sub}`, id: d.id }))
    }
  }
}

const plan = planRevoke(classified)
const backfill = planBackfill(plan.review)
const walked = [
  'org document',
  ...NAMED,
  ...POINTER_SUBCOLLECTIONS.map((s) => `${s.parent}/${s.sub}`),
  ...FILE_POINTER_TOP_LEVEL.map((s) => `${s.collection} (top-level, ${s.orgField}=org)`),
]

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        orgId,
        dryRun: !APPLY,
        walked,
        revoke: plan.revoke.map((r) => ({ loc: r.loc, path: r.path })),
        review: plan.review.map((r) => ({ loc: r.loc, suggestedPath: r.suggestedPath || null })),
        backfill,
        skipped: plan.skipped.length,
      },
      null,
      2
    )
  )
} else {
  console.log(`\nOrg ${orgId}`)
  console.log(`Walked: ${walked.join(', ')}`)
  console.log(
    `${plan.revoke.length} pointer(s) safe to revoke (token + stored path)\n` +
      `${plan.review.length} pointer(s) for human review (token, no path)\n` +
      `${plan.skipped.length} pointer-shaped field(s) with no download token`
  )

  if (plan.revoke.length) {
    console.log('\nRevoke (token dies; getBlob via path still works):')
    plan.revoke.slice(0, 50).forEach((r) => console.log(`  ${r.loc}  ${r.path}`))
    if (plan.revoke.length > 50) console.log(`  … ${plan.revoke.length - 50} more`)
  }

  if (plan.review.length) {
    console.log('\nReview — NOT revoked. fileUrl would have nothing left to open:')
    plan.review.slice(0, 50).forEach((r) => {
      const hint = r.suggestedPath ? `  (URL names ${r.suggestedPath}; backfill path first)` : ''
      console.log(`  ${r.loc}${hint}`)
    })
    if (plan.review.length > 50) console.log(`  … ${plan.review.length - 50} more`)
  }
}

if (!APPLY) {
  if (!JSON_OUT) {
    console.log(
      '\nDry run — nothing written. Re-run with --apply to strip tokens on the revoke list only.\n' +
        (againstLiveProject
          ? 'Live project: --apply also needs CONFIRM_REVOKE=yes after you have read this output.\n'
          : '')
    )
  }
  process.exit(0)
}

if (!applyGate.ok) {
  console.error(`\n${applyGate.message}\n`)
  process.exit(1)
}

const { getStorage } = await import('firebase-admin/storage')
const { initializeApp, getApps, cert } = await import('firebase-admin/app')

if (!getApps().length) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET })
  } else {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    })
  }
}

const bucket = getStorage().bucket()
const result = await runRevoke(plan, {
  apply: true,
  stripToken: async (path) => {
    await bucket.file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: null } })
  },
})

console.log(
  `\nDone. ${result.revoked} token(s) stripped` +
    (result.failed?.length ? `, ${result.failed.length} failed` : '') +
    `. ${result.review} review row(s) left untouched.\n`
)
if (result.failed?.length) {
  result.failed.forEach((f) => console.error(`  ! ${f.path}  ${f.error}`))
  process.exit(1)
}
process.exit(0)
