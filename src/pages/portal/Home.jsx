// ─────────────────────────────────────────────────────────────────────────────
// Portal home.
//
// The question this screen answers is "what needs me?", not "what exists?".
// Everything on it is either something assigned to this person or one tap from
// a thing they came here to do — which is why the module grid sits below the
// fold and the four task cards sit above it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, ClipboardCheck, BookOpen, ArrowRight, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../shared/auth/AuthContext'
import { subscribeActions, NORM_BY_KEY } from '../../modules/actions/lib/sources'
import { subscribeAssignments, subscribeCourses } from '../../modules/training/lib/firestore'
import { Raised, SectionLabel, StatTile, Ring } from './ui'
import { myActions, courseProgress } from './myWork'

const QUICK = [
  {
    key: 'incident',
    to: '/portal/report',
    icon: AlertTriangle,
    title: 'Report an incident',
    blurb: 'Injury, damage or anything that went wrong.',
    from: '#e77a64', via: '#a63c2a',
  },
  {
    key: 'near-miss',
    to: '/portal/report?type=near_miss',
    icon: Eye,
    title: 'Log a near miss',
    blurb: 'Nothing happened — but it nearly did.',
    from: '#8ba7bd', via: '#5b7f9c',
  },
  {
    key: 'permit',
    to: '/permits',
    icon: ClipboardCheck,
    title: 'Request a permit',
    blurb: 'Hot work, height, confined space, electrical.',
    from: '#8fbc74', via: '#4f8b53',
  },
  {
    key: 'docs',
    to: '/documents',
    icon: BookOpen,
    title: 'Find a document',
    blurb: 'SOPs, SDS sheets and site safety rules.',
    from: '#e8a33d', via: '#c07a17',
  },
]

const greeting = (d = new Date()) => {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function PortalHome() {
  const { orgId, profile } = useAuth()
  const navigate = useNavigate()
  const [actions, setActions] = useState([])
  const [assignments, setAssignments] = useState([])
  const [courses, setCourses] = useState([])

  useEffect(() => {
    if (!orgId) return undefined
    const unsubs = [
      subscribeActions(orgId, setActions),
      subscribeAssignments(orgId, setAssignments),
      subscribeCourses(orgId, setCourses),
    ]
    return () => unsubs.forEach((u) => u && u())
  }, [orgId])

  const mine = useMemo(() => myActions(actions, profile), [actions, profile])
  const open = useMemo(() => mine.filter((a) => a.norm !== 'done'), [mine])
  const allCerts = useMemo(
    () => courseProgress(assignments, courses, profile),
    [assignments, courses, profile]
  )
  const certs = allCerts.slice(0, 3)
  // "Current" means the certificate is still in date — not merely that the
  // course was once completed. Counting every 100% row would have called an
  // expired forklift licence current, which is the opposite of what this
  // number is for.
  const current = allCerts.filter((c) => c.state === 'valid' || c.state === 'none').length

  const firstName = (profile?.name || '').split(' ')[0] || 'there'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  // The lede names what is actually waiting rather than asserting a number the
  // reader then has to go and verify.
  const overdue = open.filter((a) => a.overdue).length
  const dueSoon = open.length - overdue
  const lede = open.length === 0
    ? 'Nothing is waiting on you right now. Report anything you see and it lands with the HSE team the same minute.'
    : `${overdue ? `${overdue} overdue ` : ''}${overdue && dueSoon ? 'and ' : ''}${dueSoon ? `${dueSoon} open ` : ''}` +
      `action${open.length === 1 ? '' : 's'} assigned to you. Your training record is below.`

  return (
    <div className="animate-fade-in-up">
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Raised className="relative overflow-hidden px-7 py-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 90% at 96% 12%, rgba(221,90,65,.14), transparent 65%),' +
                'radial-gradient(50% 80% at 88% 96%, rgba(127,196,187,.16), transparent 60%)',
            }}
          />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{today}</p>
          <h1 className="relative mt-2 text-[30px] font-extrabold leading-[1.15] tracking-[-0.025em] text-ink-900">
            {greeting()}, {firstName}.
          </h1>
          <p className="relative mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-500">{lede}</p>
          <div className="relative mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/portal/actions')}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-100 px-4 py-2.5 text-[13px] font-semibold text-brand-700 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.97]"
            >
              {open.length ? `My ${open.length} open action${open.length === 1 ? '' : 's'}` : 'My actions'}
              <ArrowRight size={14} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/portal/training')}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-clay-surface px-4 py-2.5 text-[13px] font-semibold text-ink-700 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.97]"
            >
              Training
            </button>
          </div>
        </Raised>

        <Raised className="flex flex-col gap-3.5 p-5">
          <SectionLabel className="tracking-[0.14em]">My site this month</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <StatTile value={open.length} caption={`open action${open.length === 1 ? '' : 's'}`} />
            <StatTile value={current} caption={`certification${current === 1 ? '' : 's'} in date`} />
          </div>
          <div className="flex items-center gap-3 rounded-[18px] bg-brand-50 px-3.5 py-3">
            <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-xl bg-accent-teal text-white">
              <ShieldCheck size={17} strokeWidth={2.3} />
            </span>
            <p className="text-[12.5px] leading-relaxed text-ink-700">
              Anything you report reaches the HSE team immediately —{' '}
              <b className="text-ink-900">no name required</b>.
            </p>
          </div>
        </Raised>
      </div>

      <SectionLabel className="mb-3">What do you need to do?</SectionLabel>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK.map((q, i) => (
          <button
            key={q.key}
            type="button"
            onClick={() => navigate(q.to)}
            style={{ animationDelay: `${i * 60}ms` }}
            className="flex animate-fade-in-up flex-col items-start gap-3.5 rounded-[26px] bg-clay-surface p-5 text-left shadow-clay transition duration-200 ease-emil hover:-translate-y-1 hover:shadow-clay active:scale-[0.985]"
          >
            <span
              className="grid h-[52px] w-[52px] place-items-center rounded-[20px] text-white shadow-clay-sm"
              style={{ background: `linear-gradient(135deg, ${q.from}, ${q.via})` }}
            >
              <q.icon size={25} strokeWidth={2.1} />
            </span>
            <span className="block">
              <span className="block text-[15px] font-bold tracking-[-0.015em] text-ink-900">{q.title}</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-500">{q.blurb}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Raised className="p-5">
          <div className="mb-3.5 flex items-baseline justify-between">
            <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-900">Assigned to me</p>
            {mine.length > 3 && (
              <button
                type="button"
                onClick={() => navigate('/portal/actions')}
                className="text-xs font-semibold text-brand-700"
              >
                See all {mine.length}
              </button>
            )}
          </div>
          {open.length === 0 ? (
            <p className="rounded-[18px] bg-clay-50 px-4 py-5 text-center text-[13px] text-ink-400 shadow-clay-sm">
              Nothing assigned to you.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {open.slice(0, 3).map((a) => (
                <div
                  key={a.key}
                  className="flex items-center gap-3.5 rounded-[18px] bg-clay-50 px-4 py-3 shadow-clay-sm transition-transform duration-200 ease-emil hover:translate-x-[3px]"
                >
                  <span
                    className="h-[34px] w-1 flex-none rounded"
                    style={{ background: NORM_BY_KEY[a.norm]?.color || '#ab987f' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-ink-900">{a.title}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-400">{a.sourceLabel}</p>
                  </div>
                  <span
                    className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                      a.overdue ? 'bg-red-100 text-red-700' : 'bg-clay-100 text-ink-600'
                    }`}
                  >
                    {a.overdue ? 'Overdue' : a.due || 'No date'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Raised>

        <Raised className="p-5">
          <p className="mb-3.5 text-[15px] font-bold tracking-[-0.015em] text-ink-900">Certifications</p>
          {certs.length === 0 ? (
            <p className="rounded-[18px] bg-clay-50 px-4 py-5 text-center text-[13px] text-ink-400 shadow-clay-sm">
              No courses assigned to you yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {certs.map((c) => (
                <div key={c.key} className="flex items-center gap-3.5">
                  <Ring pct={c.pct} color={c.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{c.name}</p>
                    <p className="mt-0.5 text-[11.5px]" style={{ color: c.color }}>{c.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/portal/training')}
            className="mt-4 w-full rounded-2xl bg-clay-surface py-2.5 text-[12.5px] font-semibold text-ink-700 shadow-clay-sm transition-transform duration-200 ease-emil active:scale-[0.97]"
          >
            Open my training record
          </button>
        </Raised>
      </div>
    </div>
  )
}
