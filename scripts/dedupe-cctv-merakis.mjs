// ─────────────────────────────────────────────────────────────────────────────
// Remove the duplicate Meraki records an older provisioning run left behind.
//
// Why this is required rather than tidy-up: darkSites() only marks a site dark
// when EVERY Meraki on it is offline — deliberately, so a site with two real
// switches is still carried by the second one. A duplicate placeholder sitting
// at `unknown` therefore stands in as a switch that is permanently fine, and
// the site never goes dark however bad the network gets. Until these are gone,
// the affected sites are silently excluded from the one number the CCTV module
// exists to produce.
//
// Deliberately timid, because the two mistakes here are not equal. Leaving a
// duplicate costs another day of a site that cannot be reported dark: bad,
// visible, fixable. Deleting the wrong record destroys the IP, serial and
// defect history somebody typed in, and Firestore has no undo. So only an
// UNTOUCHED record is ever removed — no IP, no serial, no model, no defects,
// never reported up or down, still carrying the note provisioning wrote. A site
// whose records all hold information is REPORTED and left alone; a person has
// to decide which switch is real, and this script is not that person.
//
// Dry by default. Nothing is deleted without --apply.
//
//   node scripts/dedupe-cctv-merakis.mjs                     (emulators, dry)
//   node scripts/dedupe-cctv-merakis.mjs --apply             (emulators, writes)
//
//   VITE_USE_EMULATORS=false VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=… \
//   VITE_FIREBASE_AUTH_DOMAIN=… SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… \
//     node scripts/dedupe-cctv-merakis.mjs --prod            (production, dry)
//     node scripts/dedupe-cctv-merakis.mjs --prod --apply    (production, writes)
//
// Read the dry run before you pass --apply. It names every document it would
// delete and every site it is refusing to touch.
// ─────────────────────────────────────────────────────────────────────────────
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore'
import { connect } from './_firebase.mjs'
import { sitesWithDuplicateMerakis, redundantMerakis } from '../src/modules/cctv/lib/provision.js'

const APPLY = process.argv.includes('--apply')
const BATCH = 400

const { db, orgId } = await connect()

const read = async (name) => {
  const snap = await getDocs(collection(db, 'organizations', orgId, name))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

const [merakis, sites] = await Promise.all([read('cctvMeraki'), read('sites')])
console.log(`\n${merakis.length} Meraki record(s) across ${sites.length} site(s) in org ${orgId}`)

const duplicated = sitesWithDuplicateMerakis(merakis, sites)
if (!duplicated.length) {
  console.log('\nNo site carries more than one Meraki. Nothing to do.\n')
  process.exit(0)
}

const doomed = []
const blocked = []

for (const { siteId, siteName, devices } of duplicated) {
  const { remove, keep, blocked: needsPerson } = redundantMerakis(devices, siteId)
  const describe = (m) =>
    [
      m.name || '(unnamed)',
      m.ipAddress || 'no IP',
      m.serial ? `serial ${m.serial}` : 'no serial',
      m.model || 'no model',
      `status ${m.status || 'unknown'}`,
      m.defects?.length ? `${m.defects.length} defect(s)` : null,
    ]
      .filter(Boolean)
      .join(' · ')

  if (needsPerson) {
    blocked.push({ siteName, devices })
    console.log(`\n! ${siteName} — ${devices.length} records, EVERY one of them filled in. Left alone:`)
    devices.forEach((m) => console.log(`    ${m.id}  ${describe(m)}`))
    continue
  }

  console.log(`\n· ${siteName} — keeping ${keep.length}, removing ${remove.length}`)
  keep.forEach((m) => console.log(`    keep    ${m.id}  ${describe(m)}`))
  remove.forEach((m) => {
    console.log(`    remove  ${m.id}  ${describe(m)}`)
    doomed.push({ id: m.id, siteName })
  })
}

console.log(
  `\n${'─'.repeat(70)}\n` +
    `${duplicated.length} site(s) carry duplicates. ` +
    `${doomed.length} placeholder record(s) can go; ` +
    `${blocked.length} site(s) need a person to choose.`
)

if (blocked.length) {
  console.log(
    '\nThe sites above marked ! hold more than one record with real content in it.\n' +
      'Open the CCTV inventory, decide which switch is real, and delete the other\n' +
      'there — the information in it is not something this script can weigh.'
  )
}

if (!doomed.length) {
  console.log('\nNothing to delete automatically.\n')
  process.exit(0)
}

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --apply to delete those ${doomed.length}.\n`)
  process.exit(0)
}

for (let i = 0; i < doomed.length; i += BATCH) {
  const batch = writeBatch(db)
  doomed.slice(i, i + BATCH).forEach((d) => {
    batch.delete(doc(db, 'organizations', orgId, 'cctvMeraki', d.id))
  })
  await batch.commit()
  console.log(`  deleted ${Math.min(i + BATCH, doomed.length)}/${doomed.length}`)
}

console.log(
  `\nDone. ${doomed.length} placeholder(s) removed.\n` +
    'Those sites can now be reported dark when their switch goes offline.\n'
)
process.exit(0)
