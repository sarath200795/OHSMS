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
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import SamCharacter from './SamCharacter'

/** Cheap probe — a browser without WebGL should never pay for the import. */
function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
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
      const [THREE, { buildSam, disposeSam }] = await Promise.all([
        import('three'),
        import('./samRig'),
      ])
      if (!alive || !hostRef.current) return

      const host = hostRef.current
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(size, size, false)
      renderer.setClearAlpha(0)
      host.appendChild(renderer.domElement)
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
      setReady(true)

      const t0 = performance.now()
      let raf = 0
      const frame = () => {
        raf = requestAnimationFrame(frame)
        const { walking: w, facing: f, talking: tk } = state.current
        const t = (performance.now() - t0) / 1000

        // Turn to face travel; eased so a change of direction is a turn rather
        // than a snap.
        const targetY = f < 0 ? 0.42 : -0.42
        rig.sam.rotation.y += (targetY - rig.sam.rotation.y) * 0.08

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
        renderer.dispose()
        renderer.domElement.remove()
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
