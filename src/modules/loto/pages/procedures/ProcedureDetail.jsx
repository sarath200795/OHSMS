import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import ProcedureView from '../../components/procedures/ProcedureView'
import ApprovalFlow from '../../components/procedures/ApprovalFlow'
import Button from '../../components/ui/Button'
import { FullScreenLoader } from '../../components/ui/Spinner'
import { PERMISSIONS } from '../../constants/roles'
import { PROCEDURE_STATUS } from '../../constants/procedures'
import {
  approveProcedure,
  deleteProcedure,
  getProcedurePhotos,
  rejectProcedure,
  sendForApproval,
  subscribeProcedure,
} from '../../services/procedures'

export default function ProcedureDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, can } = useAuth()
  const [procedure, setProcedure] = useState(undefined) // undefined = loading
  const [photos, setPhotos] = useState({})
  const [action, setAction] = useState(false)

  useEffect(() => {
    const unsub = subscribeProcedure(
      id,
      (p) => setProcedure(p),
      () => setProcedure(null),
    )
    return unsub
  }, [id])

  useEffect(() => {
    let active = true
    getProcedurePhotos(id).then((ph) => active && setPhotos(ph))
    return () => {
      active = false
    }
  }, [id])

  if (procedure === undefined) return <FullScreenLoader label="Loading procedure…" />
  if (procedure === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-steel-400">
        Procedure not found.{' '}
        <button onClick={() => navigate('/loto/inventory')} className="text-amber-600">
          Back to inventory
        </button>
      </div>
    )
  }

  const wrap = (fn, okMsg) => async () => {
    setAction(true)
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
    } catch (err) {
      toast.error(err.message || 'Action failed')
    } finally {
      setAction(false)
    }
  }

  const onPdf = () =>
    toast.promise(
      import('../../utils/pdf').then((m) => m.generateProcedurePdf(procedure, photos)),
      {
        loading: 'Building procedure PDF…',
        success: 'PDF downloaded',
        error: 'Could not generate PDF',
      },
    )
  const onTags = () =>
    toast.promise(
      import('../../utils/pdf').then((m) => m.generateTagsPdf(procedure)),
      {
        loading: 'Building energy tags…',
        success: 'Tags downloaded',
        error: 'Could not generate tags',
      },
    )

  async function onDelete() {
    if (!window.confirm(`Delete procedure "${procedure.equipment}"? This cannot be undone.`))
      return
    setAction(true)
    try {
      await deleteProcedure(procedure)
      toast.success('Procedure deleted')
      navigate('/loto/inventory')
    } catch (err) {
      toast.error(err.message || 'Delete failed')
      setAction(false)
    }
  }

  const headerActions = (
    <>
      <Button size="sm" variant="steel" onClick={onPdf}>
        Generate PDF
      </Button>
      <Button size="sm" variant="steel" onClick={onTags}>
        Generate tags
      </Button>

      {can(PERMISSIONS.PROCEDURE_REVISE) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/loto/procedures/${procedure.id}/revise`)}
        >
          Revise
        </Button>
      )}

      {can(PERMISSIONS.PROCEDURE_DELETE) && (
        <Button size="sm" variant="danger" disabled={action} onClick={onDelete}>
          Delete
        </Button>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button
        onClick={() => navigate('/loto/inventory')}
        className="mb-4 text-sm text-steel-400 hover:text-amber-600"
      >
        ← Back to inventory
      </button>

      <ApprovalFlow
        procedure={procedure}
        busy={action}
        onSend={wrap(() => sendForApproval(procedure.id), 'Sent for approval')}
        onApprove={wrap(() => approveProcedure(procedure.id, profile), 'Approved')}
        onReject={wrap(() => rejectProcedure(procedure.id), 'Rejected')}
      />

      {procedure.status === PROCEDURE_STATUS.APPROVED && can(PERMISSIONS.LOTO_PERFORM) && (
        <div className="mb-4 rounded-2xl bg-claySurface px-4 py-3 text-sm text-steel-300 shadow-clay">
          🔧 Lock / unlock this equipment from the{' '}
          <button onClick={() => navigate(`/loto/operations/${procedure.id}`)} className="font-semibold text-amber-600">
            LOTO Operations
          </button>{' '}
          tab.
        </div>
      )}
      <ProcedureView procedure={procedure} photos={photos} headerActions={headerActions} />
    </div>
  )
}
