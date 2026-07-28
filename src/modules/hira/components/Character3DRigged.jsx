import { Suspense, Component, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import Character3D from './Character3D'

// ─────────────────────────────────────────────────────────────────────────────
// Realistic, skeleton-rigged 3D guide. Drop a licensed .glb (e.g. a Mixamo human)
// + a manifest into /public/character/ and it loads automatically; otherwise the
// app falls back to the built-in procedural figure (Character3D) → 2D Sam.
//
//   /public/character/manifest.json
//   { "model": "character.glb",
//     "clips": { "walk":"Walking", "idle":"Idle", "think":"Thinking",
//                "write":"Writing", "scratch":"ScratchHead", "wave":"Waving",
//                "sleep":"Sleeping" },
//     "scale": 1, "yOffset": -1 }
//
// `clips` is optional — if omitted, the model's own animation-clip names are used
// (matched case-insensitively to the mode). Any unmapped mode falls back to idle.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/character/'

// Loads the model + drives the right skeletal clip for the current mode.
function RiggedModel({ mode, manifest, facing = 1 }) {
  const group = useRef()
  const { scene, animations } = useGLTF(BASE + manifest.model)
  const { actions, names } = useAnimations(animations, group)
  const current = useRef(null)

  // Resolve a mode → clip name using the manifest map, then the model's own
  // clip names (case-insensitive), then the literal mode, falling back to idle.
  const resolve = (m) => {
    const map = manifest.clips || {}
    const pick = (want) => {
      if (!want) return null
      if (actions[want]) return want
      const hit = names.find((n) => n.toLowerCase() === String(want).toLowerCase())
      return hit || null
    }
    return pick(map[m]) || pick(m) || pick(map.idle) || pick('idle') || names[0] || null
  }

  useEffect(() => {
    const next = resolve(mode)
    if (!next || !actions[next]) return
    if (current.current === next) return
    const prev = current.current && actions[current.current]
    const action = actions[next]
    action.reset().fadeIn(0.25).play()
    if (prev && prev !== action) prev.fadeOut(0.25)
    current.current = next
    return () => { /* keep playing; next effect cross-fades */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, actions, names])

  // Turn the model toward the walking direction (no mirror flip); face forward otherwise.
  useFrame(() => {
    if (!group.current) return
    const target = mode === 'walk' ? facing * 0.5 : 0
    group.current.rotation.y += (target - group.current.rotation.y) * 0.08
  })

  const scale = manifest.scale ?? 1
  const y = manifest.yOffset ?? -1
  return <primitive ref={group} object={scene} scale={scale} position={[0, y, 0]} />
}

// If anything in the rigged path throws (missing/invalid glb, WebGL, decoder),
// fall back to the procedural 3D figure.
class RiggedBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* fallback handles it */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function RiggedCanvas({ mode, size, manifest, facing = 1 }) {
  const w = size
  const h = Math.round(size * 1.35)
  return (
    <div style={{ width: w, height: h, pointerEvents: 'none' }}>
      <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={{ position: [0, 0.9, 3.2], fov: 32 }} style={{ background: 'transparent' }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-3, 2, -2]} intensity={0.35} />
        <Suspense fallback={null}>
          <RiggedModel mode={mode} manifest={manifest} facing={facing} />
        </Suspense>
        {/* soft ground shadow */}
        <mesh position={[0, (manifest.yOffset ?? -1) + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.5, 24]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.12} />
        </mesh>
      </Canvas>
    </div>
  )
}

// Default export: checks for a manifest once. With a rigged model present it
// renders the realistic character (procedural figure as the load/error
// fallback); otherwise it renders the procedural figure directly.
let MANIFEST // undefined = unchecked, null = none, object = found
export default function Character3DAuto({ mode = 'idle', size = 68, facing = 1 }) {
  const [manifest, setManifest] = useState(MANIFEST)

  useEffect(() => {
    if (MANIFEST !== undefined) { setManifest(MANIFEST); return }
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(BASE + 'manifest.json', { cache: 'no-store' })
        MANIFEST = r.ok ? await r.json() : null
      } catch { MANIFEST = null }
      if (!MANIFEST || !MANIFEST.model) MANIFEST = MANIFEST?.model ? MANIFEST : null
      if (alive) setManifest(MANIFEST)
    })()
    return () => { alive = false }
  }, [])

  if (manifest && manifest.model) {
    return (
      <RiggedBoundary fallback={<Character3D mode={mode} size={size} facing={facing} />}>
        <Suspense fallback={<Character3D mode={mode} size={size} facing={facing} />}>
          <RiggedCanvas mode={mode} size={size} manifest={manifest} facing={facing} />
        </Suspense>
      </RiggedBoundary>
    )
  }
  return <Character3D mode={mode} size={size} facing={facing} />
}
