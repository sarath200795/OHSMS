import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/auth/AuthContext'
import { subscribeSites } from '../../../shared/org/orgData'
import { subscribeCameras, subscribeDvrs, subscribeMerakis } from '../lib/firestore'
import { estateHealth } from '../lib/health'

const Ctx = createContext(null)

/**
 * One subscription set for the whole module, and one health pass over it.
 *
 * The three collections are useless apart — a camera's status is meaningless
 * without knowing whether its DVR is up — so every page needs all three and
 * subscribing per page would mean three listeners each and a health calculation
 * that disagrees between tabs.
 */
export function CctvProvider({ children }) {
  const { orgId, orgName } = useAuth()
  const [cameras, setCameras] = useState([])
  const [dvrs, setDvrs] = useState([])
  const [merakis, setMerakis] = useState([])
  const [sites, setSites] = useState([])
  const [loaded, setLoaded] = useState({ cameras: false, dvrs: false, merakis: false })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!orgId) return undefined
    setLoaded({ cameras: false, dvrs: false, merakis: false })
    setError(null)

    // A listener that fails hands back null. Showing an empty estate then would
    // read as "no cameras installed" rather than "we could not load them", so
    // the error is kept and the pages say so.
    const bind = (subscribe, set, key) =>
      subscribe(orgId, (rows, err) => {
        if (err) return setError(err)
        set(rows || [])
        setLoaded((l) => ({ ...l, [key]: true }))
      })

    const unsubs = [
      bind(subscribeCameras, setCameras, 'cameras'),
      bind(subscribeDvrs, setDvrs, 'dvrs'),
      bind(subscribeMerakis, setMerakis, 'merakis'),
      subscribeSites(orgId, (rows) => setSites(rows || [])),
    ]
    return () => unsubs.forEach((u) => u?.())
  }, [orgId])

  // Recomputed only when the inputs change — the cascade walks every device
  // three times and pages re-render on every keystroke in a filter box.
  const estate = useMemo(() => estateHealth({ cameras, dvrs, merakis }), [cameras, dvrs, merakis])

  const value = useMemo(
    () => ({
      orgId,
      orgName,
      cameras,
      dvrs,
      merakis,
      sites,
      estate,
      error,
      loading: !(loaded.cameras && loaded.dvrs && loaded.merakis),
      // Named lookups the forms need, built once rather than in every render.
      dvrOptions: dvrs.map((d) => ({ value: d.id, label: d.name, siteId: d.siteId, siteName: d.siteName })),
      siteOptions: sites.map((s) => ({ value: s.id, label: s.name || s.siteName || s.id })),
    }),
    [orgId, orgName, cameras, dvrs, merakis, sites, estate, error, loaded]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCctv() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCctv must be used inside CctvProvider')
  return ctx
}
