import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { subscribeEscalations, subscribeLegalIssues } from '../lib/firestore'
import { withLegal, withEscalation, summarise, repeatMembers } from '../lib/linkage'

const Ctx = createContext(null)

/**
 * Both collections in one place, because each is incomplete without the other.
 *
 * An escalation list that cannot say "this one produced an FIR" is a list of
 * complaints that all look equally settled, and a legal issue that cannot name
 * the complaint behind it loses the reason it happened. Subscribing separately
 * per page would mean each tab could only ever show half the picture.
 */
export function StakeholderProvider({ children }) {
  const { orgId, orgName } = useAuth()
  const [escalations, setEscalations] = useState([])
  const [legalIssues, setLegalIssues] = useState([])
  const [sites, setSites] = useState([])
  const [loaded, setLoaded] = useState({ escalations: false, legalIssues: false })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!orgId) return undefined
    setLoaded({ escalations: false, legalIssues: false })
    setError(null)

    // A failed listener hands back null. Rendering an empty list then would say
    // "no complaints" when the truth is "could not load them".
    const bind = (subscribe, set, key) =>
      subscribe(orgId, (rows, err) => {
        if (err) {
          setError(err)
          // …and still mark it loaded. `loading` is derived from these two
          // flags, and on the error path it used to stay true for ever: the
          // registers rendered a skeleton, and EscalationForm/LegalIssueForm —
          // whose "not found" branch is gated on `!loading` — sat on
          // <SkeletonDetail/> permanently rather than reaching the message that
          // explains what happened. `error` is the thing consumers should
          // react to; "still loading" was never true once the listener failed.
          return setLoaded((l) => ({ ...l, [key]: true }))
        }
        set(rows || [])
        setLoaded((l) => ({ ...l, [key]: true }))
      })

    const unsubs = [
      bind(subscribeEscalations, setEscalations, 'escalations'),
      bind(subscribeLegalIssues, setLegalIssues, 'legalIssues'),
      subscribeSites(orgId, (rows) => setSites(rows || [])),
    ]
    return () => unsubs.forEach((u) => u?.())
  }, [orgId])

  // Joined once here rather than per page, so every tab agrees about which
  // complaints turned into legal matters.
  const joinedEscalations = useMemo(() => withLegal(escalations, legalIssues), [escalations, legalIssues])
  const joinedLegal = useMemo(() => withEscalation(legalIssues, escalations), [legalIssues, escalations])
  const summary = useMemo(() => summarise(escalations, legalIssues), [escalations, legalIssues])
  const repeats = useMemo(() => repeatMembers(escalations), [escalations])

  const value = useMemo(
    () => ({
      orgId,
      orgName,
      sites,
      escalations: joinedEscalations,
      legalIssues: joinedLegal,
      rawEscalations: escalations,
      summary,
      repeats,
      error,
      loading: !(loaded.escalations && loaded.legalIssues),
      // For the "which complaint was this?" picker on a legal issue.
      escalationOptions: escalations.map((e) => ({
        value: e.id,
        label: `${e.docId ? `${e.docId} · ` : ''}${e.title}`,
      })),
    }),
    [orgId, orgName, sites, joinedEscalations, joinedLegal, escalations, summary, repeats, error, loaded]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStakeholder() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStakeholder must be used inside StakeholderProvider')
  return ctx
}
