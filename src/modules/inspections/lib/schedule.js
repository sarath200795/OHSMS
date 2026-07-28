// ─────────────────────────────────────────────────────────────────────────────
// Pure scheduling/date math (no React, no Firebase). Ported from the OHSMS
// inspection scheduler so the calendar can explode recurring templates and
// one-off/recurring assignments into concrete due-date occurrences.
// ─────────────────────────────────────────────────────────────────────────────

export const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Bi-Annually', 'Annually']
export const ASSIGNMENT_FREQUENCIES = ['One-off', ...FREQUENCIES]
export const STATUSES = ['Draft', 'Active', 'Inactive']
export const QUESTION_TYPES = ['Pass/Fail', 'Single Choice', 'Multiple Choice', 'Text Input', 'Number']
export const CHOICE_TYPES = ['Single Choice', 'Multiple Choice']
export const PHOTO_REQUIREMENTS = ['Not Required', 'Optional', 'Mandatory']

export const parseDateOnly = (dateStr) => {
  if (!dateStr) return null
  const [year, month, day] = String(dateStr).split('T')[0].split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

export const formatDateOnly = (date) => {
  const parsed = date instanceof Date ? date : parseDateOnly(date)
  if (!parsed || isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

export const addFrequencyToDate = (date, frequency) => {
  const next = new Date(date)
  switch (frequency) {
    case 'Daily': next.setDate(next.getDate() + 1); break
    case 'Weekly': next.setDate(next.getDate() + 7); break
    case 'Monthly': next.setMonth(next.getMonth() + 1); break
    case 'Quarterly': next.setMonth(next.getMonth() + 3); break
    case 'Bi-Annually': next.setMonth(next.getMonth() + 6); break
    case 'Annually': next.setFullYear(next.getFullYear() + 1); break
    default: next.setMonth(next.getMonth() + 1)
  }
  return next
}

export const addDays = (date, days) => {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export const subtractDays = (date, days) => addDays(date, -days)

const getRecordScheduleDate = (record) => {
  if (record.scheduledFor) return record.scheduledFor
  if (record.dueString) return record.dueString
  return record.completedAt ? String(record.completedAt).split('T')[0] : ''
}

/**
 * Expand a recurring assignment window into pending (not-yet-completed)
 * occurrences up to rangeEnd. Slots already satisfied by a past record are
 * skipped. Returns [{ date, dateString, alertStartString }].
 */
export const getPendingOccurrences = ({ assignedFrom, assignedTo, frequency, pastRecords = [], rangeEnd }) => {
  const startDate = parseDateOnly(assignedFrom)
  if (!startDate) return []

  const endDate = parseDateOnly(assignedTo)
  const effectiveRangeEnd = rangeEnd instanceof Date ? rangeEnd : parseDateOnly(rangeEnd)
  if (!effectiveRangeEnd || isNaN(effectiveRangeEnd.getTime())) return []

  const completedSlots = new Set(pastRecords.map(getRecordScheduleDate).filter(Boolean))
  let cursor = new Date(startDate)
  let safety = 0
  const occurrences = []

  while (safety < 1000) {
    if (endDate && cursor > endDate) break
    const dateString = formatDateOnly(cursor)
    if (!completedSlots.has(dateString)) {
      const withinRange = cursor <= effectiveRangeEnd
      const withinWindow = !endDate || cursor <= endDate
      if (withinRange && withinWindow) {
        occurrences.push({
          date: new Date(cursor),
          dateString,
          alertStartString: formatDateOnly(subtractDays(cursor, 7)),
        })
      }
    }
    cursor = addFrequencyToDate(cursor, frequency)
    safety += 1
    if (cursor > effectiveRangeEnd && (!endDate || cursor > endDate)) break
  }

  return occurrences
}

// ── Template field helpers ──────────────────────────────────────────────────────
export const normalizeQuestionType = (v) => (QUESTION_TYPES.includes(v) ? v : 'Pass/Fail')
export const normalizePhotoRequirement = (v) => (PHOTO_REQUIREMENTS.includes(v) ? v : 'Not Required')

export const normalizeTemplateField = (field = {}, index = 0) => ({
  id: field.id || `field-${Date.now()}-${index}`,
  label: field.label || '',
  type: normalizeQuestionType(field.type),
  photoRequirement: normalizePhotoRequirement(field.photoRequirement),
  options: Array.isArray(field.options) ? field.options.map((s) => String(s).trim()).filter(Boolean) : [],
})

export const normalizeTemplateFields = (fields = []) => fields.map((f, i) => normalizeTemplateField(f, i))

export const hasAnsweredQuestion = (field, response) => {
  const answer = response?.answer
  if (field.type === 'Pass/Fail') return ['Pass', 'Fail', 'N/A'].includes(answer)
  if (field.type === 'Multiple Choice') return Array.isArray(answer) && answer.length > 0
  return String(answer ?? '').trim() !== ''
}

/** Score = % of binary Pass/Fail answers that came back Pass (text/number ignored). */
export const scoreResponses = (responses = {}) => {
  const values = Object.values(responses)
  const pass = values.filter((r) => r?.answer === 'Pass').length
  const fail = values.filter((r) => r?.answer === 'Fail').length
  const denom = pass + fail
  const score = denom === 0 ? 100 : Math.round((pass / denom) * 100)
  return { score, pass, fail, result: score >= 90 ? 'PASS' : 'FAIL' }
}

export const emptyTemplate = () => ({
  title: '',
  desc: '',
  siteId: '',
  siteName: '',
  frequency: 'Monthly',
  status: 'Draft',
  assignedFrom: '',
  assignedTo: '',
  fields: [],
  assignments: [],
})

/**
 * Build the full list of scheduled tasks for a calendar range from templates +
 * their assignments. Each task = { templateId, title, siteId, siteName, area,
 * frequency, dueDate, dueString, alertStartString, assignmentId?, template }.
 */
export const buildScheduledTasks = ({ templates, records, currentMonth }) => {
  const tasks = []
  const todayString = formatDateOnly(new Date())
  const todayDate = parseDateOnly(todayString)
  const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
  const rangeEnd = monthEnd > addDays(todayDate, 7) ? monthEnd : addDays(todayDate, 7)

  // 1) Active templates with a recurring assignment window.
  templates
    .filter((t) => t.status === 'Active' && t.assignedFrom)
    .forEach((t) => {
      if (t.assignedTo && t.assignedTo < todayString) return
      const pastRecords = records
        .filter((r) => r.templateId === t.id && !r.assignmentId)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      getPendingOccurrences({
        assignedFrom: t.assignedFrom,
        assignedTo: t.assignedTo,
        frequency: t.frequency,
        pastRecords,
        rangeEnd,
      }).forEach((occ) => {
        tasks.push({
          templateId: t.id,
          title: t.title,
          siteId: t.siteId || '',
          siteName: t.siteName || '',
          area: '',
          frequency: t.frequency,
          dueDate: occ.date,
          dueString: occ.dateString,
          alertStartString: occ.alertStartString,
          template: t,
        })
      })
    })

  // 2) Per-assignment scheduling (one-off + recurring).
  templates.forEach((t) => {
    const assignments = Array.isArray(t.assignments) ? t.assignments : []
    assignments.forEach((a) => {
      if (!a || a.status !== 'Pending' || !a.scheduledDate) return
      const base = {
        templateId: t.id,
        title: t.title,
        siteId: a.siteId || t.siteId || '',
        siteName: a.siteName || t.siteName || '',
        area: a.area || '',
        isAssignment: true,
        assignmentId: a.id,
        assignmentNotes: a.notes || '',
        template: t,
      }
      if (!a.frequency) {
        tasks.push({
          ...base,
          frequency: 'One-off',
          dueDate: parseDateOnly(a.scheduledDate),
          dueString: a.scheduledDate,
          alertStartString: a.scheduledDate,
        })
        return
      }
      const pastForAssignment = records
        .filter((r) => r.assignmentId === a.id)
        .sort((x, y) => new Date(y.completedAt) - new Date(x.completedAt))
      getPendingOccurrences({
        assignedFrom: a.scheduledDate,
        assignedTo: a.endDate,
        frequency: a.frequency,
        pastRecords: pastForAssignment,
        rangeEnd,
      }).forEach((occ) => {
        tasks.push({
          ...base,
          frequency: a.frequency,
          dueDate: occ.date,
          dueString: occ.dateString,
          alertStartString: occ.alertStartString,
        })
      })
    })
  })

  return tasks.sort((a, b) => a.dueDate - b.dueDate)
}
