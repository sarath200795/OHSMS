// ─────────────────────────────────────────────────────────────────────────────
// CSV bulk import/export for risk assessments. Flat schema: one row per
// (hazard + control). Rows are grouped on import into assessments → activities →
// hazards, with controls collected from repeated rows. Responsible-person names
// are auto-added as internal members.
// ─────────────────────────────────────────────────────────────────────────────
import Papa from 'papaparse'
import { uid } from './id'
import { CONTROL_HIERARCHY, CONTROL_STATUS, HAZARD_CATEGORIES, HAZARD_TYPES } from './constants'
import { riskLevel } from './riskMatrix'
import { downloadText } from '../../../shared/lib/download'

export const CSV_COLUMNS = [
  'Assessment Name',
  'Region',
  'Entity',
  'Site',
  'Location',
  'Members',
  'Assessment Date',
  'Activity',
  'Who Might Be Harmed',
  'Hazard Group',
  'Hazard Category',
  'Hazard Type',
  'Specific Location',
  'Probability',
  'Severity',
  'Control Hierarchy',
  'Control Description',
  'Responsible Person',
  'Department',
  'Control Status',
  'ALARP',
  'Additional Control Hierarchy',
  'Additional Control Description',
  'Projected Probability',
  'Projected Severity',
]

const HIERARCHY_KEYS = CONTROL_HIERARCHY.map((c) => c.key)
const STATUS_KEYS = CONTROL_STATUS.map((s) => s.key)

const trim = (v) => (v == null ? '' : String(v).trim())
const truthy = (v) => ['yes', 'true', '1', 'y'].includes(trim(v).toLowerCase())
const ps = (v) => {
  const n = parseInt(trim(v), 10)
  return n >= 1 && n <= 5 ? n : null
}

// Site-scope columns are dropped from the baseline template (baselines are
// activity-level templates, not tied to a site).
const SITE_SCOPE_COLUMNS = ['Region', 'Entity', 'Site', 'Location']

/** Columns for a template of the given kind (baseline omits site-scope columns). */
export const templateColumns = (kind = 'site') =>
  kind === 'baseline' ? CSV_COLUMNS.filter((c) => !SITE_SCOPE_COLUMNS.includes(c)) : CSV_COLUMNS

/** Build & download a CSV template. Baseline templates omit the site-scope columns. */
export function downloadTemplate(kind = 'site') {
  const isBaseline = kind === 'baseline'
  const columns = templateColumns(kind)
  const example = [
    {
      'Assessment Name': 'Loading Dock Operations',
      Region: 'North',
      Entity: 'Acme Mfg',
      Site: 'HYD8',
      Location: 'Inbound Dock',
      Members: 'Site Safety Lead; Shift Manager',
      'Assessment Date': '2026-06-01',
      Activity: 'Unloading trailers',
      'Who Might Be Harmed': 'Dock associates',
      'Hazard Group': 'Safety',
      'Hazard Category': 'Motorized_Vehicle_Operation',
      'Hazard Type': 'Interaction (PIT/Pedestrians)',
      'Specific Location': 'Dock door 12',
      Probability: 3,
      Severity: 4,
      'Control Hierarchy': 'Engineering Control',
      'Control Description': 'Pedestrian barriers and segregated walkways',
      'Responsible Person': 'Site Safety Lead',
      Department: 'EHS',
      'Control Status': 'Implemented',
      ALARP: 'No',
      'Additional Control Hierarchy': 'Administrative Control',
      'Additional Control Description': 'PIT/pedestrian interaction training',
      'Projected Probability': 2,
      'Projected Severity': 4,
    },
    {
      'Assessment Name': 'Loading Dock Operations',
      Region: 'North',
      Entity: 'Acme Mfg',
      Site: 'HYD8',
      Location: 'Inbound Dock',
      Members: 'Site Safety Lead; Shift Manager',
      'Assessment Date': '2026-06-01',
      Activity: 'Unloading trailers',
      'Who Might Be Harmed': 'Dock associates',
      'Hazard Group': 'Health',
      'Hazard Category': 'Ergonomic',
      'Hazard Type': 'Manual handling',
      'Specific Location': 'Dock door 12',
      Probability: 3,
      Severity: 2,
      'Control Hierarchy': 'Administrative Control',
      'Control Description': 'Team-lift policy for >15kg parcels',
      'Responsible Person': 'Shift Manager',
      Department: 'Operations',
      'Control Status': 'In Progress',
      ALARP: 'Yes',
      'Additional Control Hierarchy': '',
      'Additional Control Description': '',
      'Projected Probability': '',
      'Projected Severity': '',
    },
  ]
  const csv = Papa.unparse({ fields: columns, data: example.map((r) => columns.map((c) => r[c] ?? '')) })
  downloadText(csv, isBaseline ? 'hira-baseline-template.csv' : 'hira-site-template.csv', { bom: false })
}

/**
 * Parse a CSV File into grouped assessments.
 * Returns { assessments, errors, totalRows } where errors = [{ row, issues }].
 */
export function parseCsv(file, kind = 'site') {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          resolve(buildAssessments(res.data, kind))
        } catch (e) {
          reject(e)
        }
      },
      error: reject,
    })
  })
}

const splitMembers = (v) =>
  trim(v)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)

function buildAssessments(rows, kind = 'site') {
  const isBaseline = kind === 'baseline'
  const errors = []
  const map = new Map() // key: name||site → assessment builder

  rows.forEach((raw, i) => {
    const rowNo = i + 2 // +1 header, +1 to 1-based
    const name = trim(raw['Assessment Name'])
    const region = trim(raw['Region'])
    const entity = trim(raw['Entity'])
    const site = trim(raw['Site'])
    const activity = trim(raw['Activity'])
    const type = trim(raw['Hazard Type'])
    const category = trim(raw['Hazard Category'])
    const prob = ps(raw['Probability'])
    const sev = ps(raw['Severity'])

    const issues = []
    if (!name) issues.push('Assessment Name is required')
    if (!activity) issues.push('Activity is required')
    if (!type && !category) issues.push('Hazard Type or Category is required')
    if (!prob) issues.push('Probability must be 1–5')
    if (!sev) issues.push('Severity must be 1–5')
    // Site assessments must carry Region / Entity / Site; baselines must not.
    if (!isBaseline) {
      if (!region) issues.push('Region is required for site assessments')
      if (!entity) issues.push('Entity is required for site assessments')
      if (!site) issues.push('Site is required for site assessments')
    }

    const hier = trim(raw['Control Hierarchy'])
    if (hier && !HIERARCHY_KEYS.includes(hier)) issues.push(`Control Hierarchy must be one of: ${HIERARCHY_KEYS.join(', ')}`)
    const addHier = trim(raw['Additional Control Hierarchy'])
    if (addHier && !HIERARCHY_KEYS.includes(addHier)) issues.push(`Additional Control Hierarchy invalid`)

    if (issues.length) {
      errors.push({ row: rowNo, issues })
      return
    }

    const key = `${name.toLowerCase()}||${isBaseline ? '' : site.toLowerCase()}`
    if (!map.has(key)) {
      map.set(key, {
        name,
        region: isBaseline ? '' : region,
        entity: isBaseline ? '' : entity,
        siteName: isBaseline ? '' : site,
        location: isBaseline ? '' : trim(raw['Location']),
        assessmentDate: trim(raw['Assessment Date']),
        members: new Map(), // name(lower) → member
        activities: new Map(), // title(lower) → { title, hazards: Map }
      })
    }
    const a = map.get(key)

    // Members involved (Members column, ; or , separated) — internal members.
    splitMembers(raw['Members']).forEach((mName) => {
      const mk = mName.toLowerCase()
      if (!a.members.has(mk)) {
        a.members.set(mk, { id: uid('m'), name: mName, email: '', role: '', department: '', type: 'internal' })
      }
    })

    // Resolve group/category: if category missing, infer from type's category.
    const cat = category || inferCategory(type)
    const group = trim(raw['Hazard Group']) || groupForCategory(cat)

    // Responsible person → internal member.
    const respName = trim(raw['Responsible Person'])
    let responsibleMemberId
    if (respName) {
      const mk = respName.toLowerCase()
      if (!a.members.has(mk)) {
        a.members.set(mk, { id: uid('m'), name: respName, email: '', role: '', department: trim(raw['Department']), type: 'internal' })
      }
      responsibleMemberId = a.members.get(mk).id
    }

    // Activity.
    const ak = activity.toLowerCase()
    if (!a.activities.has(ak)) a.activities.set(ak, { title: activity, hazards: new Map() })
    const act = a.activities.get(ak)

    // Hazard signature groups controls under one hazard.
    const hsig = [trim(raw['Who Might Be Harmed']), cat, type, trim(raw['Specific Location']), prob, sev].join('||').toLowerCase()
    if (!act.hazards.has(hsig)) {
      act.hazards.set(hsig, {
        id: uid('h'),
        description: '',
        whoMightBeHarmed: trim(raw['Who Might Be Harmed']),
        hazardGroup: group,
        hazardCategory: cat,
        hazardType: type,
        specificLocation: trim(raw['Specific Location']),
        probability: prob,
        severity: sev,
        controls: [],
        alarp: truthy(raw['ALARP']),
        additionalControls: [],
        projectedProbability: ps(raw['Projected Probability']) || null,
        projectedSeverity: ps(raw['Projected Severity']) || null,
      })
    }
    const hz = act.hazards.get(hsig)

    // Control.
    const cdesc = trim(raw['Control Description'])
    if (cdesc) {
      hz.controls.push({
        id: uid('c'),
        hierarchy: hier || 'Administrative Control',
        description: cdesc,
        responsibleMemberId,
        department: trim(raw['Department']),
        status: STATUS_KEYS.includes(trim(raw['Control Status'])) ? trim(raw['Control Status']) : 'Open',
      })
    }

    // Additional control (ignored if ALARP).
    const adesc = trim(raw['Additional Control Description'])
    if (adesc && !hz.alarp) {
      hz.additionalControls.push({
        id: uid('c'),
        hierarchy: addHier || 'Administrative Control',
        description: adesc,
        responsibleMemberId,
        department: trim(raw['Department']),
        status: STATUS_KEYS.includes(trim(raw['Control Status'])) ? trim(raw['Control Status']) : 'Open',
      })
    }
  })

  const built = Array.from(map.values()).map((a) => ({
    name: a.name,
    region: a.region,
    entity: a.entity,
    siteName: a.siteName,
    location: a.location,
    assessmentDate: a.assessmentDate,
    members: Array.from(a.members.values()),
    activities: Array.from(a.activities.values()).map((act) => ({
      id: uid('a'),
      title: act.title,
      hazards: Array.from(act.hazards.values()),
    })),
  }))

  // Members involved are required for every assessment (baseline & site).
  const assessments = []
  for (const a of built) {
    if (a.members.length === 0) {
      errors.push({ row: '—', issues: [`Assessment “${a.name}” has no members — add a Members column value`] })
    } else {
      assessments.push(a)
    }
  }

  return { assessments, errors, totalRows: rows.length }
}

function inferCategory(type) {
  for (const cat of Object.keys(HAZARD_TYPES)) {
    if (HAZARD_TYPES[cat].includes(type)) return cat
  }
  return ''
}

function groupForCategory(catKey) {
  return HAZARD_CATEGORIES.find((c) => c.key === catKey)?.group || ''
}

/** Quick preview rows (one per hazard) for the import confirmation table. */
export function previewRows(assessments) {
  const out = []
  for (const a of assessments) {
    for (const act of a.activities) {
      for (const h of act.hazards) {
        const r = riskLevel(h.probability, h.severity)
        out.push({
          assessment: a.name,
          site: a.siteName,
          activity: act.title,
          hazard: h.hazardType || h.hazardCategory,
          risk: r ? `${r.label} (${r.score})` : '—',
          controls: (h.controls?.length || 0) + (h.additionalControls?.length || 0),
          alarp: h.alarp ? 'Yes' : 'No',
        })
      }
    }
  }
  return out
}
