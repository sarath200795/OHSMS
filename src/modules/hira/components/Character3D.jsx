import { useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

// Flat-cartoon "Sam" — a friendly site safety manager: yellow hard hat, white
// shirt + red tie, dark trousers, holding rolled blueprints. Original art built
// from primitives and procedurally animated per state. Big-head chibi
// proportions to read clearly at small sizes; camera framed so the whole figure
// (head included) is always visible.
const SKIN = '#f3c9a3', SKIN_D = '#e0ad82'
const HAT = '#f4c20d', HAT_D = '#d4a200'            // yellow hard hat
const SHIRT = '#ffffff', SLEEVE_D = '#e8edf3'        // white shirt sleeves under the vest
const VEST = '#f97316', VEST_D = '#c2410c', STRIPE = '#e2e8f0' // orange hi-vis vest + reflective stripes
const TIE = '#e23b34', TIE_D = '#b8251f'
const TROUSER = '#2b3140', TROUSER_D = '#222734', SHOE = '#171b24'
const PAPER = '#eef2f7', PAPER_D = '#cdd6e2', MOUTH = '#7a241f', EYE = '#1f2937'

function Rig({ mode = 'idle', facing = 1 }) {
  const modeRef = useRef(mode)
  const facingRef = useRef(facing)
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { facingRef.current = facing }, [facing])

  const root = useRef()
  const torso = useRef()
  const head = useRef()
  const eyes = useRef()
  const sL = useRef(), eL = useRef(), sR = useRef(), eR = useRef()
  const hL = useRef(), hR = useRef()
  const roll = useRef(), clip = useRef(), pen = useRef(), baton = useRef(), glow = useRef()

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-9 * Math.min(delta, 0.05))
    const m = modeRef.current
    const set = (ref, axis, target) => { if (ref.current) ref.current.rotation[axis] += (target - ref.current.rotation[axis]) * k }

    // Defaults: left arm bent holding the blueprint roll, right arm relaxed.
    let sLx = 0.05, eLx = -1.25, sRx = 0.08, eRx = -0.14, sRz = 0
    let hLx = 0, hRx = 0, hdx = 0, lean = 0, bob = 0

    if (m === 'walk') {
      const s = Math.sin(t * 7)
      hLx = s * 0.5; hRx = -s * 0.5
      sRx = s * 0.5; eRx = -0.2          // right arm swings
      bob = Math.abs(Math.sin(t * 7)) * 0.05
    } else if (m === 'think') {
      sRx = -0.55; eRx = -2.05; hdx = -0.16
    } else if (m === 'write') {
      sLx = -0.9; eLx = -1.3; sRx = -0.85; eRx = -1.2 + Math.sin(t * 8) * 0.14; hdx = 0.32
    } else if (m === 'scratch') {
      sRx = -2.6; eRx = -1.5 + Math.sin(t * 11) * 0.22; hdx = -0.1
    } else if (m === 'wave') {
      sRx = -2.6; sRz = 0.22; eRx = -0.2 + Math.sin(t * 9) * 0.55
    } else if (m === 'sleep') {
      hdx = 0.5; lean = 0.22
    } else { // idle
      sRx = 0.08 + Math.sin(t * 1.4) * 0.05
    }

    set(hL, 'x', hLx); set(hR, 'x', hRx)
    set(sL, 'x', sLx); set(eL, 'x', eLx)
    set(sR, 'x', sRx); set(eR, 'x', eRx)
    if (sR.current) sR.current.rotation.z += (sRz - sR.current.rotation.z) * k
    set(head, 'x', hdx)
    if (root.current) root.current.position.y += (bob - root.current.position.y) * k
    if (torso.current) {
      torso.current.rotation.x += (lean - torso.current.rotation.x) * k
      torso.current.scale.y = 1 + Math.sin(t * (m === 'sleep' ? 1.2 : 2)) * 0.015
    }
    if (roll.current) roll.current.visible = m !== 'write'
    if (clip.current) clip.current.visible = m === 'write'
    if (pen.current) pen.current.visible = m === 'write'
    if (baton.current) baton.current.visible = m !== 'write'
    if (glow.current && glow.current.material) glow.current.material.emissiveIntensity = 0.55 + Math.sin(t * 6) * 0.4
    if (eyes.current) eyes.current.scale.y = m === 'sleep' ? 0.1 : (t % 4 < 0.13 ? 0.1 : 1)
    if (root.current) {
      // Turn the actual model toward the walking direction (no mirror flip);
      // face the viewer when not walking.
      const turn = m === 'walk' ? facingRef.current * 0.5 : 0
      root.current.rotation.y += (turn - root.current.rotation.y) * k
    }
  })

  return (
    // feet sit at y≈0; centred in view by the parent group offset
    <group ref={root}>
      {/* legs */}
      <group ref={hL} position={[-0.2, 0.92, 0]}>
        <mesh position={[0, -0.4, 0]}><boxGeometry args={[0.22, 0.8, 0.24]} /><meshStandardMaterial color={TROUSER} /></mesh>
        <mesh position={[0, -0.82, 0.07]}><boxGeometry args={[0.26, 0.16, 0.42]} /><meshStandardMaterial color={SHOE} /></mesh>
      </group>
      <group ref={hR} position={[0.2, 0.92, 0]}>
        <mesh position={[0, -0.4, 0]}><boxGeometry args={[0.22, 0.8, 0.24]} /><meshStandardMaterial color={TROUSER_D} /></mesh>
        <mesh position={[0, -0.82, 0.07]}><boxGeometry args={[0.26, 0.16, 0.42]} /><meshStandardMaterial color={SHOE} /></mesh>
      </group>

      {/* torso = green hi-vis safety vest over a white shirt (pivot near waist for lean) */}
      <group ref={torso} position={[0, 1.0, 0]}>
        {/* white shirt body */}
        <mesh position={[0, 0.32, 0]}><boxGeometry args={[0.84, 0.8, 0.48]} /><meshStandardMaterial color={SHIRT} /></mesh>
        {/* green hi-vis vest shell (slightly proud of the shirt) */}
        <mesh position={[0, 0.3, 0.01]}><boxGeometry args={[0.88, 0.74, 0.52]} /><meshStandardMaterial color={VEST} /></mesh>
        {/* shirt collar */}
        <mesh position={[0, 0.64, 0.255]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.12, 0.12, 0.02]} /><meshStandardMaterial color={SLEEVE_D} /></mesh>
        {/* centre zipper */}
        <mesh position={[0, 0.3, 0.27]}><boxGeometry args={[0.03, 0.72, 0.02]} /><meshStandardMaterial color="#0b1220" /></mesh>
        {/* reflective stripes: two vertical + one horizontal */}
        <mesh position={[-0.23, 0.3, 0.27]}><boxGeometry args={[0.1, 0.72, 0.02]} /><meshStandardMaterial color={STRIPE} /></mesh>
        <mesh position={[0.23, 0.3, 0.27]}><boxGeometry args={[0.1, 0.72, 0.02]} /><meshStandardMaterial color={STRIPE} /></mesh>
        <mesh position={[0, 0.16, 0.27]}><boxGeometry args={[0.62, 0.1, 0.02]} /><meshStandardMaterial color={STRIPE} /></mesh>
        {/* clipboard (write mode only) */}
        <group ref={clip} position={[0, 0.2, 0.46]} rotation={[-0.5, 0, 0]}>
          <mesh><boxGeometry args={[0.42, 0.52, 0.03]} /><meshStandardMaterial color={PAPER_D} /></mesh>
          <mesh position={[0, 0, 0.02]}><boxGeometry args={[0.34, 0.42, 0.01]} /><meshStandardMaterial color="#ffffff" /></mesh>
        </group>
      </group>

      {/* left arm (white sleeve) holding the blueprint roll */}
      <group ref={sL} position={[-0.52, 1.58, 0]}>
        <mesh position={[0, -0.22, 0]}><boxGeometry args={[0.17, 0.46, 0.17]} /><meshStandardMaterial color={SHIRT} /></mesh>
        <group ref={eL} position={[0, -0.44, 0]}>
          <mesh position={[0, -0.2, 0]}><boxGeometry args={[0.16, 0.42, 0.16]} /><meshStandardMaterial color={SLEEVE_D} /></mesh>
          <mesh position={[0, -0.42, 0]}><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color={SKIN} /></mesh>
          {/* rolled blueprints tucked in the hand */}
          <group ref={roll} position={[0.04, -0.46, 0.18]} rotation={[Math.PI / 2, 0, 0.25]}>
            <mesh><cylinderGeometry args={[0.085, 0.085, 0.5, 18]} /><meshStandardMaterial color={PAPER} /></mesh>
            <mesh position={[0, 0.251, 0]}><cylinderGeometry args={[0.088, 0.088, 0.01, 18]} /><meshStandardMaterial color={PAPER_D} /></mesh>
            <mesh position={[0, -0.251, 0]}><cylinderGeometry args={[0.088, 0.088, 0.01, 18]} /><meshStandardMaterial color={PAPER_D} /></mesh>
          </group>
        </group>
      </group>

      {/* right arm (white sleeve) — free hand / pen in write mode */}
      <group ref={sR} position={[0.52, 1.58, 0]}>
        <mesh position={[0, -0.22, 0]}><boxGeometry args={[0.17, 0.46, 0.17]} /><meshStandardMaterial color={SHIRT} /></mesh>
        <group ref={eR} position={[0, -0.44, 0]}>
          <mesh position={[0, -0.2, 0]}><boxGeometry args={[0.16, 0.42, 0.16]} /><meshStandardMaterial color={SLEEVE_D} /></mesh>
          <mesh position={[0, -0.42, 0]}><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color={SKIN} /></mesh>
          <mesh ref={pen} position={[0.03, -0.5, 0.06]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.025, 0.18, 0.025]} /><meshStandardMaterial color="#0b1220" /></mesh>
          {/* reflective red light baton (traffic wand) held in the hand */}
          <group ref={baton} position={[0.04, -0.46, 0.1]} rotation={[0.18, 0, 0]}>
            {/* handle */}
            <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.038, 0.038, 0.16, 14]} /><meshStandardMaterial color="#15181f" /></mesh>
            <mesh position={[0, 0.13, 0]}><torusGeometry args={[0.04, 0.012, 8, 16]} /><meshStandardMaterial color="#f4c20d" /></mesh>
            {/* glowing translucent red cone/tube */}
            <mesh ref={glow} position={[0, -0.34, 0]}><cylinderGeometry args={[0.055, 0.05, 0.6, 18]} /><meshStandardMaterial color="#ff2a2a" emissive="#ff1414" emissiveIntensity={0.8} transparent opacity={0.82} /></mesh>
            {/* bright tip */}
            <mesh position={[0, -0.66, 0]}><sphereGeometry args={[0.06, 14, 14]} /><meshStandardMaterial color="#ff6a6a" emissive="#ff2a2a" emissiveIntensity={1.1} /></mesh>
          </group>
        </group>
      </group>

      {/* head (pivot at neck) */}
      <group ref={head} position={[0, 1.62, 0]}>
        <mesh position={[0, 0.42, 0]}><sphereGeometry args={[0.5, 28, 28]} /><meshStandardMaterial color={SKIN} /></mesh>
        {/* ears */}
        <mesh position={[-0.49, 0.4, 0]}><sphereGeometry args={[0.1, 14, 14]} /><meshStandardMaterial color={SKIN} /></mesh>
        <mesh position={[0.49, 0.4, 0]}><sphereGeometry args={[0.1, 14, 14]} /><meshStandardMaterial color={SKIN} /></mesh>
        {/* eyes */}
        <group ref={eyes}>
          <mesh position={[-0.17, 0.46, 0.44]}><sphereGeometry args={[0.07, 14, 14]} /><meshStandardMaterial color={EYE} /></mesh>
          <mesh position={[0.17, 0.46, 0.44]}><sphereGeometry args={[0.07, 14, 14]} /><meshStandardMaterial color={EYE} /></mesh>
        </group>
        {/* smile */}
        <mesh position={[0, 0.28, 0.45]} rotation={[Math.PI / 2, Math.PI, 0]}>
          <torusGeometry args={[0.13, 0.028, 10, 20, Math.PI]} /><meshStandardMaterial color={MOUTH} />
        </mesh>
        {/* hard hat: dome + brim + ridge */}
        <mesh position={[0, 0.66, 0]}><sphereGeometry args={[0.55, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={HAT} /></mesh>
        <mesh position={[0, 0.64, 0.08]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.66, 0.66, 0.1, 28]} /><meshStandardMaterial color={HAT_D} /></mesh>
        <mesh position={[0, 0.78, 0]}><boxGeometry args={[0.1, 0.28, 1.0]} /><meshStandardMaterial color={HAT_D} /></mesh>
      </group>

      {/* soft ground shadow */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.6, 24]} /><meshBasicMaterial color="#000000" transparent opacity={0.12} /></mesh>
    </group>
  )
}

export default function Character3D({ mode = 'idle', size = 68, facing = 1 }) {
  const w = size
  const h = Math.round(size * 1.35)
  return (
    <div style={{ width: w, height: h, pointerEvents: 'none' }}>
      <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={{ position: [0, 0, 6.6], fov: 30 }} style={{ background: 'transparent' }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.05} />
        <directionalLight position={[-3, 2, -2]} intensity={0.3} />
        {/* centre the figure (feet at 0, top of hat ≈ 2.86) vertically in frame */}
        <group position={[0, -1.43, 0]}>
          <Rig mode={mode} facing={facing} />
        </group>
      </Canvas>
    </div>
  )
}
