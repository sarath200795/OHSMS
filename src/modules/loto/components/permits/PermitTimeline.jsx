import Card from '../ui/Card'
import { toMs } from '../../utils/permitWindow'

const LABEL = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  started: 'Isolation complete — work started',
  extended: 'Window extended',
  returned: 'Returned — equipment released',
  emergency_removed: 'Emergency removal',
}

const fmt = (ms) =>
  Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/**
 * The permit's history: the recorded events, with the first line — the request —
 * taken from the permit itself (an event cannot be written in the same commit as
 * the document it is about).
 */
export default function PermitTimeline({ permit, events = [] }) {
  const rows = [
    {
      id: 'requested',
      type: 'requested',
      at: toMs(permit.requestedAt),
      byName: permit.requestedByName,
      note: '',
    },
    ...events.map((e) => ({ id: e.id, type: e.type, at: toMs(e.at), byName: e.byName, note: e.note })),
  ]
  return (
    <Card animate={false} className="mt-4 !p-5">
      <h2 className="font-semibold text-steel-100">History</h2>
      <ol className="mt-3 space-y-3 border-l border-steel-700 pl-4">
        {rows.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="font-semibold text-steel-100">{LABEL[r.type] || r.type}</div>
            <div className="text-xs text-steel-400">
              {fmt(r.at)}
              {r.byName ? ` · ${r.byName}` : ''}
            </div>
            {r.note && <div className="mt-0.5 text-xs text-steel-300">{r.note}</div>}
          </li>
        ))}
      </ol>
    </Card>
  )
}
