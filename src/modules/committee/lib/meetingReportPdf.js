import { createElement } from 'react'
import MeetingMinutesDoc from '../components/MeetingMinutesDoc'
import { captureReactPdf } from '../../../shared/print/mailedReport'

/** The minutes sheet, as a stored PDF. '' when capture cannot run. */
export function captureMeetingReport(orgId, meeting, siteLabel) {
  if (!meeting) return Promise.resolve('')
  const ref = meeting.docId || 'meeting'
  return captureReactPdf(
    orgId,
    `Meeting-Minutes-${ref}.pdf`,
    createElement(MeetingMinutesDoc, { meeting, siteLabel: siteLabel || '—' })
  )
}
