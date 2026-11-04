// The line burned into a lock photo. Time, the person, the permit number and
// the equipment — the four things a later reader has to be able to see without
// opening the record.

export function lockPhotoStamp({ at = Date.now(), userName = '', permitNo = '', equipment = '' } = {}) {
  const when = new Date(at).toISOString()
  return [when, userName || 'Unknown', permitNo || 'permit', equipment || 'equipment'].join(' | ')
}
