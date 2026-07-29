// ─────────────────────────────────────────────────────────────────────────────
// Is this place actually an emergency service?
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
// The name is the signal that actually discriminates. Each category has:
//   STRONG  — unmistakably the real thing ("Hunslet Fire Station")
//   REJECT  — looks related but cannot answer an emergency call (a trade
//             association, police housing, a pharmacy, a fire-alarm vendor)
// Anything else is accepted but ranked below a strong match, so a plain clinic
// is still offered when nothing better exists nearby.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = {
  police: {
    strong: /\bpolice\s*(station|headquarters|hq|post|outpost|chowki|control room)\b|\bthana\b|\bkotwali\b/i,
    weak: /\bpolice\b|\bgarda\b|\bsheriff\b/i,
    // Real stations, but not who you want for a life-safety emergency.
    demote: /\btraffic\b|\btransport\b|\brailway\b|\bwomen'?s?\b|\bcyber\b|\btourist\b/i,
    // Housing, welfare bodies and museums carry "police" in the name but no duty officer.
    reject: /\b(quarters?|colony|housing|apartment|association|academy|training|museum|memorial|welfare|society|canteen|club|ground|school|college|hospital|band|store|shop|residency)\b/i,
  },
  fire_station: {
    strong: /\bfire\s*(station|brigade|service|services|department|dept)\b|\bfire\s*(and|&)\s*(rescue|emergency)\b/i,
    weak: /\bfire\b|\brescue\b/i,
    // Vendors and trade bodies dominate a plain "fire" search.
    reject: /\b(association|systems?|solutions?|private\s*limited|pvt|ltd|inc|equipment|extinguisher\w*|supplies|supplier\w*|engineering|consultan\w*|contractor\w*|training|academy|alarm\w*|protection\s*co|safety\s*office|insurance|museum)\b/i,
  },
  hospital: {
    strong: /\b(hospital|medical\s*college|emergency\s*(centre|center|room|ward)|casualty|a\s*&\s*e|trauma\s*(centre|center)|infirmary)\b/i,
    weak: /\b(clinic|medical\s*(centre|center)|health\s*(centre|center)|nursing\s*home|dispensary|surgery)\b/i,
    // Single-speciality hospitals are real hospitals but will turn away a
    // trauma case. Ranked below a general hospital that can take casualties.
    demote: /\b(mental\s*health|psychiatr\w*|paediatric\w*|pediatric\w*|children'?s?|maternity|obstetric\w*|eye|ent|cancer|oncolog\w*|orthopaed\w*|orthoped\w*|cardiac|heart|neuro\w*|kidney|renal|dialysis|chest|tb|ayush|rehab\w*)\b/i,
    // Pharmacies, labs and single-speciality practices cannot take an emergency.
    // Stems carry \w* so "ayurved" also catches "Ayurveda"; a trailing \b alone
    // would not match the inflected forms these names actually use.
    reject: /\b(pharmac\w*|chemist\w*|medical\s*store|general\s*store|optician\w*|optical|dental|dentist\w*|skin\s*care|aesthetic\w*|cosmetic\w*|ayurved\w*|homoeopath\w*|homeopath\w*|unani|siddha|naturopath\w*|physiotherap\w*|therapy|therapist|diagnostic\w*|patholog\w*|scan\s*(centre|center)|laborator\w*|lab|veterinar\w*|pet\s*(clinic|hospital)|fertility|ivf|slimming|wellness|spa)\b/i,
  },
}

/**
 * Classify a place name for a category.
 * Returns { ok, strong } — `ok:false` means never offer it as this contact.
 */
export function classifyPlace(name, amenity) {
  const rules = RULES[amenity]
  const n = String(name || '').trim()
  if (!rules || n.length < 3) return { ok: false, strong: false }

  if (rules.reject.test(n)) return { ok: false, strong: false }
  // A speciality unit stays selectable, but never outranks a general station.
  if (rules.demote?.test(n)) return { ok: true, strong: false }
  if (rules.strong.test(n)) return { ok: true, strong: true }
  if (rules.weak.test(n)) return { ok: true, strong: false }
  // No category word at all — "K Hanmanth", "Ps Exclusive" and similar noise.
  return { ok: false, strong: false }
}

/**
 * Rank candidates for one category: real stations that answer a phone first,
 * then real stations, then anything else usable — nearest within each band.
 *
 * `maxPhoneKm` stops a number being taken from another town: past it we would
 * rather show the nearest station with a blank number than a plausible-looking
 * one that reaches a different service area.
 */
export function pickBest(candidates, maxPhoneKm) {
  const scored = candidates
    .map((c) => ({ ...c, ...classifyPlace(c.name, c.amenity) }))
    .filter((c) => c.ok)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  if (!scored.length) return null

  const reachable = (list) => list.filter((c) => c.phone && c.distanceKm <= maxPhoneKm)
  const strong = scored.filter((c) => c.strong)

  const chosen =
    reachable(strong)[0] ||   // a real station we can call
    reachable(scored)[0] ||   // something usable we can call
    strong[0] ||              // a real station, number unknown
    scored[0]                 // last resort, number unknown

  return { chosen, nearest: strong[0] || scored[0], usable: scored }
}
