import { useEffect, useState } from 'react'
import { fetchWeather } from './openMeteo'
import { assessWeather } from './weatherRisk'

const IDLE = { status: 'idle', obs: null, risk: null }

/**
 * Current weather risk near a coordinate.
 *
 * `active` exists because of the map: a hundred pins must not each open a
 * request on render. Callers pass `false` until the pin is actually hovered or
 * opened, and the module-level cache means a pin hovered a second time answers
 * without going out again.
 */
export function useSiteWeather(lat, lng, active = true) {
  const [state, setState] = useState(IDLE)

  useEffect(() => {
    if (!active || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
    let alive = true
    setState({ status: 'loading', obs: null, risk: null })
    fetchWeather(lat, lng).then((obs) => {
      if (!alive) return
      setState(obs ? { status: 'ready', obs, risk: assessWeather(obs) } : { status: 'error', obs: null, risk: null })
    })
    return () => { alive = false }
  }, [lat, lng, active])

  return state
}
