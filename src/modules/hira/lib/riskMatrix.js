// ─────────────────────────────────────────────────────────────────────────────
// GEMS 5×5 risk matrix (from the "2 - Risks-Control Guidance" workbook sheet).
// Risk score = Probability × Severity, mapped to 6 named bands. The band labels
// were verified cell-by-cell against the workbook matrix.
// ─────────────────────────────────────────────────────────────────────────────

export const PROBABILITY = [
  { value: 1, label: 'Highly Unlikely', hint: 'Can assume will not occur. Controls conform to best practice and standards.' },
  { value: 2, label: 'Unlikely', hint: 'Could occur at some time / recorded once in the industry. Controls in place but below best practice.' },
  { value: 3, label: 'Possible', hint: 'Can reasonably be expected to occur / recorded several times in the industry. Controls insufficient.' },
  { value: 4, label: 'Likely', hint: 'Expected to occur several times / recorded once within the company. Few controls, rely on behaviour.' },
  { value: 5, label: 'Very Likely', hint: 'Likely within a short period / recorded more than once within the company. No control in place.' },
]

export const SEVERITY = [
  { value: 1, label: 'Negligible', people: 'Minor non-reportable injury or illness, no medical treatment.', environment: 'Slight impact; no sensitive impact on ground/air/water.' },
  { value: 2, label: 'Minor', people: 'Minor recordable injury requiring medical treatment; may lead to LTI without physical consequences.', environment: 'Minor impact on localized ground; spill contained.' },
  { value: 3, label: 'Significant', people: 'Significant injury requiring medical treatment (fracture, stitches, reportable).', environment: 'Localized effect; 1–2 yrs natural recovery; spill <100 m³.' },
  { value: 4, label: 'Major', people: 'Permanent incapacity (amputation, loss of eye, permanent serious illness).', environment: 'National impact; 2–5 yrs recovery; spill <1000 m³.' },
  { value: 5, label: 'Extensive', people: 'Fatality.', environment: 'International impact; >2–5 yrs recovery; spill >1000 m³.' },
]

// Band definitions keyed by score range (inclusive). Order = ascending severity.
// `permissible` = Negligible+Low (workbook "permissible risk").
// `acceptable`  = score ≤ 6 (Negligible/Low/Medium) — the threshold the Risk
//                 Register uses to split Acceptable vs Non-Acceptable risks.
export const BANDS = [
  { key: 'negligible',  label: 'Negligible',  min: 1,  max: 2,  color: '#15803d', permissible: true,  acceptable: true },
  { key: 'low',         label: 'Low',         min: 3,  max: 4,  color: '#65a30d', permissible: true,  acceptable: true },
  { key: 'medium',      label: 'Medium',      min: 5,  max: 6,  color: '#ca8a04', permissible: false, acceptable: true },
  { key: 'substantial', label: 'Substantial', min: 7,  max: 10, color: '#ea580c', permissible: false, acceptable: false },
  { key: 'high',        label: 'High',        min: 11, max: 16, color: '#dc2626', permissible: false, acceptable: false },
  { key: 'critical',    label: 'Critical',    min: 17, max: 25, color: '#991b1b', permissible: false, acceptable: false },
]

// Risk acceptance / action guidance per band (verbatim intent from the workbook).
export const ACTION_GUIDANCE = {
  negligible: 'No risk treatment required. Review annually.',
  low: 'Generally acceptable. Implement any further reasonable controls. Review annually.',
  medium: 'Risk treatment should be considered (apply ALARP). Review annually.',
  substantial: 'Risk treatment must be considered. Task shall not proceed unless shown to be ALARP; aim to reduce to Medium.',
  high: 'Task shall not be carried out. Reduce risk to ALARP before proceeding. Review within 6 months.',
  critical: 'Task shall not be carried out. Highest priority — reduce to ALARP; requires senior management notification & approval.',
}

export function bandFor(score) {
  return BANDS.find((b) => score >= b.min && score <= b.max) || null
}

/** Risk level for a Probability × Severity pair. Returns null if either is unset. */
export function riskLevel(probability, severity) {
  const p = Number(probability)
  const s = Number(severity)
  if (!p || !s) return null
  const score = p * s
  const band = bandFor(score)
  if (!band) return null
  return {
    score,
    key: band.key,
    band: band.key,
    label: band.label,
    color: band.color,
    permissible: band.permissible,
    acceptable: band.acceptable,
    guidance: ACTION_GUIDANCE[band.key],
  }
}

// 5×5 grid of cells for rendering the matrix. Rows = severity (5→1 top to bottom),
// cols = probability (1→5 left to right).
export const MATRIX_CELLS = SEVERITY.slice().reverse().map((sev) =>
  PROBABILITY.map((prob) => {
    const score = prob.value * sev.value
    const band = bandFor(score)
    return { probability: prob.value, severity: sev.value, score, ...band }
  })
)
