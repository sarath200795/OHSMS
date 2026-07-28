import { PROCEDURE_STATUS } from '../../constants/procedures'
import { PERMISSIONS } from '../../constants/roles'
import { useAuth } from '../../context/AuthContext'
import Button from '../ui/Button'

const STEPS = [
  { key: PROCEDURE_STATUS.DRAFT, label: 'Draft' },
  { key: PROCEDURE_STATUS.PENDING_APPROVAL, label: 'Pending approval' },
  { key: PROCEDURE_STATUS.APPROVED, label: 'Approved' },
]

function stepIndex(status) {
  if (status === PROCEDURE_STATUS.APPROVED) return 2
  if (status === PROCEDURE_STATUS.PENDING_APPROVAL) return 1
  return 0 // draft or rejected
}

export default function ApprovalFlow({ procedure, busy, onSend, onApprove, onReject }) {
  const { can } = useAuth()
  const status = procedure.status
  const rejected = status === PROCEDURE_STATUS.REJECTED
  const active = stepIndex(status)

  return (
    <div className="mb-6 rounded-2xl bg-claySurface p-5 shadow-clay">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-steel-400">
          Approval flow
        </h2>
        {procedure.approvedByName && status === PROCEDURE_STATUS.APPROVED && (
          <span className="text-xs text-steel-400">
            Approved by {procedure.approvedByName}
          </span>
        )}
      </div>

      {/* Stepper */}
      <div className="mt-4 flex items-center">
        {STEPS.map((s, i) => {
          const done = i < active
          const current = i === active && !rejected
          const isApprovedStep = i === 2 && status === PROCEDURE_STATUS.APPROVED
          const circleCls = isApprovedStep
            ? 'bg-safe text-white'
            : current
            ? 'bg-hazard text-ink'
            : done
            ? 'bg-steel-600 text-white'
            : 'bg-steel-800 text-steel-400'
          return (
            <div key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold shadow-clay ${circleCls}`}>
                  {done || isApprovedStep ? '✓' : i + 1}
                </div>
                <span className={`mt-1.5 text-[11px] font-medium ${current || isApprovedStep ? 'text-steel-100' : 'text-steel-400'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-2 h-1 flex-1 rounded-full ${i < active ? 'bg-steel-500' : 'bg-steel-800'}`} />
              )}
            </div>
          )
        })}
      </div>

      {rejected && (
        <div className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          This procedure was <strong>rejected</strong>. Revise it and resubmit for approval.
        </div>
      )}

      {/* Contextual actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {can(PERMISSIONS.PROCEDURE_SEND_FOR_APPROVAL) &&
          (status === PROCEDURE_STATUS.DRAFT || status === PROCEDURE_STATUS.REJECTED) && (
            <Button size="sm" loading={busy} onClick={onSend}>
              Send for approval →
            </Button>
          )}
        {can(PERMISSIONS.PROCEDURE_APPROVE) && status === PROCEDURE_STATUS.PENDING_APPROVAL && (
          <>
            <Button size="sm" loading={busy} onClick={onApprove}>
              ✓ Approve
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={onReject}>
              Reject
            </Button>
          </>
        )}
        {status === PROCEDURE_STATUS.APPROVED && (
          <span className="text-sm text-safe">✓ Approved — LOTO actions are enabled.</span>
        )}
      </div>
    </div>
  )
}
