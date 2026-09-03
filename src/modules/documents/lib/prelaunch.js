// ─────────────────────────────────────────────────────────────────────────────
// The pre-launch handover checklist.
//
// Every site opens once, and the paperwork it has to produce on that day is the
// same list every time: the FLS / HO handover schedule. Before this file that
// list lived in a spreadsheet somebody mailed round, which meant the library
// could tell you a site's Pre Launch folder held four documents but never that
// it was missing thirty-one.
//
// So the list is DATA, here, and the tree renders a folder per category and a
// PLACEHOLDER per required document — a row that exists before anything is
// attached to it. An empty placeholder is the finding; a folder with four files
// in it and no list to check them against is not.
//
// ── Why the keys must never change ───────────────────────────────────────────
//
// A document filed against a checklist item stores `prelaunchKey`. That string
// is the only thing connecting a real record to the row it satisfies, so:
//
//   • a key is assigned once and never reused, even if the item is dropped;
//   • renaming an item's TITLE is free — the key does not follow the words;
//   • a new item gets the next number in its category, never a gap filled in.
//
// Getting that wrong does not throw. It silently orphans somebody's uploaded
// certificate into a document nobody is looking for, and reopens the row it
// satisfied. Hence the rule stated here rather than left to be inferred.
//
// ── What this file does not do ───────────────────────────────────────────────
//
// It does not know about folders, Firestore, or the site registry. tree.js
// builds the nodes from this list and owns their ids; the analytics tab reads
// the readiness helpers at the bottom. The dependency runs one way, the same
// way docTypes.js runs one way into tree.js.
// ─────────────────────────────────────────────────────────────────────────────

import { hasDocument } from './docTypes'

const clean = (v) => String(v ?? '').trim()

/**
 * The checklist, in the order the handover schedule lists it.
 *
 * `numeral` is the schedule's own I–VI, kept because that is how the document
 * is referred to in a handover meeting. `no` is the schedule's SI number, for
 * the same reason — neither is used as an identity, which is what `key` is for.
 *
 * `owner` and `timeline` are the schedule's columns, shown on the placeholder
 * so somebody standing in the folder knows who is meant to produce the thing
 * and by when, without going back to the spreadsheet this replaced.
 *
 * `docType` is seeded into the Add-document form where an existing type clearly
 * matches. Where none does it is left blank on purpose: a wrong type on
 * thirty-five records is worse than a field somebody has to fill in.
 *
 * `note` carries the schedule's Ref. Doc column when it says something. The
 * column reads "Link" for most rows, which means only "a link goes here" — that
 * is what the placeholder already is, so those carry no note.
 */
export const PRE_LAUNCH_CATEGORIES = [
  {
    key: 'electrical',
    numeral: 'I',
    name: 'Electrical System',
    items: [
      { key: 'electrical-01', no: '1.0', title: 'Load calculation and Sanctioned load report', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-02', no: '2.0', title: 'Load balancing report', owner: 'Project', timeline: 'HO Day', docType: 'Load Balancing' },
      { key: 'electrical-03', no: '3.0', title: 'Earth continuity test report (with P-N, N-E, P-E values)', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-04', no: '4.0', title: 'Earth pit testing report (resistance value)', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-05', no: '5.0', title: 'Fire-rated cable rating certificate', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-06', no: '6.0', title: 'Electrical work completion certificate (by authorized vendor)', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-07', no: '7.0', title: 'BLDC fan compliance certificate', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-08', no: '8.0', title: 'Illumination / lux level report', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-09', no: '9.0', title: 'UPS & Emergency power backup calculation sheet (CCTV, emergency lights, etc.)', owner: 'Project', timeline: 'HO Day', docType: 'UPS & Power Backup Calculation' },
      { key: 'electrical-10', no: '10.0', title: 'Specification and certificate for fire-rated / FRLS cables', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-11', no: '11.0', title: 'Safe installation certificate for HVAC duct cabling', owner: 'Project', timeline: 'HO Day' },
      { key: 'electrical-12', no: '12.0', title: 'Single Line Diagram (SLD)', owner: 'Project', timeline: 'HO Day', docType: 'GFC' },
    ],
  },
  {
    key: 'fas',
    numeral: 'II',
    name: 'Fire Alarm System (FAS) / Protection',
    items: [
      { key: 'fas-01', no: '13.0', title: 'FAS Layout drawing', owner: 'Project', timeline: 'HO Day', docType: 'GFC' },
      { key: 'fas-02', no: '14.0', title: 'FAS Installation and Warranty certificate', owner: 'Project', timeline: 'HO Day' },
      { key: 'fas-03', no: '15.0', title: 'FAS functional test report (manual call point, detectors, hooters, batteries)', owner: 'Project', timeline: 'HO Day' },
      { key: 'fas-04', no: '16.0', title: 'FAS OEM test reports / catalogues', owner: 'Project', timeline: 'HO Day' },
      { key: 'fas-05', no: '17.0', title: 'FE Warranty certificates', owner: 'Project', timeline: 'HO Day' },
      { key: 'fas-06', no: '18.0', title: 'FE Hydrostatic Pressure Test report (HPT Report)', owner: 'Project', timeline: 'HO Day', docType: 'HPT' },
      { key: 'fas-07', no: '19.0', title: 'Fire retardant paint test certificate', owner: 'Project', timeline: 'HO Day' },
      { key: 'fas-08', no: '20.0', title: 'Fire-rated material report (door, ply, etc.)', owner: 'Project', timeline: 'HO Day' },
    ],
  },
  {
    key: 'surveillance',
    numeral: 'III',
    name: 'Surveillance System',
    items: [
      { key: 'surveillance-01', no: '21.0', title: 'CCTV Layout drawing', owner: 'Project', timeline: 'HO Day', docType: 'GFC' },
      { key: 'surveillance-02', no: '22.0', title: 'CCTV specifications (camera count, storage capacity, backup duration, etc.)', owner: 'Project', timeline: 'HO Day' },
      { key: 'surveillance-03', no: '23.0', title: 'CCTV warranty certificates and performance test reports', owner: 'Project', timeline: 'HO Day' },
    ],
  },
  {
    key: 'elevators',
    numeral: 'IV',
    name: 'Elevators',
    items: [
      { key: 'elevators-01', no: '24.0', title: 'Lift license and registration copy', owner: 'RE/LL', timeline: 'Before Handover', note: 'As per state regulatory body' },
      { key: 'elevators-02', no: '25.0', title: 'OEM inspection and commissioning report', owner: 'RE/LL', timeline: 'Before Handover' },
      { key: 'elevators-03', no: '26.0', title: 'Emergency Rescue Device (ERD) test report', owner: 'RE/LL', timeline: 'Before Handover' },
      { key: 'elevators-04', no: '27.0', title: 'AMC Reports / Electrical safety inspection report (by certified electrical engineer)', owner: 'RE/LL', timeline: 'Before Handover' },
    ],
  },
  {
    key: 'structural',
    numeral: 'V',
    name: 'Structural Stability',
    items: [
      { key: 'structural-01', no: '28.0', title: 'Structural stability report', owner: 'Safety', timeline: 'Before Possession', note: 'SA report from the authorised vendor', docType: 'Structural Stability' },
      { key: 'structural-02', no: '29.0', title: 'Facade Installation and Warranty certificate', owner: 'Project', timeline: 'HO Day' },
    ],
  },
  {
    key: 'general',
    numeral: 'VI',
    name: 'General',
    items: [
      { key: 'general-01', no: '30.0', title: 'Civil and Interior work completion certificate', owner: 'Project', timeline: 'HO Day' },
      { key: 'general-02', no: '31.0', title: 'Toughened glass certificate', owner: 'RE/LL', timeline: 'Before Possession' },
      { key: 'general-03', no: '32.0', title: 'Swing barrier installation Report', owner: 'Project', timeline: 'HO Day' },
      { key: 'general-04', no: '33.0', title: 'Material Safety Data Sheet (MSDS)', owner: 'Project', timeline: 'HO Day', note: 'From the manufacturer', docType: 'SDS' },
      { key: 'general-05', no: '34.0', title: 'Music system work completion reports', owner: 'Project', timeline: 'HO Day' },
      { key: 'general-06', no: '35.0', title: 'Music system Testing reports', owner: 'Project', timeline: 'HO Day' },
    ],
  },
]

/** Every required document, flattened, each carrying the category it sits in. */
export const PRE_LAUNCH_ITEMS = PRE_LAUNCH_CATEGORIES.flatMap((c) =>
  c.items.map((i) => ({ ...i, categoryKey: c.key, categoryName: c.name }))
)

/** How many documents a site owes in total. The denominator of every %. */
export const PRE_LAUNCH_TOTAL = PRE_LAUNCH_ITEMS.length

export const PRE_LAUNCH_ITEM_BY_KEY = Object.fromEntries(PRE_LAUNCH_ITEMS.map((i) => [i.key, i]))
export const PRE_LAUNCH_CATEGORY_BY_KEY = Object.fromEntries(PRE_LAUNCH_CATEGORIES.map((c) => [c.key, c]))

/** The checklist item a document was filed against, or null. */
export const prelaunchItemOf = (doc) => PRE_LAUNCH_ITEM_BY_KEY[clean(doc?.prelaunchKey)] || null

// ── Readiness ────────────────────────────────────────────────────────────────
//
// Two states, not one, because they fail differently and get fixed by different
// people. A row is LOGGED when a record exists for it — somebody has been here
// — and READY only when that record can actually be opened. A library full of
// logged-but-empty rows looks complete on a count of records and is worth
// nothing at a handover, so the headline number is always the ready one.

/**
 * The document standing against each checklist item, keyed by item key.
 *
 * More than one record can name the same item — two people file the same
 * certificate, or an old one is superseded without being deleted. The one that
 * can be OPENED wins, because that is the one that answers the question; among
 * equals the first wins, which for a service that reads newest-first is the
 * most recent.
 */
export function matchPrelaunch(docs = []) {
  const byKey = new Map()
  for (const d of docs || []) {
    const key = clean(d?.prelaunchKey)
    if (!key || !PRE_LAUNCH_ITEM_BY_KEY[key]) continue
    const held = byKey.get(key)
    if (!held || (!hasDocument(held) && hasDocument(d))) byKey.set(key, d)
  }
  return byKey
}

/** A whole number percentage, and 0 rather than NaN when nothing is required. */
export const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0)

/**
 * How far one site's pre-launch pack has got.
 *
 * @param docs the documents for that site — the caller narrows, because who
 *        may see which site is decided long before this file.
 */
export function prelaunchReadiness(docs = []) {
  const matched = matchPrelaunch(docs)

  const rows = PRE_LAUNCH_ITEMS.map((item) => {
    const doc = matched.get(item.key) || null
    return { item, doc, logged: Boolean(doc), ready: Boolean(doc) && hasDocument(doc) }
  })

  const ready = rows.filter((r) => r.ready).length
  const logged = rows.filter((r) => r.logged).length

  const byCategory = PRE_LAUNCH_CATEGORIES.map((c) => {
    const mine = rows.filter((r) => r.item.categoryKey === c.key)
    const n = mine.filter((r) => r.ready).length
    return {
      key: c.key,
      name: c.name,
      numeral: c.numeral,
      total: mine.length,
      ready: n,
      logged: mine.filter((r) => r.logged).length,
      pct: pct(n, mine.length),
      rows: mine,
    }
  })

  return {
    rows,
    byCategory,
    total: PRE_LAUNCH_TOTAL,
    ready,
    logged,
    // Logged but not openable: the rows that read as done on a count of
    // records and are not. Called out because they are the ones nobody chases.
    stub: logged - ready,
    missing: PRE_LAUNCH_TOTAL - logged,
    pct: pct(ready, PRE_LAUNCH_TOTAL),
    complete: ready === PRE_LAUNCH_TOTAL,
  }
}

/** The readiness of one category, for a folder that shows only its own rows. */
export function categoryReadiness(categoryKey, docs = []) {
  const key = clean(categoryKey)
  return prelaunchReadiness(docs).byCategory.find((c) => c.key === key) || null
}
