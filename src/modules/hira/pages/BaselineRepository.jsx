import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Layers, FilePlus2, MapPinned, Pencil, Eye } from 'lucide-react'
import { PageHeader } from '../components/ui'
import { useRa } from '../context/RaContext'

const countHazards = (a) => (a.activities || []).reduce((n, act) => n + (act.hazards?.length || 0), 0)

/**
 * Baseline (activity-level) risk assessments — reusable templates that seed
 * site-level assessments. Create a site RA from a baseline, then edit it to add
 * site-specific risks / control measures.
 */
export default function BaselineRepository() {
  const { assessments } = useRa()
  const baselines = useMemo(() => assessments.filter((a) => a.kind === 'baseline'), [assessments])

  return (
    <div>
      <PageHeader
        title="Baseline Risk Assessments"
        subtitle="Activity-level templates reused to build site assessments"
        icon={Layers}
      >
        <Link to="/hira/create?kind=baseline" className="btn-primary">
          <FilePlus2 size={16} /> New baseline
        </Link>
      </PageHeader>

      {baselines.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-clay-100 text-ink-400 shadow-clay-inset">
            <Layers size={26} />
          </span>
          <div>
            <p className="font-semibold text-ink-800">No baselines yet</p>
            <p className="mt-1 text-sm text-ink-500">
              Create an activity-level baseline, then generate site assessments from it.
            </p>
          </div>
          <Link to="/hira/create?kind=baseline" className="btn-primary">
            <FilePlus2 size={16} /> New baseline
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {baselines.map((b) => (
            <div key={b.id} className="card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 shadow-clay-sm">
                  <Layers size={20} />
                </span>
                <span className="chip bg-clay-100 text-ink-600">
                  {(b.activities || []).length} activities · {countHazards(b)} hazards
                </span>
              </div>
              <div>
                <p className="font-semibold text-ink-900">{b.name}</p>
                {b.refId && <p className="text-xs text-ink-400">{b.refId}</p>}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <Link to={`/hira/create?from=${b.id}`} className="btn-primary !px-2.5 !py-1.5 text-xs">
                  <MapPinned size={14} /> Create site assessment
                </Link>
                <Link to={`/hira/create/${b.id}`} className="btn-ghost !px-2.5 !py-1.5 text-xs">
                  <Pencil size={14} /> Edit
                </Link>
                <Link to={`/hira/assessment/${b.id}`} className="btn-ghost !px-2.5 !py-1.5 text-xs">
                  <Eye size={14} /> View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
