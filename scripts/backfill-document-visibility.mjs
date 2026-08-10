// ─────────────────────────────────────────────────────────────────────────────
// Stamp `visibility` onto documents written before site scoping existed.
//
// Why this is required rather than tidy-up: the security rule treats a missing
// `visibility` as 'all', so the back catalogue stays READABLE without this. But
// a member's library is now fetched with `where('visibility','==','all')`, and
// that filter does not match a document where the field is absent. So without
// the backfill the old documents are permitted and never asked for — they would
// simply stop appearing, for members only, with nothing on screen to say why.
//
// Everything here is deliberately conservative:
//   · only documents with NO visibility field are touched
//   · every one of them becomes 'all', which is exactly the access they have
//     today — this migration must not narrow anything, only record what is
//   · a site-level document that already resolves to a site is stamped 'site'
//     and given the region/entity the rule reads, because those were never
//     written before either
//
//   node scripts/backfill-document-visibility.mjs            (emulators)
//   node scripts/backfill-document-visibility.mjs --dry-run
//   VITE_USE_EMULATORS=false … node scripts/backfill-document-visibility.mjs --prod
// ─────────────────────────────────────────────────────────────────────────────
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore'
import { connect } from './_firebase.mjs'

const DRY = process.argv.includes('--dry-run')
const BATCH = 400

const clean = (v) => String(v ?? '').trim()

const { db, orgId } = await connect()

const sitesSnap = await getDocs(collection(db, 'organizations', orgId, 'sites'))
const sites = new Map(sitesSnap.docs.map((d) => [d.id, d.data()]))

const snap = await getDocs(collection(db, 'organizations', orgId, 'documents'))
console.log(`\n${snap.size} document(s) in org ${orgId}`)

const pending = []
for (const d of snap.docs) {
  const data = d.data()
  if (clean(data.visibility)) continue // already stamped — leave it alone

  const siteId = clean(data.siteId)
  const isSite = clean(data.level) === 'site' && siteId !== ''
  const site = isSite ? sites.get(siteId) : null

  // Every field the rule touches is written, not just `visibility`. The rule
  // reads them directly — it has to, or it stops constraining list queries —
  // and direct access to a field that is not there errors, which denies. A
  // half-stamped document would be one nobody but an admin could open.
  pending.push({
    id: d.id,
    title: clean(data.title) || '(untitled)',
    patch: isSite
      ? {
          visibility: 'site',
          siteRegion: clean(site?.region),
          siteEntity: clean(site?.entity),
        }
      : { visibility: 'all', siteId: siteId, siteRegion: '', siteEntity: '' },
  })
}

if (!pending.length) {
  console.log('Nothing to do — every document already carries a visibility.\n')
  process.exit(0)
}

const restricted = pending.filter((p) => p.patch.visibility === 'site')
console.log(`\n${pending.length} to stamp: ${pending.length - restricted.length} org-wide, ${restricted.length} site-scoped`)
restricted.forEach((p) => {
  const where = [p.patch.siteRegion, p.patch.siteEntity].filter(Boolean).join(' / ') || 'no region or entity on the site'
  console.log(`  · ${p.title} → site (${where})`)
})

if (DRY) {
  console.log('\n--dry-run: nothing written.\n')
  process.exit(0)
}

for (let i = 0; i < pending.length; i += BATCH) {
  const batch = writeBatch(db)
  pending.slice(i, i + BATCH).forEach((p) => {
    batch.update(doc(db, 'organizations', orgId, 'documents', p.id), p.patch)
  })
  await batch.commit()
  console.log(`  committed ${Math.min(i + BATCH, pending.length)}/${pending.length}`)
}

console.log('\nDone.\n')
process.exit(0)
