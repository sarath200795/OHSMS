// ─────────────────────────────────────────────────────────────────────────────
// App constants. The hazard taxonomy (groups → categories → types) is sourced
// from the GEMS operations risk-assessment workbook, sheet "3 - Hazard
// Categories". Do not hand-edit the taxonomy; regenerate from the workbook.
// ─────────────────────────────────────────────────────────────────────────────

// Hazard groups (top tier of the cascading selector).
export const HAZARD_GROUPS = [
  "Safety",
  "Health",
  "Environment"
]

// Categories: { key, label, group }. `key` is the stable id used in HAZARD_TYPES.
export const HAZARD_CATEGORIES = [
  {
    "key": "Electrical",
    "label": "Electrical",
    "group": "Safety"
  },
  {
    "key": "Thermal",
    "label": "Thermal",
    "group": "Safety"
  },
  {
    "key": "Gravity_Access",
    "label": "Gravity Access",
    "group": "Safety"
  },
  {
    "key": "Equipment_Mechanical",
    "label": "Equipment Mechanical",
    "group": "Safety"
  },
  {
    "key": "Radiation",
    "label": "Radiation",
    "group": "Safety"
  },
  {
    "key": "Motorized_Vehicle_Operation",
    "label": "Motorized Vehicle Operation",
    "group": "Safety"
  },
  {
    "key": "Biological",
    "label": "Biological",
    "group": "Health"
  },
  {
    "key": "Chemical",
    "label": "Chemical",
    "group": "Health"
  },
  {
    "key": "Ergonomic",
    "label": "Ergonomic",
    "group": "Health"
  },
  {
    "key": "Noise_Vibration_Work_Environment",
    "label": "Noise Vibration Work Environment",
    "group": "Health"
  },
  {
    "key": "Psychosocial",
    "label": "Psychosocial",
    "group": "Health"
  },
  {
    "key": "Air",
    "label": "Air",
    "group": "Environment"
  },
  {
    "key": "Land_Soil",
    "label": "Land Soil",
    "group": "Environment"
  },
  {
    "key": "Waste",
    "label": "Waste",
    "group": "Environment"
  },
  {
    "key": "Water",
    "label": "Water",
    "group": "Environment"
  },
  {
    "key": "Energy_Resource_Conservation",
    "label": "Energy Resource Conservation",
    "group": "Environment"
  }
]

// Map of category key → list of hazard types (second/third tiers of the cascade).
export const HAZARD_TYPES = {
  "Electrical": [
    "Broken plugs, sockets, switches",
    "Electricals exposed to liquids",
    "Electromagnetic phenomena",
    "Electro-static phenomena",
    "Exposed wiring/cords",
    "Fixed installations",
    "High voltage",
    "Live parts",
    "Incorrect wiring",
    "Insulation damage",
    "Low voltage",
    "Overloading",
    "Rodent damage",
    "Short circuit",
    "Thermal radiation",
    "Other"
  ],
  "Thermal": [
    "Explosion",
    "Fire/Flame",
    "Radiation from heat sources",
    "Contact with hot objects",
    "Contact with cold objects",
    "Hot works (e.g., welding)",
    "Other"
  ],
  "Gravity_Access": [
    "Confined space",
    "Excavations",
    "Falling/moving object or structure",
    "Obstruction of",
    "Projection of",
    "Suspended load",
    "Uneven or slippery surfaces",
    "Working at height",
    "Other"
  ],
  "Equipment_Mechanical": [
    "Acceleration, deceleration",
    "Air or high pressure fluid injection",
    "Burnt by",
    "Crushed by",
    "Cut by",
    "Drawing in",
    "Elastic elements",
    "Entangled by",
    "Equipment malfunction",
    "Friction/abrasion",
    "Instability",
    "Machinery mobility",
    "Pressure/vacuum",
    "Rough surface",
    "Severed by",
    "Slippery surface",
    "Struck by",
    "Unexpected start",
    "Other"
  ],
  "Radiation": [
    "Extra low frequency (ELF) radiation",
    "Infrared radiation",
    "Interference from other equipment",
    "Ionizing radiation (alpha, beta or gamma rays)",
    "Lasers",
    "LGACs laser generated air contaminants",
    "Low frequency electromagnetic radiation",
    "Other uncontained ionizing particles",
    "Uncontained x-rays",
    "Ultra violet radiation",
    "Microwave radiation",
    "Radiofrequency radiation",
    "Visible light",
    "Other"
  ],
  "Motorized_Vehicle_Operation": [
    "Interaction (PIT/Pedestrians)",
    "Interaction (PIT/Vehicle)",
    "Interaction (PIT/PIT)",
    "Interaction (PIT/Object)",
    "Interaction (Vehicle/Pedestrian)",
    "Interaction (Vehicle/Vehicle)",
    "Interaction (Vehicle/Object)",
    "Poor road conditions",
    "Poor vehicle design",
    "Vehicle malfunction",
    "Other"
  ],
  "Biological": [
    "Bit by",
    "Bacteria and viruses",
    "Blood or other bodily fluids",
    "Contaminated drinking water",
    "Contaminated sharps or equipment",
    "Fungi/ molds",
    "Human waste",
    "Stung by",
    "Other"
  ],
  "Chemical": [
    "Asbestos",
    "Carcinogenic substances",
    "Combustible materials",
    "Compressed gas",
    "Contaminated drinking water",
    "Corrosives",
    "Dust",
    "Enriched oxygen environment (>23.5% oxygen)",
    "Explosives",
    "Fibers",
    "Flammables",
    "Fluid",
    "Fumes and vapors",
    "Low oxygen environment (<19.5% oxygen)",
    "Mist",
    "Mutagenic or teratogenic substances",
    "Oxidizer",
    "Pharmaceuticals",
    "Poisons",
    "Smoking",
    "Vehicle exhausts",
    "Other"
  ],
  "Ergonomic": [
    "Awkward posture (technique)",
    "Design/location of controls",
    "Effort/force/exertion",
    "Head room/clearance",
    "Long duration",
    "Manual handling",
    "Mechanical handling",
    "Poor housekeeping",
    "Poor lighting and glare",
    "Poor workstation design",
    "Repetition/repetitive movement",
    "Restricted access",
    "Slippery surface",
    "Sustained/static postures",
    "Other"
  ],
  "Noise_Vibration_Work_Environment": [
    "Combustible material",
    "Flammable material",
    "Humidity",
    "Poor lighting",
    "Mobile equipment",
    "Moving parts",
    "Noise",
    "Over-crowding",
    "Poor ventilation",
    "Scraping surfaces",
    "Speed of process",
    "Temperature - High",
    "Temperature - Low",
    "Vibration",
    "Other"
  ],
  "Psychosocial": [
    "Bullying",
    "Criminal or malicious intent",
    "Conflicting demands",
    "Distraction",
    "Discrimination",
    "Harassment",
    "High/Low work demand",
    "Inadequate rest breaks",
    "Inadequate staffing",
    "International travel",
    "Intoxication",
    "Job insecurity",
    "Lack of role clarity",
    "Low control",
    "Personal medical condition",
    "Poor communication",
    "Poorly managed change",
    "Poor support",
    "Remote/isolated work",
    "Social support and conflict",
    "Terrorism",
    "Violence in the workplace",
    "Work duration or shift pattern",
    "Other"
  ],
  "Air": [
    "Ambient air pollution",
    "Dust/particulate generation",
    "Dark smoke generation",
    "Emergency release of pollutants",
    "Fire",
    "Light pollution",
    "Natural disaster",
    "Release of odor",
    "Routine release of pollutants",
    "Use of greenhouse gases",
    "Vapor intrusion",
    "Other"
  ],
  "Land_Soil": [
    "Disposal of hazardous waste",
    "Disposal of non-hazardous/solid waste",
    "Erosion",
    "Fire",
    "Generation of hazardous waste",
    "Generation of non-hazardous waste",
    "Handling hazardous waste",
    "Handling non-hazardous waste",
    "Land contamination",
    "Natural disaster",
    "Off-site soil remediation",
    "Presence of lead paint",
    "Presence of PCB",
    "Recycling waste",
    "Soil management",
    "Spills and leaks",
    "Storage of hazardous material",
    "Storage tanks: aboveground",
    "Storage tanks: underground",
    "Transport of hazardous waste",
    "Transport of non-hazardous waste",
    "Use of pesticides",
    "Wildfire/bushfire",
    "Other"
  ],
  "Waste": [
    "Disposal of hazardous waste",
    "Disposal of non-hazardous/solid waste",
    "Generation of hazardous waste",
    "Generation of non-hazardous waste",
    "Handling hazardous waste",
    "Handling non-hazardous waste",
    "Fire",
    "Natural disaster",
    "Presence of asbestos",
    "Presence of lead paint",
    "Presence of PCB",
    "Recycling waste",
    "Spills and leaks",
    "Storage of hazardous material",
    "Storage of non-hazardous material",
    "Storage tanks: aboveground",
    "Storage tanks: underground",
    "Transport of hazardous waste",
    "Transport of non-hazardous waste",
    "Use of pesticides",
    "Other"
  ],
  "Water": [
    "Disposal of hazardous material",
    "Disposal of non-hazardous material",
    "Discharge of process wastewater",
    "Discharge of stormwater",
    "Discharge of sanitary/domestic wastewater",
    "Drinking water backflow",
    "Dust/particulate generation",
    "Fire",
    "Natural disaster",
    "Presence of lead paint",
    "Presence of PCB",
    "Spills and leaks",
    "Storage of hazardous material",
    "Storage of non-hazardous material",
    "Storage tanks: aboveground",
    "Storage tanks: underground",
    "Transport of hazardous waste",
    "Transport of non-hazardous waste",
    "Use of pesticides",
    "Other"
  ],
  "Energy_Resource_Conservation": [
    "Consumption of coal",
    "Consumption of electricity",
    "Consumption of fuel oil",
    "Consumption of natural gas",
    "Consumption of renewable energy",
    "Consumption of packaging material",
    "Consumption of water/drinking water/process water",
    "Consumption of other natural resources",
    "Other"
  ]
}

export const categoriesForGroup = (group) =>
  HAZARD_CATEGORIES.filter((c) => c.group === group)

export const typesForCategory = (categoryKey) => HAZARD_TYPES[categoryKey] || []

export const categoryLabel = (key) =>
  HAZARD_CATEGORIES.find((c) => c.key === key)?.label || key

// ── Hierarchy of controls (most → least effective) ───────────────────────────
export const CONTROL_HIERARCHY = [
  { key: 'Elimination', label: 'Elimination', color: '#15803d' },
  { key: 'Substitution', label: 'Substitution', color: '#0d9488' },
  { key: 'Engineering Control', label: 'Engineering Control', color: '#2563eb' },
  { key: 'Administrative Control', label: 'Administrative Control', color: '#d97706' },
  { key: 'PPE', label: 'PPE', color: '#dc2626' },
]

// ── Control implementation status (drives the dashboard status chart) ─────────
export const CONTROL_STATUS = [
  { key: 'Open', label: 'Open', color: '#dc2626' },
  { key: 'In Progress', label: 'In Progress', color: '#d97706' },
  { key: 'Implemented', label: 'Implemented', color: '#16a34a' },
]

export const MEMBER_TYPES = [
  { key: 'internal', label: 'Internal' },
  { key: 'external', label: 'External' },
]

// ── Activity nature (routine vs non-routine vs emergency work) ────────────────
export const ACTIVITY_NATURE = ['Routine', 'Non-routine', 'Emergency']

// ── Assessment lifecycle status ───────────────────────────────────────────────
export const ASSESSMENT_STATUS = ['ACTIVE', 'DRAFT', 'ARCHIVED']
