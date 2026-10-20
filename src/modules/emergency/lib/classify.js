// ─────────────────────────────────────────────────────────────────────────────
// Is this place actually an emergency service, and is it the nearest one?
//
// Neither provider's category is trustworthy on its own. Measured against live
// data around Leeds, Bristol, Hyderabad and Bengaluru:
//
//   • Google types "Leeds District Police HQ" as government_office (right place,
//     wrong type) and "British Fire Services Association" as fire_station
//     (wrong place, right type) — so the type is unreliable both ways.
//   • Restricting to the primary type made it worse: Bristol then returned
//     "Sheonagh Scott Therapy" as the nearest hospital.
//   • Searching by distance alone returned a pharmacy ("shree shyam medical and
//     general store"), an occupational-health clinic, a fire-safety trade body
//     and police housing ("A&B Block 128 Police Quarters") as the nearest
//     emergency contacts.
//
// A later pass then preferred a station that publishes a phone over the
// station that is actually closest. Around Manyata Tech Park that stored
// Baptist Hospital (3.5 km, the nearest one with a number) instead of
// J M J Hospital (0.7 km), and Bharthinagar Police Station (6.1 km, the only
// one in range with a number) instead of Amrutahalli Police Station (2.7 km).
// By road the hospital gap was 1.6 km versus 6.1 km — the phone was not a
// tie-break, it was a different facility. The number is kept when the nearest
// place publishes one, and left blank when it does not.
//
// The name is still what rejects a vendor. Each category has:
//   STRONG  — unmistakably the real thing ("Hunslet Fire Station", "Hospitals")
//   DEMOTE  — the real thing, but a specialty or non-emergency unit
//   WEAK    — a clinic, or a bare "police"/"fire" word: usable only when
//             nothing of the real type was tagged nearby
//   REJECT  — cannot answer an emergency call
// A place the map already tagged as this amenity is accepted even when its
// name is in a local script or has no English category word ("AIIMS",
// "Care Health"). The reject list still applies — a tag does not rescue a
// pharmacy.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = {
  police: {
    strong:
      /\bpolice\s*(station|headquarters|hq|post|outpost|out\s*post|chowki|control room)\b|\b(thana|kotwali|chowki|outpost)\b/i,
    weak: /\bpolice\b|\bgarda\b|\bsheriff\b/i,
    // Real stations, but not the general emergency desk. Still a police
    // facility — ranked with the others by distance, and flagged so the note
    // can say what kind of unit it is.
    demote: /\btraffic\b|\btransport\b|\brailway\b|\bwomen'?s?\b|\bcyber\b|\btourist\b/i,
    // Housing, welfare bodies and museums carry "police" in the name but no duty officer.
    reject:
      /\b(quarters?|colony|housing|apartment|association|academy|training|museum|memorial|welfare|society|canteen|club|ground|school|college|hospital|band|store|shop|residency)\b/i,
  },
  fire_station: {
    // "Fire St." is the abbreviation on some station buildings, not a street.
    strong:
      /\bfire\s*(station|brigade|service|services|department|dept)\b|\bfire\s+st\.?\b|\bfire\s*(and|&)\s*(rescue|emergency)\b/i,
    weak: /\bfire\b|\brescue\b/i,
    // Vendors and trade bodies dominate a plain "fire" search. A police
    // station mistagged as a fire station is not a fire station.
    reject:
      /\b(association|systems?|solutions?|private\s*limited|pvt|ltd|inc|equipment|extinguisher\w*|supplies|supplier\w*|engineering|consultan\w*|contractor\w*|training|academy|alarm\w*|protection\s*co|safety\s*office|insurance|museum|police\s*station)\b/i,
  },
  hospital: {
    // "Hospitals" (plural) is how a lot of Indian facilities are named.
    // `\bhospital\b` does not match it, which is how "Shree Manyata Hospitals"
    // was dropped and a farther one kept.
    strong:
      /\b(hospitals?|medical\s*colleges?|emergency\s*(centre|center|room|ward)|casualt(y|ies)|a\s*&\s*e|trauma\s*(centre|center)|infirmar(y|ies))\b/i,
    weak: /\b(clinic|medical\s*(centre|center)|health\s*(centre|center)|nursing\s*home|dispensary|surgery)\b/i,
    // A specialty hospital is still a hospital. It is flagged, not skipped
    // in favour of a general hospital further away.
    demote:
      /\b(mental\s*health|psychiatr\w*|paediatric\w*|pediatric\w*|children'?s?|maternity|obstetric\w*|eye|ent|cancer|oncolog\w*|orthopaed\w*|orthoped\w*|cardiac|heart|neuro\w*|kidney|renal|dialysis|chest|tb|ayush|rehab\w*)\b/i,
    // Pharmacies, labs and single-speciality practices cannot take an emergency.
    // Stems carry \w* so "ayurved" also catches "Ayurveda"; a trailing \b alone
    // would not match the inflected forms these names actually use.
    reject:
      /\b(pharmac\w*|chemist\w*|medical\s*store|general\s*store|optician\w*|optical|dental|dentist\w*|skin\s*care|aesthetic\w*|cosmetic\w*|ayurved\w*|homoeopath\w*|homeopath\w*|unani|siddha|naturopath\w*|physiotherap\w*|therapy|therapist|diagnostic\w*|patholog\w*|scan\s*(centre|center)|laborator\w*|lab|veterinar\w*|pet\s*(clinic|hospital)|fertility|ivf|slimming|wellness|spa|occupational)\b/i,
  },
}

const EMPTY = { ok: false, strong: false, rank: -1, limited: false }

function classifyOne(n, rules) {
  if (rules.reject.test(n)) return { ...EMPTY, rejected: true }
  const isStrong = rules.strong.test(n)
  const isWeak = rules.weak.test(n)
  const isDemote = rules.demote?.test(n) || false
  // A clinic is not a hospital, even when the name also carries a specialty
  // word ("Children's Clinic"). Weak-only matches stay a fallback.
  if (isWeak && !isStrong) return { ok: true, strong: false, rank: 0, limited: false }
  if (isStrong && isDemote) return { ok: true, strong: false, rank: 1, limited: true }
  if (isStrong) return { ok: true, strong: true, rank: 2, limited: false }
  if (isDemote) return { ok: true, strong: false, rank: 1, limited: true }
  return { ...EMPTY }
}

/**
 * Classify a place name for a category.
 * Returns { ok, strong, rank, limited }.
 *   rank 2 — a general station / hospital
 *   rank 1 — the real type, specialty or non-emergency unit (`limited`)
 *   rank 0 — a weak fallback (clinic, a bare "police" word)
 *   ok false — never offer it
 *
 * `opts.names` — every name the map has (local script, name:en). Any reject
 * wins; otherwise the strongest reading wins.
 * `opts.tagged` — the source already classified the feature as this amenity.
 * A tagged place with no English category word is still that amenity.
 */
export function classifyPlace(name, amenity, opts = {}) {
  const rules = RULES[amenity]
  const names = (Array.isArray(opts.names) && opts.names.length ? opts.names : [name])
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 3)
  if (!rules || !names.length) return { ...EMPTY }

  let best = null
  for (const n of names) {
    const one = classifyOne(n, rules)
    if (one.rejected) return { ...EMPTY }
    if (!best || one.rank > best.rank) best = one
  }
  if (best && best.rank >= 0) return best
  if (opts.tagged) return { ok: true, strong: true, rank: 2, limited: false }
  return { ...EMPTY }
}

/** A station or hospital, not a clinic and not a vendor. */
export function isRealFacility(candidate) {
  const r = classifyPlace(candidate?.name, candidate?.amenity, {
    tagged: !!candidate?.tagged,
    names: candidate?.names,
  })
  return r.ok && r.rank >= 1
}

/**
 * The nearest real facility of this type.
 *
 * Clinics and other weak matches are used only when the search found nothing
 * that is actually a hospital, police station/post or fire station. A farther
 * place is never preferred because it publishes a phone number.
 */
export function pickBest(candidates) {
  const scored = (candidates || [])
    .map((c) => ({
      ...c,
      ...classifyPlace(c.name, c.amenity, { tagged: !!c.tagged, names: c.names }),
    }))
    .filter((c) => c.ok)
    .sort((a, b) => a.distanceKm - b.distanceKm || b.rank - a.rank)

  if (!scored.length) return null

  const real = scored.filter((c) => c.rank >= 1)
  const pool = real.length ? real : scored
  const chosen = pool[0]
  return { chosen, nearest: chosen, usable: pool, fallback: chosen.rank < 1 }
}
