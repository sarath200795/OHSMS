// One subject, HTML body and text fallback per assignment module.
//
// The kind strings are the ones planAssignmentMails stamps on a slot. A kind
// this map does not know still renders, through the generic fallback, so a
// new collection fails safe (a plain assignment mail) instead of throwing
// from the trigger after the write has already committed.
//
// Illness action text is health data even when it is still plaintext. The
// planner already stores an empty title for that kind. allowTitle: false is
// the same decision at the last step before the inbox, so a caller that
// passes the description anyway cannot put it in the mail.
import { safeOrigin } from '../mailer.js'
import { renderLayout } from './layout.js'
import { readableText, safeLine, safeMailPath } from './safe.js'

const INCIDENT = {
  label: 'Incident',
  headline: 'You have been assigned a corrective action.',
  contextLabel: 'Record',
  titleLabel: 'What',
  actionLabel: 'Open the incident',
  subjectLead: 'Incident CAPA',
  subjectBare: 'Incident CAPA assigned',
  subjectUsesContext: true,
}

const ILLNESS = {
  label: 'Illness',
  headline: 'You have been assigned a corrective action on an occupational illness record.',
  allowTitle: false,
  contextLabel: 'Record',
  titleLabel: 'What',
  actionLabel: 'Open the record',
  subjectLead: 'Illness action',
  subjectBare: 'Illness action assigned',
  subjectUsesContext: true,
}

const DRILL = {
  label: 'Mock drill',
  headline: 'You have been assigned a mock-drill corrective action.',
  contextLabel: 'Scenario',
  titleLabel: 'What',
  actionLabel: 'Open mock drills',
  subjectLead: 'Mock drill CAPA',
  subjectBare: 'Mock drill CAPA assigned',
  subjectUsesContext: true,
}

const TRAINING = {
  label: 'Training',
  headline: 'You have been assigned a training course.',
  // The planner's context for this kind is the word "Training", which repeats
  // the module label. The course name is the title, and that is the line a
  // person needs.
  contextFromTitle: true,
  contextLabel: 'Course',
  titleLabel: 'Course',
  actionLabel: 'Open my training',
  subjectLead: 'Training assigned',
  subjectBare: 'Training course assigned',
  subjectUsesContext: false,
}

const MODULES = {
  'assignment.incident_capa': INCIDENT,
  'assignment.illness_action': ILLNESS,
  'assignment.drill_capa': DRILL,
  'assignment.training': TRAINING,
}

const FALLBACK = {
  label: 'Assignment',
  contextLabel: 'Record',
  titleLabel: 'What',
  actionLabel: 'Open it',
  legacySubject: true,
}

export const ASSIGNMENT_TEMPLATE_KINDS = Object.keys(MODULES)

function actionTitle(plan, spec) {
  if (spec.allowTitle === false || !plan.includeTitle) return ''
  return safeLine(readableText(plan.title), 180)
}

function subjectFor(spec, { title, record, what }) {
  if (spec.legacySubject) {
    const name = title || what || 'assignment'
    return safeLine(record ? `Assigned: ${name} (${record})` : `Assigned: ${name}`, 120)
  }
  const lead = title ? `${spec.subjectLead}: ${title}` : spec.subjectBare
  const context = spec.subjectUsesContext ? record : ''
  return safeLine(context ? `${lead} (${context})` : lead, 120)
}

/**
 * `{ subject, text, html }` for one planned assignment. Fields that fail
 * readableText are omitted, not replaced with a placeholder — a blank line
 * is how a sealed title used to become ciphertext in a subject.
 */
export function renderAssignmentMessage(plan = {}, { assignerName = '', appOrigin = '' } = {}) {
  const spec = MODULES[plan.kind] || FALLBACK
  const what = safeLine(plan.what, 160)
  const title = actionTitle(plan, spec)
  const record = safeLine(readableText(plan.context), 80)
  const due = safeLine(readableText(plan.due), 40)
  const assigner = safeLine(readableText(assignerName), 80)
  const headline = spec.headline || `You have been assigned a ${what || 'task'}.`
  const subject = subjectFor(spec, { title, record, what })

  const rows = []
  if (spec.contextFromTitle) {
    if (title) rows.push({ label: spec.contextLabel, value: title })
  } else if (title) {
    rows.push({ label: spec.titleLabel, value: title })
  }
  if (!spec.contextFromTitle && record) rows.push({ label: spec.contextLabel, value: record })
  if (due) rows.push({ label: 'Due', value: due })
  if (assigner) rows.push({ label: 'Assigned by', value: assigner })

  const path = safeMailPath(plan.path)
  const origin = safeOrigin(appOrigin)
  const url = path && origin ? `${origin}${path}` : ''

  const { text, html } = renderLayout({
    subject,
    label: spec.label,
    headline,
    rows,
    actionLabel: spec.actionLabel,
    url,
    path,
  })
  return { subject, text, html }
}
