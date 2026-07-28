import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import CategoryBadges from './CategoryBadges'
import { healthColor, toDate, daysUntil, dateFieldState, hasDateIssue } from '../lib/extinguisherLogic'
import { STATUS_LABEL, STATUS_COLOR, REGION_COLORS } from '../lib/constants'
import { Badge } from './ui'

function fmt(value) {
  const d = toDate(value)
  return d ? format(d, 'dd MMM yyyy') : '—'
}

/** Due-date cell that turns amber/red as the date approaches/passes. */
function DueCell({ value }) {
  const state = dateFieldState(value)
  // Surface data-quality problems instead of a silent "—".
  if (state === 'invalid') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-600" title="This date is stored in an invalid format — please edit and re-save this unit.">
        <AlertTriangle size={12} /> Invalid date
      </span>
    )
  }
  if (state === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600" title="No date recorded — add one to track this unit's due status.">
        Not set
      </span>
    )
  }
  const days = daysUntil(value)
  let color = '#64748b'
  if (days <= 0) color = '#dc2626'
  else if (days <= 30) color = '#f59e0b'
  return (
    <div className="leading-tight">
      <div className="font-medium text-ink-800">{fmt(value)}</div>
      <div className="text-[11px] font-semibold" style={{ color }}>
        {days <= 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`}
      </div>
    </div>
  )
}

/**
 * Reusable, animated extinguisher table.
 * Props:
 *  - items, today
 *  - selectable, selectedIds (Set), onToggle(id), onToggleAll(ids)
 *  - showStatus (status badge col), showDefectChips (condition col)
 *  - renderActions(ext) → JSX for the row's action cell
 *  - onRowClick(ext)
 */
export default function ExtinguisherTable({
  items,
  today = new Date(),
  selectable = false,
  selectedIds,
  onToggle,
  onToggleAll,
  showStatus = true,
  showDefectChips = true,
  showActionBy = false,
  renderActions,
  onRowClick,
}) {
  const allSelected = selectable && items.length > 0 && items.every((e) => selectedIds?.has(e.id))

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-clay-100/70 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-brand-500"
                    checked={allSelected}
                    onChange={() => onToggleAll?.(items.map((e) => e.id))}
                  />
                </th>
              )}
              <th className="px-4 py-3">Serial / Type</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">Center</th>
              <th className="px-4 py-3">Next Refill</th>
              <th className="px-4 py-3">Next HPT</th>
              {showStatus && <th className="px-4 py-3">Status</th>}
              {showDefectChips && <th className="px-4 py-3">Condition</th>}
              {showActionBy && <th className="px-4 py-3">Action By</th>}
              {renderActions && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-clay-200/60">
            {items.map((ext, i) => {
              const selected = selectedIds?.has(ext.id)
              return (
                <motion.tr
                  key={ext.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4) }}
                  className={`group transition-colors ${
                    selected ? 'bg-brand-50/70' : 'hover:bg-ink-50/70'
                  } ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(ext) : undefined}
                  style={{ boxShadow: `inset 4px 0 0 ${healthColor(ext, today)}` }}
                >
                  {selectable && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-brand-500"
                        checked={!!selected}
                        onChange={() => onToggle?.(ext.id)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-bold text-ink-900">
                      {ext.serialNo || '—'}
                      {hasDateIssue(ext) && (
                        <AlertTriangle
                          size={13}
                          className="shrink-0 text-amber-500"
                          title="Missing or invalid refill/HPT date — please review this unit."
                        />
                      )}
                    </div>
                    <div className="text-xs text-ink-500">
                      {ext.type} · {ext.capacity}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink-700">{ext.entity}</span>
                  </td>
                  <td className="px-4 py-3">
                    {ext.region ? (
                      <Badge color={REGION_COLORS[ext.region] || '#64748b'}>{ext.region}</Badge>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{ext.centerName}</td>
                  <td className="px-4 py-3"><DueCell value={ext.dateOfNextRefill} /></td>
                  <td className="px-4 py-3"><DueCell value={ext.dateOfNextHPT} /></td>
                  {showStatus && (
                    <td className="px-4 py-3">
                      <Badge color={STATUS_COLOR[ext.status] || '#64748b'}>
                        {STATUS_LABEL[ext.status] || ext.status}
                      </Badge>
                    </td>
                  )}
                  {showDefectChips && (
                    <td className="px-4 py-3">
                      <CategoryBadges ext={ext} today={today} max={3} />
                    </td>
                  )}
                  {showActionBy && (
                    <td className="px-4 py-3">
                      {ext.lastActionBy ? (
                        <div className="leading-tight">
                          <div className="font-medium text-ink-800">{ext.lastActionBy}</div>
                          {ext.lastAction && <div className="text-[11px] text-ink-400">{ext.lastAction}</div>}
                        </div>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                  )}
                  {renderActions && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">{renderActions(ext)}</div>
                    </td>
                  )}
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
