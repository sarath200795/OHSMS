import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useTechnicians } from '../../hooks/useTechnicians'
import { useLocks } from '../../hooks/useLocks'
import { useOrgProcedures } from '../../hooks/useOrgProcedures'
import ProcedureView from '../../components/procedures/ProcedureView'
import PerformPanel from '../../components/procedures/PerformPanel'
import { FullScreenLoader } from '../../components/ui/Spinner'
import { PERMISSIONS } from '../../constants/roles'
import { PROCEDURE_STATUS } from '../../constants/procedures'
import { collectInUseLockNos } from '../../utils/lockout'
import { getProcedurePhotos, subscribeProcedure } from '../../services/procedures'

export default function OperateProcedure() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, can } = useAuth()
  const { technicians } = useTechnicians()
  const { locks } = useLocks()
  const { procedures } = useOrgProcedures()
  const inUseLockNos = useMemo(() => collectInUseLockNos(procedures), [procedures])
  const [procedure, setProcedure] = useState(undefined)
  const [photos, setPhotos] = useState({})

  useEffect(() => {
    const unsub = subscribeProcedure(id, (p) => setProcedure(p), () => setProcedure(null))
    return unsub
  }, [id])

  useEffect(() => {
    let active = true
    getProcedurePhotos(id).then((ph) => active && setPhotos(ph))
    return () => {
      active = false
    }
  }, [id])

  if (procedure === undefined) return <FullScreenLoader label="Loading equipment…" />
  if (procedure === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-steel-400">
        Procedure not found.{' '}
        <button onClick={() => navigate('/loto/operations')} className="text-amber-600">
          Back to operations
        </button>
      </div>
    )
  }

  const approved = procedure.status === PROCEDURE_STATUS.APPROVED
  const canPerform = approved && can(PERMISSIONS.LOTO_PERFORM)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button
        onClick={() => navigate('/loto/operations')}
        className="mb-4 text-sm text-steel-400 hover:text-amber-600"
      >
        ← Back to operations
      </button>

      {!approved && (
        <div className="mb-4 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-800 shadow-clay">
          ⚠️ This procedure is not approved yet — LOTO operations are disabled.
        </div>
      )}

      {canPerform && (
        <div className="mb-4">
          <PerformPanel
            procedure={procedure}
            technicians={technicians}
            locks={locks}
            inUseLockNos={inUseLockNos}
            user={profile}
          />
        </div>
      )}

      <ProcedureView procedure={procedure} photos={photos} />
    </div>
  )
}
