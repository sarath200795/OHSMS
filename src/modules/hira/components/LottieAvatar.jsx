import { useEffect, useRef, useState } from 'react'

// Optional designer-made character. Put Lottie JSON in /public/lottie/ + a
// manifest.json. Two ways to drive states:
//   A) per-state files:  { "walk":"walk.json", "write":"write.json", ... , "default":"character.json" }
//   B) one marked file:  { "default":"character.json", "markers": true }
//      where character.json contains markers named walk / idle / think / write /
//      scratch / wave / search / sleep — each state plays that marker's segment.
// Falls back to the built-in SVG `fallback` (Sam) when nothing is present.
let LottieLib // cached default export
const cache = {} // url -> animationData | null
let manifest // {state:file, markers?} | null | undefined(=unchecked)

export default function LottieAvatar({ mode = 'idle', size = 116, fallback = null }) {
  const ref = useRef(null) // lottie instance ref (for marker segments)
  const segRef = useRef(null)
  const [, force] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (manifest === undefined) {
        try { const r = await fetch('/lottie/manifest.json', { cache: 'no-store' }); manifest = r.ok ? await r.json() : null } catch { manifest = null }
      }
      if (!manifest) return
      if (LottieLib === undefined) {
        try { LottieLib = (await import('lottie-react')).default } catch { LottieLib = null }
      }
      const files = Array.from(new Set(Object.values(manifest).filter((v) => typeof v === 'string')))
      await Promise.all(files.map(async (f) => {
        const url = `/lottie/${f}`
        if (url in cache) return
        try { const r = await fetch(url, { cache: 'force-cache' }); cache[url] = r.ok ? await r.json() : null } catch { cache[url] = null }
      }))
      if (alive) force((n) => n + 1)
    })()
    return () => { alive = false }
  }, [])

  const defaultData = manifest?.default ? cache[`/lottie/${manifest.default}`] : null
  const useMarkers = !!manifest?.markers && Array.isArray(defaultData?.markers) && defaultData.markers.length > 0

  // Marker mode: play the segment whose marker comment matches the state.
  useEffect(() => {
    if (!useMarkers || !ref.current || !defaultData) return
    const markers = defaultData.markers
    const m = markers.find((k) => (k.cm || '').toLowerCase() === mode.toLowerCase())
      || markers.find((k) => (k.cm || '').toLowerCase() === 'idle')
    if (!m) return
    const start = m.tm
    const end = m.tm + (m.dr || 1)
    segRef.current = [start, end]
    try { ref.current.playSegments([start, end], true) } catch { /* not ready yet */ }
  }, [mode, useMarkers, defaultData])

  if (manifest && LottieLib) {
    if (useMarkers) {
      const L = LottieLib
      return (
        <L
          lottieRef={ref}
          animationData={defaultData}
          autoplay
          loop={false}
          onComplete={() => { if (segRef.current && ref.current) try { ref.current.playSegments(segRef.current, true) } catch { /* */ } }}
          style={{ width: size, height: size }}
          aria-hidden
        />
      )
    }
    const file = manifest[mode] || manifest.default
    const data = typeof file === 'string' ? cache[`/lottie/${file}`] : null
    if (data) {
      const L = LottieLib
      return <L animationData={data} loop autoplay style={{ width: size, height: size }} aria-hidden />
    }
  }
  return fallback
}
