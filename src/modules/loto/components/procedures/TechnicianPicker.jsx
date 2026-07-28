import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'

export default function TechnicianPicker({
  open,
  title = 'Assign technician',
  subtitle = 'Select the authorized technician applying this lock.',
  technicians = [],
  excludeIds = [],
  onSelect,
  onClose,
}) {
  const list = technicians.filter((t) => t.active !== false && !excludeIds.includes(t.id))
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      {list.length === 0 ? (
        <p className="text-sm text-steel-400">
          No authorized technicians yet. Add them in the{' '}
          <Link to="/loto/technicians" className="font-semibold text-amber-600">
            Technicians
          </Link>{' '}
          tab.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onSelect({ techId: t.id, name: t.name, lockNo: t.lockNo })}
                className="flex w-full items-center justify-between rounded-xl bg-clay px-3.5 py-2.5 text-left shadow-clay-inset transition-colors hover:bg-steel-800"
              >
                <span className="font-semibold text-steel-100">{t.name}</span>
                <span className="rounded-md bg-hazard px-2 py-0.5 text-xs font-bold text-ink">
                  #{t.lockNo || '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={onClose}
        className="mt-4 w-full rounded-xl border border-steel-700 py-2 text-sm font-medium text-steel-300 hover:border-steel-500"
      >
        Cancel
      </button>
    </Modal>
  )
}
