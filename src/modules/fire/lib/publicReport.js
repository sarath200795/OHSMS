// What a defect report may carry before it is written.
//
// createReport used to forward the note as typed. The rules cap it at 500 on
// the anonymous branch, and a longer note was refused as permission-denied,
// which this screen then described as "already reported". Checking here means
// the person holding the phone hears that the note is too long, and the write
// they do send is one the rule will accept.

import { TEXT, tooLong } from '../../../shared/validate/textCap'

export const REPORT_NOTE_MAX = TEXT.note

export function reportNoteIssue(note) {
  return tooLong(note, REPORT_NOTE_MAX, 'Note')
}

/** Clip the free strings a report writer sets. Tokens are not clipped: a cut token would not match the sticker. */
export function boundReportText(report = {}) {
  const clip = (value, max) => {
    if (value == null || value === '') return value ?? ''
    const text = String(value)
    return text.length <= max ? text : text.slice(0, max)
  }
  return {
    extLabel: clip(report.extLabel, TEXT.label),
    assetLabel: clip(report.assetLabel, TEXT.label),
    reportedByName: clip(report.reportedByName, TEXT.name),
    reporterRole: report.reporterRole ? clip(report.reporterRole, TEXT.role) : report.reporterRole,
    defect: report.defect == null ? report.defect : clip(report.defect, TEXT.defect),
    defectType:
      report.defectType == null ? report.defectType : clip(report.defectType, TEXT.defect),
    newStatus: report.newStatus == null ? report.newStatus : clip(report.newStatus, TEXT.status),
    note: clip(report.note, REPORT_NOTE_MAX),
  }
}
