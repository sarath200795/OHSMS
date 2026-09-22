// One line each for the sign-in roster. The registry descriptions are written
// for the dashboard, where a paragraph has room; pasting them beside the form
// pushed the page below the fold. A missing key falls back to that paragraph
// so a new module cannot appear nameless.
const LOGIN_BRIEF = {
  incidents: 'Report, investigate, track CAPA',
  hira: 'Hazard register and risk matrix',
  inspections: 'Checklists and findings',
  audit: 'ISO 45001 plans and actions',
  ptw: 'Raise, approve, close permits',
  loto: 'Energy isolation records',
  equipment: 'Extinguishers, AEDs, alarms',
  drills: 'Fire and emergency drills',
  committee: 'Meetings, minutes, actions',
  training: 'Courses and expiry alerts',
  documents: 'Policies, SOPs, and SDS',
  emergency: 'Contacts and evacuation plans',
  objectives: 'OH&S targets and scorecard',
  weather: 'Site conditions as work risk',
  cctv: 'Cameras, recorders, and health',
  stakeholder: 'Escalations and legal matters',
  actions: 'Open actions across modules',
}

export function loginBrief(module) {
  return LOGIN_BRIEF[module.key] || module.description
}
