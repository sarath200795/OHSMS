// ─────────────────────────────────────────────────────────────────────────────
// Mock-drill scenario templates. Each scenario carries a procedural checklist;
// Fire and Medical scenarios swap in a more specific checklist based on a
// sub-type selection. Ported from the OHSMS emergency-response coordinator and
// adapted to the Fire Marshal app.
// ─────────────────────────────────────────────────────────────────────────────

export const SCENARIOS = [
  {
    id: 1,
    title: 'Fire Emergency',
    emoji: '🔥',
    color: '#dc2626',
    checklist: [
      'Activate manual call point / sound alarm.',
      'Evacuate via nearest safe exit.',
      'Check doors for heat before opening.',
      'Stay low if smoke is present.',
      'Proceed to Assembly Point.',
      'Perform head count / roll call.',
    ],
  },
  {
    id: 2,
    title: 'Chemical Spill',
    emoji: '🧪',
    color: '#eab308',
    checklist: [
      'Activate the alarm or reporting method and notify the emergency coordinator immediately.',
      'Isolate the area, restrict access, and evacuate non-essential personnel if there is inhalation, fire, or reaction risk.',
      'Identify the substance, review the SDS or site chemical information, and confirm required controls.',
      'Allow only trained responders with the required PPE and spill equipment to contain the release.',
      'Prevent the spill from entering drains or occupied areas and arrange compatible waste collection.',
      'Ventilate, decontaminate, and release the area only after the hazard is verified as controlled.',
    ],
  },
  {
    id: 3,
    title: 'Electrical Outage',
    emoji: '⚡',
    color: '#f59e0b',
    checklist: [
      'Report the outage immediately and activate the site emergency communication process.',
      'Stop ongoing work safely, secure equipment, and lower mobile plant or suspended loads where applicable.',
      'Use emergency lighting, keep exit routes clear, and prevent panic or uncontrolled movement.',
      'Allow only designated persons to manage generators, utilities, or safe shutdown of critical systems.',
      'Verify life safety systems, access control, and essential communications remain functional or are backed up.',
      'Coordinate utility restoration and restart only after equipment and process checks are completed.',
    ],
  },
  {
    id: 4,
    title: 'Severe Weather',
    emoji: '⛈️',
    color: '#3b82f6',
    checklist: [
      'Monitor official weather warnings and communicate the site response decision promptly.',
      'Secure outdoor operations, equipment, and loose materials if this can be done safely before impact.',
      'Use the designated shelter-in-place or evacuation signal according to the emergency action plan.',
      'Move personnel to the pre-identified safe shelter area away from glass, roofs, and exposed hazards.',
      'Account for all employees, contractors, and visitors once sheltering or evacuation is complete.',
      'Wait for the all-clear and inspect the area for damage before resuming work activities.',
    ],
  },
  {
    id: 5,
    title: 'Armed Aggressor',
    emoji: '🚨',
    color: '#7f1d1d',
    checklist: [
      'Notify emergency services and the site emergency coordinator as soon as it is safe to do so.',
      'Evacuate immediately if a safe escape path exists and move away from the threat area.',
      'If evacuation is not safe, secure in place, lock or barricade access, silence devices, and stay out of view.',
      'Fight or physically resist only as a last resort when there is an immediate threat to life.',
      'Prevent unauthorized access to the affected area and keep hands visible when law enforcement arrives.',
      'Do not re-enter until the official all-clear is given and accountability is completed.',
    ],
  },
  {
    id: 6,
    title: 'Earthquake',
    emoji: '🏚️',
    color: '#a855f7',
    checklist: [
      'DROP, COVER, and HOLD ON immediately when shaking starts.',
      'Stay away from windows, shelving, unsecured materials, and overhead hazards during shaking.',
      'Do not run outside during active shaking unless the structure is immediately collapsing around you.',
      'After shaking stops, evacuate carefully if required and watch for debris, leaks, or damaged surfaces.',
      'Account for employees at the assembly point and report injured or missing persons immediately.',
      'Do not re-enter the structure until it has been checked and released by competent personnel.',
    ],
  },
  {
    id: 7,
    title: 'Medical Emergency',
    emoji: '🚑',
    color: '#10b981',
    checklist: [
      'Assess scene safety.',
      'Do not move patient (unless danger).',
      'Call First Aider / Ambulance.',
      'Guide Ambulance to entrance.',
      'Protect patient privacy.',
    ],
  },
  {
    id: 8,
    title: 'Civil Threat',
    emoji: '🕵️',
    color: '#6366f1',
    checklist: [
      'Treat the threat as real, remain calm, and notify the emergency coordinator and security or police immediately.',
      'Do not touch, move, open, or disturb any suspicious item or area linked to the threat.',
      'Isolate and cordon off the area, keeping personnel and visitors clear of the hazard zone.',
      'Avoid actions that may trigger the device or escalate the threat, including unnecessary radio use near suspicious items.',
      'Evacuate or shelter according to the emergency action plan and maintain accountability of personnel.',
      'Preserve information and the scene for emergency responders and investigation teams.',
    ],
  },
  {
    id: 9,
    title: 'Workplace Violence',
    emoji: '👊',
    color: '#be123c',
    checklist: [
      'Recognize escalating aggression or threatening behaviour early and discreetly alert the emergency coordinator or security.',
      'Keep a safe distance, maintain a clear exit path, and avoid confronting, provoking, or cornering the aggressor.',
      'Move bystanders away from the area and de-escalate calmly using trained techniques only if it is safe to do so.',
      'Activate the duress alarm or agreed distress signal and call security or police if the threat escalates.',
      'Evacuate or secure in place based on the level of threat, then account for all employees, contractors, and visitors.',
      'Provide first aid to anyone injured, preserve the scene, and report the incident for investigation and victim support.',
    ],
  },
]

export const FIRE_SOURCE_OPTIONS = [
  {
    id: 'electrical-panel',
    label: 'Electrical Panel / Wiring',
    checklist: [
      'Activate the alarm, notify the emergency coordinator, and identify the affected electrical source.',
      'Keep egress routes clear and move personnel out of the electrical hazard zone immediately.',
      'Isolate power only if the disconnect point is known and can be reached safely by an authorized person.',
      'Allow only trained responders using the correct extinguisher and required PPE to tackle an incipient-stage fire.',
      'Account for exposed personnel at the assembly point and escalate to external responders if the fire is not immediately controlled.',
      'Prevent re-energization and hold the equipment for electrical inspection before restart.',
    ],
  },
  {
    id: 'flammable-liquid',
    label: 'Flammable Liquid / Fuel',
    checklist: [
      'Activate the alarm, notify the emergency coordinator, and stop nearby ignition sources immediately.',
      'Evacuate non-essential personnel, keep exit routes open, and establish an upwind exclusion zone.',
      'Isolate the leaking or feeding source only if this can be done safely and without entering the fire area.',
      'Allow only trained responders with the approved extinguisher, spill controls, and PPE to intervene.',
      'Call external responders if the fire spreads, threatens storage, or cannot be controlled at incipient stage.',
      'Secure runoff, preserve the scene, and arrange safe disposal of contaminated absorbents and waste.',
    ],
  },
  {
    id: 'solid-material',
    label: 'Solid Material / Combustible Storage',
    checklist: [
      'Activate the alarm, identify the burning storage area, and initiate the site emergency action plan.',
      'Evacuate nearby personnel using designated means of egress and close doors when leaving to slow spread.',
      'Allow only trained responders with a protected escape route to attack a small controllable fire.',
      'Check adjacent racks, stock, and hidden spaces for extension while maintaining accountability of responders.',
      'Remove nearby combustibles only when it does not compromise safe evacuation or responder safety.',
      'Hold the area for damage assessment, housekeeping, and restart approval before normal operations resume.',
    ],
  },
  {
    id: 'vehicle-equipment',
    label: 'Vehicle / Equipment Fire',
    checklist: [
      'Activate the alarm, stop the vehicle or equipment if safe, and notify the emergency coordinator.',
      'Evacuate personnel away from tires, cylinders, batteries, fuel tanks, and hydraulic lines.',
      'Keep access roads clear for emergency responders and establish a safe perimeter around the equipment.',
      'Allow only trained responders with the correct extinguisher and PPE to intervene on an incipient-stage fire.',
      'Monitor for leaking fuel, oil, or hydraulics that can cause re-ignition or environmental spread.',
      'Lock out movement and restart until maintenance isolation, inspection, and release are completed.',
    ],
  },
  {
    id: 'other',
    label: 'Other / Unknown Source',
    checklist: [
      'Activate the alarm, notify the emergency coordinator, and identify visible fire behavior and smoke conditions.',
      'Evacuate personnel through designated exits and maintain a controlled exclusion zone around the fire area.',
      'Do not commit to firefighting until the fire class, hazards, and safe response method are reasonably understood.',
      'Allow only trained responders with approved equipment and a protected escape route to intervene.',
      'Escalate immediately to external responders when the source remains uncertain or the fire is not quickly controlled.',
      'Preserve the scene after control for investigation, re-entry assessment, and restart authorization.',
    ],
  },
]

export const MEDICAL_INCIDENT_OPTIONS = [
  {
    id: 'cardiac-arrest',
    label: 'Cardiac Arrest',
    checklist: [
      'Check scene safety, use required barrier protection, and confirm the casualty is unresponsive.',
      'Call emergency medical support immediately and send for the AED without delay.',
      'Open the airway and check briefly for normal breathing and signs of life.',
      'Start CPR immediately if the casualty is not breathing normally.',
      'Apply the AED as soon as it arrives and follow the device prompts exactly.',
      'Continue CPR and AED cycles until qualified medical handover or clear signs of recovery.',
    ],
  },
  {
    id: 'fracture',
    label: 'Fracture / Suspected Fracture',
    checklist: [
      'Check scene safety, use appropriate PPE, and reassure the injured person.',
      'Do not move the casualty unless there is immediate danger or a life-saving reason to do so.',
      'Examine for pain, deformity, swelling, open wounds, and circulation or sensation beyond the injury.',
      'Control any bleeding and support the injured area in the position found.',
      'Immobilize the suspected fracture only if trained and if this will not worsen the injury.',
      'Arrange medical transfer, monitor for shock, and document the condition during handover.',
    ],
  },
  {
    id: 'heart-attack',
    label: 'Heart Attack',
    checklist: [
      'Check scene safety, use appropriate PPE, and place the casualty in the most comfortable resting position.',
      'Assess chest pain, breathing difficulty, sweating, skin color, and level of responsiveness.',
      'Call emergency medical support immediately and keep access clear for the ambulance team.',
      'Keep the casualty calm, loosen restrictive clothing, and discourage walking or exertion.',
      "Assist only with the casualty's own prescribed medication if they are alert and able to take it.",
      'Monitor continuously and prepare for CPR and AED use if the casualty collapses or stops breathing normally.',
    ],
  },
]

export const EMERGENCY_TEAMS = [
  'Transportation Team',
  'Spill Response Team',
  'Fire Fighting Team',
  'Evacuation Team',
  'Medical Emergency Team',
  'Security',
  'Public Relation',
]

export function getActiveChecklist(scenarioTitle, fireSource, medicalIncidentType) {
  if (scenarioTitle === 'Fire Emergency') {
    return (
      FIRE_SOURCE_OPTIONS.find((o) => o.id === fireSource)?.checklist ||
      SCENARIOS.find((s) => s.title === scenarioTitle)?.checklist ||
      []
    )
  }
  if (scenarioTitle === 'Medical Emergency') {
    return (
      MEDICAL_INCIDENT_OPTIONS.find((o) => o.id === medicalIncidentType)?.checklist ||
      SCENARIOS.find((s) => s.title === scenarioTitle)?.checklist ||
      []
    )
  }
  return SCENARIOS.find((s) => s.title === scenarioTitle)?.checklist || []
}

export const getFireSourceLabel = (id) =>
  FIRE_SOURCE_OPTIONS.find((o) => o.id === id)?.label || id || '—'

export const getMedicalIncidentLabel = (id) =>
  MEDICAL_INCIDENT_OPTIONS.find((o) => o.id === id)?.label || id || '—'

export const getScenario = (title) => SCENARIOS.find((s) => s.title === title)

export const DRILL_OUTCOMES = ['Pass', 'Pass with actions', 'Fail']
export const EVENT_TYPES = ['Mock Drill', 'Real Emergency']
export const CAPA_STATUSES = ['Open', 'In Progress', 'Closed']
