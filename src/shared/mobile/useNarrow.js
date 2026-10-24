import { useEffect, useState } from 'react'

// Tailwind's `md` starts at 768px. The field nav is the layout below that.
const QUERY = '(max-width: 767px)'

function matches() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

/** True when the viewport is a phone. False when it cannot be known, which is the desktop. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    let mq
    try {
      mq = window.matchMedia(QUERY)
    } catch {
      return undefined
    }
    const onChange = () => setNarrow(mq.matches)
    onChange()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else if (typeof mq.addListener === 'function') mq.addListener(onChange)
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
      else if (typeof mq.removeListener === 'function') mq.removeListener(onChange)
    }
  }, [])

  return narrow
}
