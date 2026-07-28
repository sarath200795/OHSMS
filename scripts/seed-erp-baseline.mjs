// ─────────────────────────────────────────────────────────────────────────────
// Seeds the org-wide BASELINE emergency response library (erpRescuePlans with
// kind: 'baseline'). Sites recall these and adapt them locally.
//
// Procedures are generic, industry-standard emergency response steps written
// for this organization — structured role-by-role (DURING / AFTER) in the way
// site ERPs conventionally are. Indian national emergency numbers are used:
//   112 all-emergency · 100 police · 101 fire · 102/108 ambulance · 1091 women's helpline
//
// Run:  node scripts/seed-erp-baseline.mjs [--replace]
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection,
  writeBatch, serverTimestamp,
} from 'firebase/firestore'

const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'ohsms-demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

// Roles map 1:1 onto the app's internal escalation chain (INTERNAL_ROLES), so a
// site that recalls a plan gets its own named people and phone numbers filled in
// automatically from that site's internal emergency contacts.
const MGR = 'CM'          // Centre Manager — acts as Incident Commander on site
const SAFETY = 'Safety L1'
const SEC = 'Security'
const FIRST_AID = 'First Aider'
const HR_ = 'HR'
const LEGAL = 'Legal'
const ALL = 'All employees' // everyone on site — not an escalation contact
const IC = MGR              // the CM is the Incident Commander

const step = (action, responsible) => ({ action, responsible })

/** Steps every evacuation shares, so the plans stay consistent. */
const evacuationCore = (hazard) => [
  step(`Raise the alarm and announce evacuation for ${hazard}`, SEC),
  step('Call the site Fire Brigade contact (101/112) — call even if the alarm has sounded', SEC),
  step('Stop work, shut down equipment where safe, and leave by the nearest safe exit', ALL),
  step('Walk, do not run. Do not use lifts. Stay low if there is smoke', ALL),
  step('Assist anyone needing help, including persons with disabilities, using the buddy system', ALL),
  step('Sweep assigned zones — changing rooms, washrooms, stores — and confirm clear', SAFETY),
  step('Take charge at the assembly point and establish the emergency control point', IC),
  step('Take a headcount against the attendance/visitor register and report anyone missing', MGR),
  step('Keep access lanes clear and escort emergency services to the scene on arrival', SEC),
  step('Brief the fire/rescue officer in charge on hand-over', IC),
  step('Nobody re-enters until the "All Clear" is given by the responding service', IC),
  step('Record the event, debrief and raise corrective actions in the Action Tracker', SAFETY),
]

const PLANS = [
  {
    scenario: 'Fire / Explosion',
    title: 'Fire evacuation and rescue',
    description: 'Total evacuation of the premises on discovery of fire, smoke or an explosion, with headcount at the assembly point.',
    triggers: 'Fire alarm sounds · smoke, flames or burning smell detected · explosion heard',
    steps: [
      step('On discovering fire, raise the alarm immediately — do not attempt to investigate alone', ALL),
      step('Attack only small, incipient fires with the correct extinguisher, keeping an exit behind you', SAFETY),
      ...evacuationCore('fire'),
      step('Isolate electrical supply and gas at the mains once the area is clear, if safe to do so', SEC),
    ],
    equipment: ['Fire extinguishers (ABC/CO2)', 'Fire blanket', 'First aid kit', 'AED', 'Megaphone', 'Attendance/visitor register', 'Torches'],
    team: [IC, SEC, SAFETY, FIRST_AID, MGR],
  },
  {
    scenario: 'Vehicle Fire',
    title: 'Vehicle fire in car park or loading area',
    description: 'Response to a burning vehicle (including electric vehicles) on site property.',
    triggers: 'Smoke or flames from a vehicle · EV thermal runaway warning · burning smell in the parking area',
    steps: [
      step('Move people away and establish a cordon of at least 15 m (EVs can reignite and eject debris)', SEC),
      step('Call the site Fire Brigade contact (101/112); state whether the vehicle is electric, petrol/diesel or CNG', SEC),
      step('Do not attempt to extinguish a lithium-battery fire — it needs sustained water from the fire service', SAFETY),
      step('Evacuate adjacent vehicles and any occupied area downwind of the smoke', ALL),
      step('Shut off nearby fuel sources and isolate EV chargers at the distribution board', SAFETY),
      step('Account for the vehicle occupants and check for anyone still inside or nearby', MGR),
      step('Keep the cordon until the fire service confirms the battery is cool and stable', IC),
      step('Preserve CCTV and record the event for investigation and insurance', SEC),
    ],
    equipment: ['ABC extinguishers', 'Cordon tape / cones', 'Torches', 'CCTV access'],
    team: [IC, SEC, SAFETY, MGR],
  },
  {
    scenario: 'Medical Emergency',
    title: 'Medical emergency and first aid response',
    description: 'Response to collapse, cardiac arrest, serious injury or sudden illness of a member, employee or visitor.',
    triggers: 'Person collapses or is unresponsive · chest pain or breathing difficulty · serious bleeding, fracture or head injury',
    steps: [
      step('Check the scene is safe, then check response and breathing — do not move the casualty unnecessarily', FIRST_AID),
      step('Call the site Ambulance/Hospital contact (102/108); give the exact site address and nearest landmark', SEC),
      step('Start CPR and bring the AED immediately if the person is unresponsive and not breathing normally', FIRST_AID),
      step('Control severe bleeding with direct pressure; keep the casualty warm and reassured', FIRST_AID),
      step('Clear space around the casualty and move other members away to give privacy', MGR),
      step('Send someone to the entrance to meet and guide the ambulance in', SEC),
      step('Retrieve emergency contact details and inform next of kin', HR_),
      step('Do not give food, water or medication unless directed by a medical professional', FIRST_AID),
      step('Hand over to paramedics with what happened, when, and any treatment given', FIRST_AID),
      step('Record in the incident register and report the injury in the Incidents module', SAFETY),
    ],
    equipment: ['First aid kit', 'AED', 'Oxygen cylinder (if provided)', 'Emergency contact list', 'Spine board / stretcher'],
    team: [FIRST_AID, SEC, MGR, HR_],
  },
  {
    scenario: 'Blood / Body Fluid Spill',
    title: 'Blood and body fluid clean-up (biohazard)',
    description: 'Safe containment and disinfection after blood, vomit or other body fluids are spilled — common after gym injuries.',
    triggers: 'Blood or body fluid on equipment, mats or floor following an injury or illness',
    steps: [
      step('Stop use of the area immediately and cordon it off', SAFETY),
      step('Put on disposable gloves, apron and eye protection before approaching the spill', SAFETY),
      step('Cover the spill with absorbent granules or paper towel to contain it', SAFETY),
      step('Disinfect with a 1% hypochlorite (bleach) solution and leave the contact time stated on the label', SAFETY),
      step('Double-bag all waste as biohazard/infectious waste and dispose through the licensed handler', SAFETY),
      step('Wash hands thoroughly after removing PPE; discard PPE with the waste', SAFETY),
      step('Report any needle-stick or splash exposure for immediate medical assessment', HR_),
      step('Release the area for use only once fully dry and disinfected', MGR),
    ],
    equipment: ['Biohazard spill kit', 'Disposable gloves/apron/eye protection', 'Hypochlorite disinfectant', 'Biohazard waste bags', 'Wet floor signs'],
    team: [SAFETY, FIRST_AID, MGR],
  },
  {
    scenario: 'Fatality / Serious Injury',
    title: 'Fatality or life-threatening injury',
    description: 'Response where a person has died or sustained an injury likely to be fatal or permanently disabling.',
    triggers: 'Death on site · amputation, major head/spinal injury · injury requiring resuscitation',
    steps: [
      step('Give first aid and call the site Ambulance contact (102/108) — assume life can be saved until confirmed otherwise', FIRST_AID),
      step('Do not disturb the scene beyond what is needed to give aid or make it safe', IC),
      step('Cordon the area and stop all related activity; preserve equipment in its found state', SEC),
      step('Notify the Centre Manager, Safety L2 and senior leadership immediately', MGR),
      step('Inform the site Police contact (100) and the statutory authority as legally required', LEGAL),
      step('Inform the family personally and sensitively — never by message; arrange support', HR_),
      step('Appoint a single spokesperson; no one else speaks to media or posts on social media', IC),
      step('Secure CCTV, registers, training records and equipment maintenance history', SEC),
      step('Provide counselling/EAP support to those who witnessed the event', HR_),
      step('Launch a formal investigation in the Incidents module within 24 hours', SAFETY),
    ],
    equipment: ['First aid kit', 'AED', 'Cordon tape', 'CCTV access', 'Incident documentation pack'],
    team: [IC, MGR, HR_, SAFETY, SEC],
  },
  {
    scenario: 'Chemical Spill / Release',
    title: 'Hazardous material / chemical spill',
    description: 'Containment of spilled cleaning chemicals, pool chemicals or other hazardous substances.',
    triggers: 'Container rupture or leak · chemical odour · eye/throat irritation reported near a store',
    steps: [
      step('Move everyone upwind and away; stop anyone from walking through the spill', SAFETY),
      step('Identify the substance from the label and consult its Safety Data Sheet before acting', SAFETY),
      step('Evacuate and call the site Fire Brigade contact (101/112) if the substance is unknown, reactive or the spill is large', IC),
      step('Ventilate the area — open doors and windows; never mix chemicals to neutralise a spill', SAFETY),
      step('Wear the PPE specified on the SDS, then contain with the spill kit working inwards from the edge', SAFETY),
      step('Prevent entry to drains — pool chemicals and chlorine must not reach the water system', SAFETY),
      step('Flush any skin or eye contact with clean water for at least 15 minutes and seek medical help', FIRST_AID),
      step('Dispose of contaminated absorbents as hazardous waste via the licensed handler', SAFETY),
      step('Restock the spill kit and record the event with corrective actions', SAFETY),
    ],
    equipment: ['Chemical spill kit', 'SDS folder', 'Chemical-resistant gloves & goggles', 'Respirator', 'Eyewash station', 'Absorbent granules'],
    team: [SAFETY, IC, FIRST_AID, MGR],
  },
  {
    scenario: 'Gas Leak',
    title: 'Gas leak evacuation',
    description: 'Response to a suspected LPG, natural gas or refrigerant leak.',
    triggers: 'Smell of gas · hissing from a pipe or cylinder · gas detector alarm',
    steps: [
      step('Do not operate any electrical switch, light or lift, and do not use mobile phones inside', ALL),
      step('Isolate the gas supply at the main valve if it can be reached safely', SAFETY),
      step('Evacuate the building and move upwind, well beyond the normal assembly point', ALL),
      step('Call the site Fire Brigade contact (101/112) and the gas supplier from outside the building', SEC),
      step('Ventilate by opening doors and windows on the way out only if it causes no delay', SAFETY),
      step('Prevent all ignition sources — no vehicles started, no smoking within the cordon', SEC),
      step('Take a headcount and report anyone missing to the responding service', MGR),
      step('Re-entry only after the supplier or fire service confirms the atmosphere is safe', IC),
    ],
    equipment: ['Gas detector', 'Gas isolation valve key', 'Cordon tape', 'Torches (intrinsically safe)'],
    team: [IC, SEC, SAFETY, MGR],
  },
  {
    scenario: 'Electrical Incident',
    title: 'Electric shock or electrical fire',
    description: 'Response to electrocution, arc flash or burning smell from electrical equipment.',
    triggers: 'Person in contact with live equipment · burning smell or sparks from a panel · arc flash',
    steps: [
      step('Do NOT touch the casualty while they may still be in contact with the supply', ALL),
      step('Isolate the supply at the breaker or main switch before approaching', SAFETY),
      step('If isolation is impossible, push the person clear using a dry non-conductive item', FIRST_AID),
      step('Call the site Ambulance contact (102/108); treat for cardiac arrest — shock commonly stops the heart', FIRST_AID),
      step('Use CO2 extinguishers only on electrical fires — never water', SAFETY),
      step('Evacuate if the fire spreads beyond the equipment or smoke fills the area', IC),
      step('Lock out and tag out the affected circuit to prevent re-energising', SAFETY),
      step('Have a licensed electrician inspect before the equipment is returned to service', MGR),
      step('Record the incident and review the equipment maintenance and LOTO records', SAFETY),
    ],
    equipment: ['CO2 extinguisher', 'LOTO kit', 'Insulated gloves', 'AED', 'First aid kit', 'Non-conductive rescue hook'],
    team: [SAFETY, FIRST_AID, IC, MGR],
  },
  {
    scenario: 'Water / Drowning Rescue',
    title: 'Swimming pool drowning / water rescue',
    description: 'Rescue of a swimmer in difficulty or found submerged in the pool.',
    triggers: 'Swimmer in distress or submerged · unresponsive person in the water · lifeguard whistle',
    steps: [
      step('Clear the pool immediately and keep all other swimmers out until stood down', SAFETY),
      step('Reach or throw first — use pole or rescue tube; enter the water only if trained', FIRST_AID),
      step('Support the head and neck if a spinal injury is suspected (diving or fall)', FIRST_AID),
      step('Remove the casualty from the water using the spine board where spinal injury is suspected', FIRST_AID),
      step('Call the site Ambulance/Hospital contact (102/108) — every near-drowning needs hospital assessment', SEC),
      step('Start rescue breaths and CPR at once; bring the AED and dry the chest before pads', FIRST_AID),
      step('Place a breathing but unresponsive casualty in the recovery position and keep them warm', FIRST_AID),
      step('Guide the ambulance to the poolside entrance', SEC),
      step('Test and record pool water and equipment condition; retain CCTV', SAFETY),
      step('Reopen the pool only after the Centre Manager authorises it', MGR),
    ],
    equipment: ['Rescue tube / torpedo buoy', 'Reaching pole', 'Spine board with head blocks', 'AED', 'Oxygen kit', 'First aid kit', 'Whistle'],
    team: [FIRST_AID, SAFETY, SEC, MGR],
  },
  {
    scenario: 'Machine Entrapment',
    title: 'Person trapped in equipment',
    description: 'Release of a person trapped in gym or plant equipment — weight stacks, treadmills, doors or machinery.',
    triggers: 'Limb or clothing caught in equipment · person pinned under a load · trapped in a door or lift',
    steps: [
      step('Stop the machine and hit the emergency stop; keep others clear', ALL),
      step('Isolate and lock out the energy source — electrical, and any stored/spring or gravity load', SAFETY),
      step('Do not reverse or re-energise the machine to free the person unless advised by rescuers', SAFETY),
      step('Call the site Fire Brigade contact (101/112) if release needs cutting or lifting equipment', SEC),
      step('Support any suspended weight or load before attempting release', SAFETY),
      step('Give first aid, control bleeding and keep the casualty still and reassured', FIRST_AID),
      step('Prepare for crush injury — do not release a long-trapped limb without medical presence', FIRST_AID),
      step('Keep the equipment isolated and out of service after the rescue for investigation', MGR),
      step('Investigate guarding, maintenance and training before returning it to use', SAFETY),
    ],
    equipment: ['LOTO kit', 'Emergency stop signage', 'First aid kit', 'Manual handling/lifting aids', 'Torch'],
    team: [SAFETY, FIRST_AID, SEC, MGR],
  },
  {
    scenario: 'Work at Height Rescue',
    title: 'Rescue from height / suspension',
    description: 'Recovery of a person who has fallen or is suspended in a harness during maintenance or installation work.',
    triggers: 'Fall arrested by harness · person stranded on a ladder, roof or MEWP · fall from height',
    steps: [
      step('Stop all work at height on site and secure the area below from falling objects', SAFETY),
      step('Call the site Fire Brigade contact (101/112) immediately — suspension trauma can be fatal within minutes', SEC),
      step('Do not attempt a rescue that puts the rescuer at risk of a second fall', SAFETY),
      step('Encourage a suspended person to keep their legs moving or use relief straps', FIRST_AID),
      step('Use the MEWP or rescue kit to bring the casualty down if trained and safe to do so', SAFETY),
      step('Lay the casualty down flat and monitor — do not sit them upright abruptly', FIRST_AID),
      step('Treat for shock and monitor breathing continuously until paramedics arrive', FIRST_AID),
      step('Quarantine the harness, lanyard and anchor for inspection — never reuse after arrest', SAFETY),
      step('Review the permit to work and fall protection plan before work resumes', MGR),
    ],
    equipment: ['Rescue kit / descender', 'Suspension relief straps', 'Spare harness & lanyards', 'MEWP', 'First aid kit', 'Barriers'],
    team: [SAFETY, FIRST_AID, IC, MGR],
  },
  {
    scenario: 'Confined Space Rescue',
    title: 'Confined space emergency',
    description: 'Response to a person collapsed or overcome inside a tank, pit, duct or pump room.',
    triggers: 'Entrant unresponsive or not answering · gas monitor alarm · loss of communication with entrant',
    steps: [
      step('NEVER enter to rescue without breathing apparatus — most confined space deaths are would-be rescuers', SAFETY),
      step('Call the site Fire Brigade contact (101/112) for a technical rescue team immediately', SEC),
      step('Attempt non-entry rescue first using the tripod, winch and the entrant\'s retrieval line', SAFETY),
      step('Increase ventilation and continue atmospheric monitoring from outside', SAFETY),
      step('Account for everyone who entered using the permit and entry log', IC),
      step('Only BA-trained rescuers with a standby person may enter, under the permit system', SAFETY),
      step('Give oxygen and monitor breathing once the casualty is in fresh air', FIRST_AID),
      step('Preserve gas readings, the permit and equipment for investigation', SAFETY),
      step('Suspend all confined space work pending investigation', MGR),
    ],
    equipment: ['Tripod & retrieval winch', 'Full-body harness with retrieval line', 'Gas detector (multi-gas)', 'SCBA / airline BA', 'Forced ventilation fan', 'Resuscitation kit'],
    team: [SAFETY, IC, FIRST_AID, SEC],
  },
  {
    scenario: 'Structural Collapse',
    title: 'Structural collapse or falling structure',
    description: 'Response to collapse of ceiling, mezzanine, racking, false ceiling or scaffolding.',
    triggers: 'Cracking or collapse of structure · racking failure · ceiling or fixture falling',
    steps: [
      step('Evacuate the whole building immediately — assume further collapse is possible', ALL),
      step('Call the site Fire Brigade contact (101/112) and state that people may be trapped', SEC),
      step('Do not enter the debris field or move rubble — leave this to trained rescue teams', ALL),
      step('Establish a wide cordon and keep the assembly point well clear of the affected structure', SEC),
      step('Take a headcount and give rescuers a list of anyone unaccounted for and their last known position', MGR),
      step('Isolate electricity, gas and water to the affected area', SAFETY),
      step('Shout to and listen for trapped persons from a safe position and pass locations to rescuers', IC),
      step('Do not re-occupy any part of the building until a structural engineer certifies it', IC),
    ],
    equipment: ['Cordon tape & barriers', 'Torches', 'Megaphone', 'Attendance/visitor register', 'Utility isolation keys'],
    team: [IC, SEC, SAFETY, MGR],
  },
  {
    scenario: 'Severe Weather / Cyclone',
    title: 'Cyclone and severe weather — before, during and after',
    description: 'Preparation for and response to cyclone, storm, lightning or hail warnings.',
    triggers: 'IMD cyclone or severe weather warning · lightning within 10 km · high wind or hail forecast',
    steps: [
      step('BEFORE: Track official IMD warnings and brief all staff on the shelter locations', MGR),
      step('BEFORE: Secure or bring indoors all loose outdoor items, signage and equipment', SAFETY),
      step('BEFORE: Check the generator, torches, batteries, water and first aid stock', SAFETY),
      step('BEFORE: Consider early closure and safe travel home for members and staff', MGR),
      step('DURING: Move everyone away from glazing, skylights and external doors into the shelter area', SEC),
      step('DURING: Suspend all outdoor and pool activity at the first lightning or thunder', SAFETY),
      step('DURING: Stay sheltered for 30 minutes after the last thunder before resuming outdoor use', SAFETY),
      step('DURING: Do not evacuate into the open during high winds unless the building is unsafe', IC),
      step('AFTER: Inspect for structural damage, water ingress, and live fallen cables before reopening', SAFETY),
      step('AFTER: Report damage, log corrective actions and account for all staff', MGR),
    ],
    equipment: ['Torches & batteries', 'Battery radio', 'Drinking water stock', 'First aid kit', 'Sandbags', 'Generator fuel'],
    team: [MGR, IC, SAFETY, SEC],
  },
  {
    scenario: 'Power Outage / Shelter in Place',
    title: 'Power outage and shelter in place',
    description: 'Response to loss of mains power, or an instruction to shelter in place rather than evacuate.',
    triggers: 'Mains power failure · instruction from authorities to remain indoors · external hazard makes evacuation unsafe',
    steps: [
      step('Check emergency lighting has activated and account for everyone present', MGR),
      step('Stop treadmills, pool pumps and any equipment that could restart unexpectedly on restoration', SAFETY),
      step('Assist members in dark areas — changing rooms, stairwells, sauna — to a lit area', SEC),
      step('Check no one is trapped in a lift; call the lift rescue contact and reassure occupants', SEC),
      step('Close the pool until filtration and supervision lighting are restored', SAFETY),
      step('SHELTER IN PLACE: Move everyone to the designated internal shelter area away from windows', SEC),
      step('SHELTER IN PLACE: Close and lock external doors, and keep everyone together until stood down', IC),
      step('Communicate status to members every 15 minutes to prevent panic', MGR),
      step('Restore equipment in a controlled sequence once power returns, checking each before use', SAFETY),
    ],
    equipment: ['Emergency lighting', 'Torches', 'Lift rescue contact list', 'Battery radio', 'Generator'],
    team: [MGR, SEC, SAFETY, IC],
  },
  {
    scenario: 'Water Outage',
    title: 'Loss of water supply',
    description: 'Response to interruption of the water supply affecting sanitation, pool operation and fire systems.',
    triggers: 'No supply at outlets · tank empty · notice of supply interruption',
    steps: [
      step('Confirm the extent and expected duration with the supplier or building management', MGR),
      step('Check whether the fire suppression supply and hose reels are affected — a critical safety issue', SAFETY),
      step('Arrange tanker supply or bottled drinking water for members and staff', MGR),
      step('Close showers and any facility that cannot meet hygiene standards', MGR),
      step('Suspend pool operation if make-up water or backwashing is not possible', SAFETY),
      step('Post clear notices at the entrance and inform members proactively', MGR),
      step('If the fire supply is compromised, arrange a fire watch and consider closing the site', IC),
      step('Flush and test water quality before resuming showers and pool use', SAFETY),
    ],
    equipment: ['Bottled water stock', 'Tanker supplier contacts', 'Water testing kit', 'Notices/signage'],
    team: [MGR, SAFETY, IC],
  },
  {
    scenario: 'Suspicious Package',
    title: 'Suspicious package or unattended item',
    description: 'Response to an unattended, unexpected or threatening package found on the premises.',
    triggers: 'Unattended bag or package · package with wires, powder, odd smell or excessive wrapping · threat received',
    steps: [
      step('Do NOT touch, move, open or submerge the item', ALL),
      step('Do not use mobile phones or radios near the item', ALL),
      step('Clear the immediate area and cordon at least 100 m where possible', SEC),
      step('Call the site Police contact (100/112) and report exactly what was seen and where', SEC),
      step('Evacuate along routes that do not pass the item; use an alternative assembly point', IC),
      step('Identify and keep back the person who found it to brief the police', SEC),
      step('Preserve CCTV covering the area and the period before discovery', SEC),
      step('Do not allow re-entry until the police declare the site safe', IC),
      step('If a threat was received, record the caller\'s exact words, time and any background noise', MGR),
    ],
    equipment: ['Cordon tape', 'Alternative assembly point map', 'CCTV access', 'Threat call checklist'],
    team: [SEC, IC, MGR],
  },
  {
    scenario: 'Security Threat',
    title: 'Violent intruder or armed aggressor',
    description: 'Response to an aggressive intruder, physical assault or weapon on the premises.',
    triggers: 'Weapon seen · violent or threatening behaviour · intruder refusing to leave · assault in progress',
    steps: [
      step('RUN: If there is a safe route out, leave immediately and encourage others to follow', ALL),
      step('HIDE: If escape is not possible, lock or barricade a room, silence phones and stay out of sight', ALL),
      step('TELL: Call the site Police contact (100/112) when safe; describe the person, weapon and location quietly', ALL),
      step('Do not attempt to confront or disarm an armed aggressor', ALL),
      step('Lock down reception and stop further entry to the premises', SEC),
      step('Account for staff and members from a safe location; do not conduct a headcount in the open', MGR),
      step('Keep hands visible and follow all police instructions when they arrive', ALL),
      step('Provide CCTV, access logs and member records to the police on request', SEC),
      step('Arrange counselling/EAP support for everyone affected', HR_),
      step('Review access control and lone-working arrangements after the event', SAFETY),
    ],
    equipment: ['Lockdown keys', 'Panic alarm', 'CCTV access', 'Emergency contact list'],
    team: [SEC, IC, MGR, HR_],
  },
  {
    scenario: 'Natural Disaster',
    title: 'Earthquake and flood response',
    description: 'Response to earthquake shaking or flooding of the premises.',
    triggers: 'Ground shaking felt · flood warning · water entering the building',
    steps: [
      step('EARTHQUAKE: Drop, cover and hold on — get under sturdy furniture away from glass and weights', ALL),
      step('EARTHQUAKE: Stay inside until the shaking stops; do not run outside during shaking', ALL),
      step('EARTHQUAKE: Evacuate after shaking stops, using stairs, and expect aftershocks', IC),
      step('FLOOD: Move people and critical records to a higher level; never walk through moving water', SAFETY),
      step('FLOOD: Isolate electrical supply to any area that may flood, before water reaches it', SAFETY),
      step('Take a headcount at the assembly point and report anyone missing', MGR),
      step('Check for injuries, gas leaks, fallen fixtures and damaged racking before anyone re-enters', SAFETY),
      step('Do not re-occupy the building until it is inspected and declared structurally safe', IC),
      step('Log damage and corrective actions, and review the plan afterwards', SAFETY),
    ],
    equipment: ['Torches', 'First aid kit', 'Battery radio', 'Drinking water', 'Utility isolation keys'],
    team: [IC, SAFETY, MGR, SEC],
  },
]

async function main() {
  const replace = process.argv.includes('--replace')
  const cred = await signInWithEmailAndPassword(auth, 'admin@acme.test', 'password123')
  const me = (await getDoc(doc(db, 'users', cred.user.uid))).data()
  const orgId = me.orgId

  const col = collection(db, 'organizations', orgId, 'erpRescuePlans')
  const existing = (await getDocs(col)).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.kind === 'baseline')

  if (replace && existing.length) {
    const del = writeBatch(db)
    for (const p of existing) del.delete(doc(col, p.id))
    await del.commit()
    console.log(`Removed ${existing.length} existing baseline plan(s)`)
  }
  const covered = new Set(replace ? [] : existing.map((p) => p.scenario))

  const todo = PLANS.filter((p) => !covered.has(p.scenario))
  if (!todo.length) {
    console.log('All baseline scenarios already present — nothing to do.')
    process.exit(0)
  }

  const batch = writeBatch(db)
  for (const p of todo) {
    batch.set(doc(col), {
      kind: 'baseline',
      baselineId: '',
      baselineName: '',
      customized: false,
      siteId: '', siteName: '', region: '', entity: '',
      scenario: p.scenario,
      title: p.title,
      description: p.description,
      triggers: p.triggers,
      assemblyPoint: 'Primary Assembly Point (confirm per site)',
      steps: p.steps.map((s, i) => ({ id: `st-${i}`, order: i + 1, action: s.action, responsible: s.responsible })),
      team: p.team.map((role, i) => ({ id: `tm-${i}`, role, name: '', phone: '', uid: '' })),
      equipment: p.equipment,
      status: 'approved',
      reviewedOn: new Date().toISOString().slice(0, 10),
      nextReviewOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      createdAt: serverTimestamp(),
      createdBy: cred.user.uid,
      createdByName: me.name || 'Admin',
    })
  }
  await batch.commit()

  console.log(`✓ Seeded ${todo.length} baseline ERP plan(s) for org ${orgId}:`)
  for (const p of todo) console.log(`   • ${p.scenario} — ${p.title} (${p.steps.length} steps)`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
