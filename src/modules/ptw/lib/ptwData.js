// ─────────────────────────────────────────────────────────────────────────────
// Permit-to-Work domain data: work types, hazards, and the PPE + precaution
// checklists transcribed verbatim from the safety reference sheets. PPE and
// precautions are seeded into the permit form based on the chosen work type
// ("General" is always included).
// ─────────────────────────────────────────────────────────────────────────────

// Dropdown — Type of Work.
export const WORK_TYPES = [
  'Electrical Work',
  'Confined Space Work',
  'Hot Work',
  'Height Work',
  'Excavation',
  'Loading and Unloading of Hazardous Material',
]

// Map a work type to its PPE/precaution category key (besides "General").
// Excavation & Loading/Unloading have no dedicated column → General only.
export const WORK_TYPE_CATEGORY = {
  'Hot Work': 'hotWork',
  'Electrical Work': 'electrical',
  'Height Work': 'height',
  'Confined Space Work': 'confined',
  Excavation: null,
  'Loading and Unloading of Hazardous Material': null,
}

// Hazard Identification — multi-select (22 options).
export const HAZARDS = [
  'Corrosive Chemical',
  'Flammables',
  'Explosives',
  'Compressed Gas',
  'Hot Materials',
  'Steam',
  'Fumes/Dust',
  'Lone Work',
  'Moving Machine',
  'Auto Start Equipment',
  'Traffic',
  'Confined Space',
  'Lack Of Oxygen',
  'Height Work',
  'Unsafe Access',
  'Fragile Roof',
  'Live Electrical',
  'Overhead Danger',
  'Buried Cables',
  'Buried Pipelines',
  'High/Low Pressure',
  'High/Low Temperature',
]

// ── PPE checklist (from reference sheet 1) ───────────────────────────────────
export const PPE = {
  general: {
    label: 'General',
    items: [
      'Safety Shoes/Shoes',
      'Goggles',
      'Ear plugs',
      'Mask',
      'Helmet',
      'Gloves (Cut resistant, Cryogenic, etc)',
      'High visibility jacket in vehicle movement area',
    ],
  },
  hotWork: {
    label: 'Hot work — Welding/Grinding/Chipping',
    items: [
      'Shoes/Safety Shoes',
      'Goggles for Grinding',
      'Ear plugs for high noise area',
      'Mask for Welding',
      'Welding Shield',
      'Leather gloves for hot work',
      'Breathing apparatus for confined space entry',
    ],
  },
  electrical: {
    label: 'Electrical work — Electrical panel/LT-HT installations',
    items: [
      'Shoes/Safety Shoes',
      'Electrical Gloves',
      'Ear plugs for high noise area',
      'Electrical suit',
      'Safety Helmet/Belt & Harness',
      'High Visibility Jacket in vehicle movement area',
    ],
  },
  height: {
    label: 'Work at Height > 6 ft',
    items: [
      'Safety Shoes',
      'Full Harness Safety Belt',
      'Ear plugs high Noise area',
      'Mask dust area',
      'Safety Helmet',
      'High Visibility Jacket',
    ],
  },
  confined: {
    label: 'Confined Space',
    items: [
      'Safety Shoes',
      'Goggles if chemical cleaning in confined',
      'Ear plugs in high noise in surrounding',
      'Breathing apparatus if hazardous fume',
      'Safety Helmet',
      'Full harness Safety Belt',
      'Specific PVC suit',
    ],
  },
}

// ── Precautions checklist (from reference sheet 2) ───────────────────────────
export const PRECAUTIONS = {
  general: {
    label: 'General',
    items: [
      'Job Site Checked',
      'Area Cordoned',
      'Caution Boards Displayed',
      'ELCB for portable tools',
      'PPE provided',
      'Lifting tools certified',
      'Supervision provided',
      'Double earthing',
      'Underground cables checked',
      'Underground pipes checked',
      "Supervisor's Name and No.",
    ],
  },
  hotWork: {
    label: 'Hot work',
    items: [
      'Combustibles removed',
      'Sparks Isolated',
      'Check the gauge pipes of gas cutter',
      'Flash Back Arrestor provided',
      'Fire fighting equipment provided',
      'Fire fighting team alerted',
      'Welding sets earthed',
      'Welding cables in good condition',
      'Adequate ventilation for fumes',
      'Fire watcher will leave 30 minutes after completion of task from work site',
      'Rubber mat provided',
      'Area barrication & Warning signs',
    ],
  },
  electrical: {
    label: 'Electrical work — Hazardous energy control / line breaking',
    items: [
      'Wire man License',
      'Supervisory License',
      'Approved A class Contractor',
      'Use proper Electrical approved PPE',
      'Deenergize Machine',
      'Remove fuse/Service/Area isolation',
      'Lockout the switch/Valve/Gate',
      'Tag Out the Switch/Valve/Gate',
      'Caution board display',
      'First Aider team to be alert',
      'Insulated tools to be used',
    ],
  },
  height: {
    label: 'Work at Height',
    items: [
      'Scaffolding Ladder should be Metallic',
      'Ladder Should be in working condition',
      'FRP ladder to be used',
      'Proper PPE to be used',
      'Bottom support must be ensure',
      'One attender or supervision required',
      'Area isolation and caution display',
      'In open check wind speed',
      'Instruction to not work in dark hours',
      'Not to allow task in open where Rains, Fog or slippery surface are observed',
      'Usage of Roof lifeline',
      'Anchorage Point',
    ],
  },
  confined: {
    label: 'Confined Space',
    items: [
      'LEL checking',
      'Flame proof 12 Volt hand lamp provided',
      'Air ventilation - Forced',
      'O2 = 19.5-23.5%',
      'Caution board displayed',
      'Escape tools like tripod stand provided',
      'Source of Communication',
      'Service, area, energy isolation',
      'Rescue Team on alert',
      'Entrant Name',
      'Attendant Name',
      'Entry Supervisor Name',
    ],
  },
}

// ── Required documents per work type (HSE-aligned) ───────────────────────────
// Sources: permit-to-work systems (HSG250), confined spaces (L101 / INDG258),
// hot work (INDG297 / HSG139), Work at Height & Electricity at Work regs, COSHH
// permits. `mandatory` items drive the warn-but-allow check at submit time.
// "General" docs apply to every permit; the work-type set is added on top.
export const DOCUMENTS = {
  general: [
    { key: 'risk_assessment', label: 'Risk Assessment (RA)', mandatory: true },
    { key: 'method_statement', label: 'Method Statement (RAMS)', mandatory: true },
  ],
  hotWork: [
    { key: 'hot_work_permit', label: 'Hot Work Permit / authorization', mandatory: false },
    { key: 'fire_risk_assessment', label: 'Fire Risk Assessment', mandatory: true },
    { key: 'gas_test_record', label: 'Gas / LEL test record', mandatory: true },
    { key: 'gas_equipment_inspection', label: 'Gas equipment & flashback-arrestor inspection', mandatory: false },
  ],
  confined: [
    { key: 'confined_ra', label: 'Confined-space Risk Assessment', mandatory: true },
    { key: 'atmosphere_test', label: 'Atmosphere / gas test record (O₂, LEL, toxic)', mandatory: true },
    { key: 'rescue_plan', label: 'Rescue & emergency plan', mandatory: true },
    { key: 'entry_log', label: 'Entry / exit log', mandatory: false },
    { key: 'ba_tripod_cert', label: 'Breathing apparatus & tripod inspection cert', mandatory: false },
  ],
  electrical: [
    { key: 'safe_isolation', label: 'Safe-isolation / LOTO certificate', mandatory: true },
    { key: 'competency', label: 'Competency / wireman authorization', mandatory: true },
    { key: 'live_working_ra', label: 'Live-working Risk Assessment (if applicable)', mandatory: false },
    { key: 'circuit_diagram', label: 'Single-line / circuit diagram', mandatory: false },
  ],
  height: [
    { key: 'height_ra', label: 'Work-at-height Risk Assessment', mandatory: true },
    { key: 'access_inspection', label: 'Scaffold handover or MEWP (LOLER) inspection', mandatory: true },
    { key: 'harness_inspection', label: 'Harness & anchorage inspection', mandatory: false },
    { key: 'height_rescue_plan', label: 'Rescue plan', mandatory: false },
  ],
  excavation: [
    { key: 'services_survey', label: 'Underground-services survey / CAT-scan', mandatory: true },
    { key: 'shoring_design', label: 'Shoring / support design', mandatory: false },
    { key: 'excavation_inspection', label: 'Daily excavation inspection record', mandatory: false },
    { key: 'dig_authorization', label: 'Dig authorization / permit', mandatory: false },
  ],
  loading: [
    { key: 'sds', label: 'Safety Data Sheets (SDS)', mandatory: true },
    { key: 'transport_doc', label: 'Transport / ADR dangerous-goods note', mandatory: false },
    { key: 'lifting_inspection', label: 'Vehicle & lifting equipment (LOLER) inspection', mandatory: false },
    { key: 'spill_plan', label: 'Spill-response plan', mandatory: true },
  ],
}

// Loading/Unloading & Excavation have their own document sets even though they
// share the "General only" PPE/precaution columns.
const DOC_CATEGORY = {
  ...WORK_TYPE_CATEGORY,
  Excavation: 'excavation',
  'Loading and Unloading of Hazardous Material': 'loading',
}

// ── Job Safety Analysis seed rows per work type ──────────────────────────────
export const JSA_SUGGESTIONS = {
  general: [
    { step: 'Mobilise to work area & set up', hazard: 'Slips, trips, manual handling', precaution: 'Housekeeping, barricade area, team lift / mechanical aids' },
  ],
  hotWork: [
    { step: 'Set up welding/cutting equipment', hazard: 'Sparks, hot slag, flammable materials', precaution: 'Remove combustibles, fire blankets, extinguisher & fire watch on standby' },
    { step: 'Carry out hot work', hazard: 'Fire, fume, burns, compressed-gas leak', precaution: 'Gas/LEL test, flashback arrestors, ventilation, PPE, screens' },
    { step: 'Complete & leave area', hazard: 'Smouldering ignition after work', precaution: 'Fire watch maintained ≥30 min (up to 60 min) after completion' },
  ],
  confined: [
    { step: 'Prepare & isolate the space', hazard: 'Stored energy, residual product', precaution: 'Isolate/lock-off, drain, purge & ventilate' },
    { step: 'Test atmosphere & enter', hazard: 'Oxygen deficiency, toxic/flammable gas', precaution: 'Gas test O₂/LEL/toxic before & during, attendant + rescue plan, BA if required' },
    { step: 'Work inside space', hazard: 'Engulfment, entrapment, loss of comms', precaution: 'Standby attendant, comms, tripod/winch, limited entry time' },
  ],
  electrical: [
    { step: 'Identify & isolate circuit', hazard: 'Electric shock, arc flash', precaution: 'Safe isolation, prove dead, lock-out/tag-out, insulated tools & PPE' },
    { step: 'Carry out electrical work', hazard: 'Inadvertent re-energisation', precaution: 'Keep keys with worker, barriers/caution boards, competent person only' },
  ],
  height: [
    { step: 'Erect/inspect access equipment', hazard: 'Collapse, fall of person/objects', precaution: 'Inspected scaffold/MEWP, guardrails, exclusion zone below' },
    { step: 'Work at height', hazard: 'Fall from height, dropped objects', precaution: 'Harness to anchor point, tool tethering, no work in high wind/dark' },
  ],
  excavation: [
    { step: 'Locate buried services & break ground', hazard: 'Strike buried cables/pipes', precaution: 'CAT-scan & service drawings, hand-dig trial holes' },
    { step: 'Dig & enter excavation', hazard: 'Collapse, falls, water ingress', precaution: 'Shoring/battering, edge protection, ladder access, daily inspection' },
  ],
  loading: [
    { step: 'Position vehicle & secure load', hazard: 'Vehicle movement, falling load', precaution: 'Wheel chocks, exclusion zone, certified lifting gear' },
    { step: 'Load/unload hazardous material', hazard: 'Spill, exposure, fire', precaution: 'SDS reviewed, PPE, spill kit & containment, no ignition sources' },
  ],
}

/** Categories (always General + the work-type-specific one) for a work type. */
function categoriesFor(workType) {
  const keys = ['general']
  const extra = WORK_TYPE_CATEGORY[workType]
  if (extra) keys.push(extra)
  return keys
}

/** PPE category groups [{key,label,items}] relevant to a work type. */
export function ppeGroupsFor(workType) {
  return categoriesFor(workType).map((k) => ({ key: k, ...PPE[k] }))
}

/** Precaution category groups [{key,label,items}] relevant to a work type. */
export function precautionGroupsFor(workType) {
  return categoriesFor(workType).map((k) => ({ key: k, ...PRECAUTIONS[k] }))
}

/** Required documents [{key,label,mandatory}] for a work type (General + specific). */
export function requiredDocsFor(workType) {
  const keys = ['general']
  const extra = DOC_CATEGORY[workType]
  if (extra) keys.push(extra)
  return keys.flatMap((k) => DOCUMENTS[k] || [])
}

/** Seed JSA rows [{step,hazard,precaution}] for a work type (General + specific). */
export function jsaSuggestionsFor(workType) {
  const rows = [...(JSA_SUGGESTIONS.general || [])]
  const extra = WORK_TYPE_CATEGORY[workType] || DOC_CATEGORY[workType]
  if (extra && JSA_SUGGESTIONS[extra]) rows.push(...JSA_SUGGESTIONS[extra])
  return rows.map((r) => ({ ...r }))
}

/** Hot Work requires fire watcher(s). */
export function needsFireWatch(workType) {
  return workType === 'Hot Work'
}

/** Confined Space requires a standby watcher / attendant. */
export function needsConfinedWatcher(workType) {
  return workType === 'Confined Space Work'
}

/**
 * Mandatory required-docs that have NO file attached yet. Pure — drives the
 * warn-but-allow confirmation at submit. `attachedKeys` = keys with a file.
 */
export function missingMandatoryDocs(requiredDocs = [], attachedKeys = []) {
  const have = new Set(attachedKeys)
  return requiredDocs.filter((d) => d.mandatory && !have.has(d.key))
}
