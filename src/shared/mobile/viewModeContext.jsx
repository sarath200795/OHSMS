import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  VIEW_MODE_KEY,
  destinationForMode,
  readSignals,
  readViewChoice,
  resolveViewMode,
  writeViewChoice,
} from './viewMode'

const ViewModeContext = createContext(null)

const SIGNAL_QUERIES = ['(pointer: coarse)', '(min-width: 1024px)', '(max-width: 767px)']

export function ViewModeProvider({ children }) {
  const [choice, setChoiceState] = useState(() => readViewChoice())
  const [signals, setSignals] = useState(() => readSignals())

  useEffect(() => {
    const refreshSignals = () => setSignals(readSignals())
    const refreshChoice = () => setChoiceState(readViewChoice())
    refreshSignals()
    window.addEventListener('resize', refreshSignals)
    const onStorage = (event) => {
      if (event.key === VIEW_MODE_KEY || event.key === null) refreshChoice()
    }
    window.addEventListener('storage', onStorage)
    const watched = []
    if (typeof window.matchMedia === 'function') {
      for (const query of SIGNAL_QUERIES) {
        try {
          const mq = window.matchMedia(query)
          if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', refreshSignals)
            watched.push(mq)
          }
        } catch {
          // A broken matchMedia must not take the shell down. Width still
          // updates on resize, and a missing pointer query stays "fine".
        }
      }
    }
    return () => {
      window.removeEventListener('resize', refreshSignals)
      window.removeEventListener('storage', onStorage)
      for (const mq of watched) mq.removeEventListener('change', refreshSignals)
    }
  }, [])

  const setChoice = useCallback((next) => {
    const stored = next === 'mobile' || next === 'desktop' ? next : 'auto'
    writeViewChoice(stored)
    setChoiceState(stored)
  }, [])

  const mode = resolveViewMode(choice, signals)
  const value = useMemo(() => ({ mode, choice, setChoice }), [mode, choice, setChoice])

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
}

export function useViewMode() {
  const value = useContext(ViewModeContext)
  if (!value) throw new Error('useViewMode must be used inside ViewModeProvider')
  return value
}

/**
 * The home-screen control. The label names the mode you would be leaving
 * for. "Use automatic" is only there once a choice is stored — offering it
 * on the first visit describes a reset of a decision that has not been made.
 */
export function ViewModeSwitch() {
  const { mode, choice, setChoice } = useViewMode()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const apply = (next) => {
    const stored = next === 'mobile' || next === 'desktop' ? next : 'auto'
    const resolved = resolveViewMode(stored, readSignals())
    setChoice(stored)
    const to = destinationForMode(resolved, pathname)
    if (to) navigate(to, { replace: true })
  }

  const other = mode === 'mobile' ? 'desktop' : 'mobile'
  const label = other === 'desktop' ? 'Switch to desktop view' : 'Switch to mobile view'

  return (
    <div
      className="mb-4 flex flex-wrap gap-2"
      role="group"
      aria-label="Choose phone or desktop view"
    >
      <button type="button" className="btn-ghost" onClick={() => apply(other)}>
        {label}
      </button>
      {choice !== 'auto' && (
        <button type="button" className="btn-ghost" onClick={() => apply('auto')}>
          Use automatic
        </button>
      )}
    </div>
  )
}
