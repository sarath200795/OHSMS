import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useLocks } from '../../hooks/useLocks'
import { usePermits } from '../../hooks/usePermits'
import { lockIntegrity, traceQuery } from '../../utils/lockRegister'
import PageHeader, { HdrIcon } from '../../components/PageHeader'
import Card from '../../components/ui/Card'
import Input from '../../components/ui/Input'
import Spinner from '../../components/ui/Spinner'

export default function Trace() {
  const { profile } = useAuth()
  const { locks, loading: locksLoading } = useLocks()
  const { permits, loading: permitsLoading } = usePermits()
  const [q, setQ] = useState('')
  const problems = useMemo(() => lockIntegrity(locks, permits), [locks, permits])
  const result = useMemo(() => traceQuery(q, { locks, permits }), [q, locks, permits])

  if (!profile) return null
  if (locksLoading || permitsLoading) {
    return <div className="py-16"><Spinner label="Loading the lock register…" /></div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        icon={<HdrIcon d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>} />}
        title="Trace a lock"
        subtitle="Scan or type a lock number, a tag number, or equipment."
      />
      {problems.length > 0 && (
        <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Register check</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}
      <Card animate={false} className="!p-5">
        <Input label="Lock, tag or equipment" value={q} onChange={(e) => setQ(e.target.value)} placeholder="D-1 or RED-1 or Pump A" />
        <div className="mt-4 text-sm text-steel-200">
          {result.kind === 'empty' && <p>Enter a code to see who holds it now and where it has been.</p>}
          {result.kind === 'none' && <p>Nothing in the register matches that.</p>}
          {result.kind === 'lock' && (
            <>
              <p>
                <span className="font-mono font-bold">{result.lock.lockNo}</span>
                {result.lock.tagNo ? ` · tag ${result.lock.tagNo}` : ''}
                {result.lock.color ? ` · ${result.lock.color}` : ''}
                {' · '}{result.lock.serviceStatus || 'available'}
                {' · '}used {result.useCount} time{result.useCount === 1 ? '' : 's'}
              </p>
              <p className="mt-2">
                Now: {result.now.length
                  ? result.now.map((p) => p.permitNo || p.id).join(', ')
                  : 'not on an open permit'}
              </p>
              <ul className="mt-3 space-y-1">
                {result.history.map((p) => (
                  <li key={p.id}>
                    <Link className="font-semibold text-amber-700" to={`/loto/permits/${p.permitNo || p.id}`}>
                      {p.permitNo || p.id}
                    </Link>
                    {' · '}{p.equipment || 'equipment'}{' · '}{p.status}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.kind === 'equipment' && (
            <ul className="space-y-1">
              {result.equipment.map((p) => (
                <li key={p.id}>
                  <Link className="font-semibold text-amber-700" to={`/loto/permits/${p.permitNo || p.id}`}>
                    {p.permitNo || p.id}
                  </Link>
                  {' · '}{(p.locks || []).map((l) => l.lockNo).filter(Boolean).join(', ') || 'no lock'}{' · '}{p.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}
