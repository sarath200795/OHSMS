// Who set an assignee, recorded only when the assignee actually changed.
//
// The assignment-mail trigger reads this to skip a person assigning work to
// themselves and to name the assigner. Stamping it on every save would
// replace the original assigner the next time someone edited the due date,
// and a save by the owner would then look self-assigned.

/**
 * `previous` and `next` are the action arrays. `uidField` is `ownerUid` on
 * incident and illness actions. Items with no id are left unmarked: without
 * an id a reorder cannot be told from a new row, and attributing the whole
 * array to whoever saved last is worse than leaving the assigner unknown.
 */
export function stampNewAssignees(previous, next, actorUid, uidField = 'ownerUid') {
  if (!Array.isArray(next) || typeof actorUid !== 'string' || !actorUid) return next
  const prevById = new Map()
  if (Array.isArray(previous)) {
    for (const item of previous) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id) {
        const prior = item[uidField]
        prevById.set(item.id, typeof prior === 'string' ? prior : '')
      }
    }
  }
  return next.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return item
    const uid = typeof item[uidField] === 'string' ? item[uidField] : ''
    if (!uid) return item
    const known = prevById.has(item.id)
    if (known && prevById.get(item.id) === uid) return item
    return { ...item, assignedByUid: actorUid }
  })
}
