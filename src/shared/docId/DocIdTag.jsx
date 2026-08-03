/**
 * A record's document id, rendered the same way everywhere.
 *
 * Monospaced so a column of them lines up and a wrong digit is visible, and
 * quiet enough that it does not compete with the title it sits under — it is
 * what you quote, not what you scan for.
 *
 * Renders nothing at all when a record has no id. Records created before the
 * scheme existed have none until an admin runs the backfill, and a dash in
 * every row would read as a gap in the data rather than a job not yet done.
 */
export default function DocIdTag({ id, className = '', title }) {
  if (!id) return null
  return (
    <span
      title={title || 'Document ID'}
      className={`inline-block font-mono text-[11px] tracking-tight text-ink-400 ${className}`}
    >
      {id}
    </span>
  )
}

/** The same thing for a table cell, where it is the row's primary handle. */
export function DocIdCell({ id }) {
  if (!id) return <span className="text-ink-300">—</span>
  return <span className="font-mono text-[11.5px] text-ink-600">{id}</span>
}
