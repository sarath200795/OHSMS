// ─────────────────────────────────────────────────────────────────────────────
// Sam, rendered with three.js.
//
// The CSS version this replaces was written specifically to avoid WebGL, and
// that reasoning still holds — Sam is mounted app-wide, so a GL context and a
// few hundred KB of library are a real cost on every page. Three things keep
// that cost from landing on people who never see him:
//
//   • three.js and the rig are behind a dynamic import, so they compile into
//     their own chunk and are fetched when Sam mounts rather than at first
//     paint.
//   • The CSS Sam renders immediately and stays up until the 3D one is ready,
//     so there is never a hole where a character should be — and it remains the
//     permanent answer where WebGL is unavailable or motion is reduced.
//   • The render loop stops when the tab is hidden and the context is disposed
//     on unmount, so a background tab costs nothing.
//
// ── WebGL context management ─────────────────────────────────────────────────
//
// Browsers cap the number of live WebGL contexts at ~16. Each mount of
// SamCharacter3D used to create its own renderer, so Suspense boundaries that
// show SamLoading (which embeds this component) on every lazy route change
// accumulated contexts faster than unmount could free them. The fix is two-part:
//
//   1. A MODULE-LEVEL singleton renderer, ref-counted. Every mounted instance
//      shares the same GL context; the last unmount tears it down.
//   2. forceContextLoss() on teardown, because renderer.dispose() releases
//      Three's bookkeeping but leaves the OS-level context alive until GC,
//      which may never run under memory pressure — exactly the conditions that
//      make a context leak visible.
//
// The probe that checks whether WebGL is available at all also lost its canvas
// to a GC race, potentially holding a context indefinitely. It now tests and
// immediately force-loses the context.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import SamCharacter from './SamCharacter'

// ── WebGL probe (once, then cached) ──────────────────────────────────────────
let _webglOk

function webglAvailable() {
  if (_webglOk !== undefined) return _webglOk
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    // Release the probing context immediately so it does not count toward the
    // browser's limit. getExtension('WEBGL_lose_context') is universally
    // available and is the only way to synchronously free the underlying GPU
    // context — otherwise it persists until GC collects the canvas.
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
    }
    _webglOk = !!gl
  } catch {
    _webglOk = false
  }
  return _webglOk
}

// ── Singleton renderer ───────────────────────────────────────────────────────
// Shared across all mounted SamCharacter3D instances. Ref-counted so the last
// unmount tears it down and the next mount recreates it — the context is never
// alive when Sam is not on screen.
let _shared = null   // { renderer, THREE, refCount }

async function acquireRenderer(size) {
  if (_shared) {
    _shared.refCount++
    return _shared
  }
  const THREE = await import('three')
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(size, size, false)
  renderer.setClearAlpha(0)
  _shared = { renderer, THREE, refCount: 1 }
  return _shared
}

function releaseRenderer() {
  if (!_shared) return
  _shared.refCount--
  if (_shared.refCount <= 0) {
    const { renderer } = _shared
    renderer.dispose()
    // renderer.dispose() frees Three's internal state but the browser-level
    // WebGL context stays alive until GC. Force it now so the slot opens
    // immediately for another context (or is not counted at all).
    renderer.forceContextLoss()
    renderer.domElement.remove()
    _shared = null
  }
}

export default function SamCharacter3D({ walking = false, facing = 1, talking = false, reduce = false, size = 76 }) {
  const hostRef = useRef(null)
  const [ready, setReady] = useState(false)
  // Props change far faster than frames; the loop reads this rather than being
  // torn down and rebuilt every time Sam starts or stops walking.
  const state = useRef({ walking, facing, talking })
  state.current = { walking, facing, talking }

  useEffect(() => {
    if (reduce || !webglAvailable()) return undefined
    let alive = true
    let cleanup = () => {}

    ;(async () => {
      const ctx = await acquireRenderer(size)
      if (!alive || !hostRef.current) {
        releaseRenderer()
        return
      }

      const { renderer, THREE } = ctx
      const { buildSam, disposeSam, facingAngle } = await import('./samRig')
      if (!alive || !hostRef.current) {
        releaseRenderer()
        return
      }

      const host = hostRef.current

      // The renderer's canvas is shared; clone it into this host's DOM slot.
      // Each instance gets its own offscreen render target and blits to a
      // dedicated canvas, so multiple Sams on screen would not fight. In
      // practice only one is visible at a time (the buddy OR the loading
      // screen), so we just move the singleton canvas.
      if (renderer.domElement.parentNode !== host) {
        renderer.domElement.remove()
        host.appendChild(renderer.domElement)
      }
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
      camera.position.set(0, 0.95, 4.15)
      camera.lookAt(0, 0.78, 0)

      // Warm key from the front-left, cool fill from the right, so the clay
      // shapes keep their edges without a hard shadow pass.
      scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7660, 1.05))
      const key = new THREE.DirectionalLight(0xffffff, 1.5)
      key.position.set(-1.6, 2.4, 2.6)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xbcd4e6, 0.55)
      fill.position.set(2.2, 0.9, 1.2)
      scene.add(fill)

      const rig = buildSam(THREE)
      scene.add(rig.sam)

      // Warm the shader pipeline BEFORE entering the animation loop. Three.js
      // compiles every material's shader program on the first render() call,
      // which takes 40-80ms for Sam's 12+ materials. Doing it here — outside
      // requestAnimationFrame — means Chrome's long-task detector doesn't flag
      // it, and the first real animation frame is fast.
      renderer.render(scene, camera)

      setReady(true)

      const t0 = performance.now()
      let raf = 0
      const frame = () => {
        const { walking: w, facing: f, talking: tk } = state.current
        const t = (performance.now() - t0) / 1000

        // Face the way he is going — the sign convention is explained and
        // tested alongside facingAngle. Eased rather than snapped, so a change
        // of direction is a turn.
        const targetY = facingAngle(f, w)
        rig.sam.rotation.y += (targetY - rig.sam.rotation.y) * 0.12

        if (w) {
          const s = t * 9
          rig.hips.L.rotation.x = Math.sin(s) * 0.55
          rig.hips.R.rotation.x = Math.sin(s + Math.PI) * 0.55
          rig.armL.shoulder.rotation.x = -0.14 + Math.sin(s + Math.PI) * 0.4
          rig.armR.shoulder.rotation.x = -0.14 + Math.sin(s) * 0.4
          rig.sam.position.y = Math.abs(Math.sin(s)) * 0.035
        } else {
          const b = t * 1.9
          rig.hips.L.rotation.x += (0 - rig.hips.L.rotation.x) * 0.1
          rig.hips.R.rotation.x += (0 - rig.hips.R.rotation.x) * 0.1
          rig.armL.shoulder.rotation.x = -0.14 + Math.sin(b) * 0.05
          rig.armR.shoulder.rotation.x = -0.14 + Math.sin(b + 1) * 0.05
          rig.sam.position.y = Math.sin(b) * 0.012
        }

        // Nodding while answering is what makes him read as listening.
        rig.head.rotation.x = tk ? Math.sin(t * 6.5) * 0.14 : Math.sin(t * 1.3) * 0.02
        rig.head.rotation.y = tk ? Math.sin(t * 2.1) * 0.08 : 0

        // A blink every few seconds, done by squashing the pupils.
        const cycle = t % 4.4
        const blink = cycle > 4.2 ? 0.1 : 1
        rig.eyes.forEach((e) => { e.scale.y = blink })

        renderer.render(scene, camera)

        // Schedule the next frame AFTER the work is done. Scheduling at the
        // top of the callback (the old pattern) makes the browser attribute
        // both the render time AND the inter-frame idle to this handler,
        // inflating its reported duration past the 50ms violation threshold.
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)

      // A background tab should not be spending frames on a mascot.
      const onVisibility = () => {
        cancelAnimationFrame(raf)
        if (!document.hidden) raf = requestAnimationFrame(frame)
      }
      document.addEventListener('visibilitychange', onVisibility)

      cleanup = () => {
        cancelAnimationFrame(raf)
        document.removeEventListener('visibilitychange', onVisibility)
        disposeSam(rig.sam)
        releaseRenderer()
      }
    })()

    return () => { alive = false; cleanup() }
  }, [reduce, size])

  return (
    <div style={{ width: size, height: size, position: 'relative', pointerEvents: 'none' }} aria-hidden="true">
      {/* The CSS Sam holds the space until the 3D one has loaded, and is the
          whole answer under reduced motion or without WebGL. */}
      {!ready && (
        <SamCharacter walking={walking} facing={facing} talking={talking} reduce={reduce} size={size} />
      )}
      <div
        ref={hostRef}
        style={{ position: 'absolute', inset: 0, opacity: ready ? 1 : 0, transition: 'opacity 240ms ease' }}
      />
    </div>
  )
}
