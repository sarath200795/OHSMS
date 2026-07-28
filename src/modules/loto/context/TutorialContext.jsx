import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// Lets the guided tour (Tutorial) tell the Assistant to hide its roaming Sam
// while the tour drives its own Sam across the screen — so only one Sam shows.
// Also exposes start() so anything (e.g. a "Take a tour" button) can replay it.
const TutorialContext = createContext({
  active: false,
  setActive: () => {},
  start: () => {},
  startSignal: 0,
})

export function TutorialProvider({ children }) {
  const [active, setActive] = useState(false)
  const [startSignal, setStartSignal] = useState(0)
  const start = useCallback(() => setStartSignal((s) => s + 1), [])
  const value = useMemo(
    () => ({ active, setActive, start, startSignal }),
    [active, startSignal, start],
  )
  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>
}

export function useTutorial() {
  return useContext(TutorialContext)
}

export default TutorialContext
