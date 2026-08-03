import { useEffect, useState } from 'react'
import { fetchWeather } from './openMeteo'
import { assessWeather } from './weatherRisk'

/** Requests in flight at once. Enough to fill a page quickly, few enough to be polite. */
const CONCURRENCY = 6

/**
 * Weather risk for a whole list of sites.
 *
 * Results stream in rather than arriving together: an org with sixty sites
 * would otherwise stare at a spinner for the slowest request, and the worst
 * site is usually among the first few back. The queue is bounded because a
 * free, unauthenticated API is a courtesy, not an entitlement — and because
 * sixty parallel requests is how you get rate-limited into showing nothing.
 *
 * The provider's cache buckets by ~1 km, so sites in one city cost one request
 * between them however many pins there are.
 *
 * @returns { byId: Record<siteId, {risk, obs}>, done, total }
 */
export function useAllSiteWeather(sites = []) {
  const [byId, setById] = useState({})
  const [done, setDone] = useState(0)

  // Sites arrive from a live subscription and are a new array every tick, so
  // the effect keys on identity and coordinates rather than the array itself.
  const key = sites.map((s) => `${s.id}:${s.lat},${s.lng}`).join('|')

  useEffect(() => {
    const located = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    setById({})
    setDone(0)
    if (located.length === 0) return undefined

    let alive = true
    let next = 0

    const worker = async () => {
      while (alive) {
        const i = next++
        if (i >= located.length) return
        const site = located[i]
        const obs = await fetchWeather(site.lat, site.lng)
        if (!alive) return
        if (obs) {
          setById((prev) => ({ ...prev, [site.id]: { obs, risk: assessWeather(obs) } }))
        }
        setDone((n) => n + 1)
      }
    }

    for (let i = 0; i < Math.min(CONCURRENCY, located.length); i += 1) worker()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { byId, done, total: sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).length }
}
