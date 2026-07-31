// ─────────────────────────────────────────────────────────────────────────────
// Sam's geometry, ported from the Sam 3D design.
//
// Kept apart from the React component for two reasons: it is the part that has
// to match the design exactly, and it must never be imported at module load —
// it pulls three.js in with it. The component reaches this through a dynamic
// import so the ~150 KB lands in its own chunk, fetched once Sam is on screen
// rather than on first paint.
//
// Proportions are chibi: the head is nearly as wide as the chest. That is the
// design's choice and the reason Sam reads as a character rather than a scale
// model of a person.
// ─────────────────────────────────────────────────────────────────────────────

// How far Sam turns toward travel, in radians. ~76° reads as "heading that
// way" while keeping his face partly toward the viewer; a right angle would be
// a flat silhouette. Standing still he is nearly front-on, because that is when
// he is being talked to.
export const WALK_TURN = Math.PI * 0.42
export const IDLE_TURN = 0.16

/**
 * The Y rotation that points Sam the way he is going.
 *
 * The rig is modelled facing +Z. Rotating by θ about Y sends that forward
 * vector to (sin θ, 0, cos θ), so a positive angle turns him toward +X — screen
 * right — which is what `facing === 1` means. Worth stating because the sign is
 * easy to invert, and inverted it points him away from travel while still
 * looking deliberate.
 */
export function facingAngle(facing, walking) {
  const dir = facing < 0 ? -1 : 1
  return dir * (walking ? WALK_TURN : IDLE_TURN)
}

/** Build the rig. `THREE` is passed in so this file imports nothing itself. */
export function buildSam(THREE) {
  const M = {
    skin: new THREE.MeshStandardMaterial({ color: '#eec9a0', roughness: 0.78, metalness: 0 }),
    skinShade: new THREE.MeshStandardMaterial({ color: '#d9ac7f', roughness: 0.8, metalness: 0 }),
    hair: new THREE.MeshStandardMaterial({ color: '#e8a33d', roughness: 0.62, metalness: 0.05 }),
    navy: new THREE.MeshStandardMaterial({ color: '#456175', roughness: 0.85, metalness: 0 }),
    navyDark: new THREE.MeshStandardMaterial({ color: '#31465a', roughness: 0.7, metalness: 0 }),
    vest: new THREE.MeshStandardMaterial({ color: '#c74a33', roughness: 0.55, metalness: 0 }),
    vestDark: new THREE.MeshStandardMaterial({ color: '#a63b28', roughness: 0.55, metalness: 0 }),
    reflect: new THREE.MeshStandardMaterial({ color: '#f8f1e4', roughness: 0.25, metalness: 0.3 }),
    paper: new THREE.MeshStandardMaterial({ color: '#f8f1e4', roughness: 0.9, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8ba7bd', roughness: 0.4, metalness: 0.35 }),
    ink: new THREE.MeshStandardMaterial({ color: '#2c241d', roughness: 0.5, metalness: 0 }),
    teal: new THREE.MeshStandardMaterial({ color: '#7fc4bb', roughness: 0.45, metalness: 0.1 }),
  }

  /** A rounded box: extruded rounded rect with a bevel, for soft clay edges. */
  function roundedBox(w, h, d, r = 0.02, b = 0.012) {
    const iw = Math.max(0.001, w - 2 * b)
    const ih = Math.max(0.001, h - 2 * b)
    const rr = Math.min(r, iw / 2 - 0.001, ih / 2 - 0.001)
    const s = new THREE.Shape()
    const x = -iw / 2
    const y = -ih / 2
    s.moveTo(x + rr, y)
    s.lineTo(x + iw - rr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + rr)
    s.lineTo(x + iw, y + ih - rr); s.quadraticCurveTo(x + iw, y + ih, x + iw - rr, y + ih)
    s.lineTo(x + rr, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - rr)
    s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y)
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.001, d - 2 * b), bevelEnabled: true,
      bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8,
    })
    g.translate(0, 0, -(d - 2 * b) / 2)
    return g
  }

  const part = (name, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat)
    m.name = name
    m.position.set(...pos)
    m.rotation.set(...rot)
    return m
  }

  const sam = new THREE.Group()
  sam.name = 'Sam'
  const add = (...meshes) => meshes.forEach((m) => sam.add(m))

  // ── Legs, hung off hip groups so they can swing ──
  const hips = {}
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    const hip = new THREE.Group()
    hip.position.set(sx * 0.115, 0.52, 0)
    hip.add(part(`leg_${side}`, roundedBox(0.13, 0.40, 0.15, 0.05), M.navy, [0, -0.22, 0]))
    hip.add(part(`boot_${side}`, roundedBox(0.165, 0.12, 0.26, 0.05), M.navyDark, [0, -0.455, 0.038]))
    hip.add(part(`sole_${side}`, roundedBox(0.177, 0.03, 0.272, 0.013), M.ink, [0, -0.504, 0.038]))
    hip.add(part(`cuff_${side}`, roundedBox(0.147, 0.05, 0.168, 0.02), M.navyDark, [0, -0.385, 0]))
    sam.add(hip)
    hips[side] = hip
  }

  // ── Torso ──
  add(part('chest', roundedBox(0.36, 0.30, 0.25, 0.085), M.navy, [0, 0.80, 0]))
  add(part('waist', roundedBox(0.30, 0.22, 0.22, 0.07), M.navy, [0, 0.60, 0]))
  add(part('belt', roundedBox(0.315, 0.055, 0.235, 0.02), M.navyDark, [0, 0.525, 0]))
  add(part('buckle', roundedBox(0.055, 0.042, 0.02, 0.008), M.steel, [0, 0.525, 0.12]))

  // ── Open hi-vis vest, in brand terracotta with reflective tape ──
  add(part('vest_panel_L', roundedBox(0.115, 0.36, 0.04, 0.028), M.vest, [-0.092, 0.755, 0.115]))
  add(part('vest_panel_R', roundedBox(0.115, 0.36, 0.04, 0.028), M.vest, [0.092, 0.755, 0.115]))
  add(part('vest_back', roundedBox(0.32, 0.36, 0.04, 0.035), M.vest, [0, 0.755, -0.115]))
  add(part('vest_strap_L', roundedBox(0.095, 0.048, 0.26, 0.022), M.vest, [-0.108, 0.945, 0]))
  add(part('vest_strap_R', roundedBox(0.095, 0.048, 0.26, 0.022), M.vest, [0.108, 0.945, 0]))
  add(part('tape_front_L', roundedBox(0.038, 0.32, 0.012, 0.006), M.reflect, [-0.092, 0.755, 0.137]))
  add(part('tape_front_R', roundedBox(0.038, 0.32, 0.012, 0.006), M.reflect, [0.092, 0.755, 0.137]))
  add(part('tape_back_hi', roundedBox(0.30, 0.045, 0.012, 0.006), M.reflect, [0, 0.845, -0.137]))
  add(part('tape_back_lo', roundedBox(0.30, 0.045, 0.012, 0.006), M.reflect, [0, 0.675, -0.137]))
  add(part('badge', roundedBox(0.07, 0.048, 0.012, 0.008), M.paper, [-0.108, 0.878, 0.142]))
  add(part('badge_line', roundedBox(0.042, 0.008, 0.006, 0.003), M.teal, [-0.108, 0.871, 0.149]))
  add(part('badge_clip', roundedBox(0.018, 0.013, 0.008, 0.004), M.steel, [-0.108, 0.906, 0.142]))

  // ── Arms: shoulder → elbow → hand ──
  const buildArm = (side, sx) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(sx * 0.225, 0.895, 0)
    shoulder.rotation.set(-0.14, 0, sx * 0.46)
    shoulder.add(part(`shoulder_${side}`, new THREE.SphereGeometry(0.068, 20, 14), M.vest, [0, 0.005, 0]))
    shoulder.add(part(`sleeve_${side}`, new THREE.CapsuleGeometry(0.056, 0.15, 6, 18), M.navy, [0, -0.115, 0]))
    shoulder.add(part(`cuff_sleeve_${side}`, new THREE.CylinderGeometry(0.058, 0.055, 0.035, 18), M.navyDark, [0, -0.198, 0]))
    const elbow = new THREE.Group()
    elbow.position.set(0, -0.205, 0)
    elbow.rotation.set(-0.78, 0, sx * -0.18)
    elbow.add(part(`forearm_${side}`, new THREE.CapsuleGeometry(0.05, 0.13, 6, 18), M.skinShade, [0, -0.09, 0]))
    elbow.add(part(`hand_${side}`, roundedBox(0.088, 0.10, 0.082, 0.032), M.skin, [0, -0.195, 0.008]))
    elbow.add(part(`thumb_${side}`, new THREE.CapsuleGeometry(0.019, 0.035, 4, 12), M.skin,
      [sx * -0.045, -0.175, 0.03], [0, 0, sx * 0.6]))
    shoulder.add(elbow)
    return { shoulder, elbow }
  }
  const armL = buildArm('L', -1)
  const armR = buildArm('R', 1)
  sam.add(armL.shoulder, armR.shoulder)

  // A clipboard, so Sam is carrying the thing he is named for.
  const clip = new THREE.Group()
  clip.add(part('clipboard_board', roundedBox(0.21, 0.28, 0.016, 0.012), M.navyDark))
  clip.add(part('clipboard_sheet', roundedBox(0.18, 0.24, 0.008, 0.006), M.paper, [0, -0.014, 0.012]))
  clip.add(part('clipboard_clip', roundedBox(0.08, 0.03, 0.028, 0.008), M.steel, [0, 0.122, 0.014]))
  ;[0.062, 0.026, -0.01, -0.046].forEach((y, i) =>
    clip.add(part(`clipboard_rule_${i}`, roundedBox(0.12, 0.011, 0.005, 0.004), M.steel, [-0.012, y, 0.018])))
  clip.position.set(0.03, -0.235, 0.10)
  clip.rotation.set(0.30, 0.18, 0.46)
  armL.elbow.add(clip)

  // ── Head. Grouped so it can nod as one thing while Sam talks. ──
  const head = new THREE.Group()
  head.position.set(0, 1.045, 0)
  const H = (name, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) =>
    head.add(part(name, geo, mat, [pos[0], pos[1] - 1.045, pos[2]], rot))

  sam.add(part('neck', new THREE.CylinderGeometry(0.055, 0.065, 0.075, 18), M.skinShade, [0, 0.975, 0]))
  sam.add(part('collar', new THREE.CylinderGeometry(0.085, 0.095, 0.04, 18), M.navyDark, [0, 0.955, 0]))

  H('head', roundedBox(0.325, 0.315, 0.29, 0.095), M.skin, [0, 1.175, 0])
  H('jaw', roundedBox(0.255, 0.09, 0.255, 0.06), M.skinShade, [0, 1.045, 0.01])
  H('ear_L', roundedBox(0.03, 0.075, 0.058, 0.014), M.skinShade, [-0.168, 1.155, -0.005])
  H('ear_R', roundedBox(0.03, 0.075, 0.058, 0.014), M.skinShade, [0.168, 1.155, -0.005])

  H('hair_crown', roundedBox(0.335, 0.13, 0.305, 0.085), M.hair, [0, 1.295, 0])
  H('hair_fringe', roundedBox(0.315, 0.085, 0.06, 0.03), M.hair, [0, 1.248, 0.125], [0.06, 0, 0])
  H('hair_side_L', roundedBox(0.042, 0.17, 0.255, 0.026), M.hair, [-0.155, 1.20, -0.022])
  H('hair_side_R', roundedBox(0.042, 0.17, 0.255, 0.026), M.hair, [0.155, 1.20, -0.022])
  H('hair_back', roundedBox(0.315, 0.215, 0.05, 0.03), M.hair, [0, 1.185, -0.138])
  H('hair_tuft', roundedBox(0.08, 0.065, 0.095, 0.032), M.hair, [0.062, 1.352, -0.015], [0, 0, -0.28])

  const eyes = []
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    H(`eye_white_${side}`, new THREE.SphereGeometry(0.034, 18, 12), M.paper, [sx * 0.066, 1.172, 0.118])
    const pupil = part(`eye_${side}`, new THREE.SphereGeometry(0.019, 14, 12), M.ink,
      [sx * 0.066, 1.170 - 1.045, 0.144])
    head.add(pupil)
    eyes.push(pupil)
    H(`eye_gleam_${side}`, new THREE.SphereGeometry(0.007, 10, 8), M.paper, [sx * 0.060, 1.180, 0.157])
    H(`brow_${side}`, roundedBox(0.068, 0.018, 0.022, 0.008), M.hair, [sx * 0.066, 1.232, 0.132], [0, 0, sx * 0.12])
  }
  H('nose', roundedBox(0.04, 0.034, 0.032, 0.013), M.skinShade, [0, 1.128, 0.148])
  H('mouth', new THREE.TorusGeometry(0.036, 0.008, 8, 20, Math.PI * 0.8), M.ink,
    [0, 1.098, 0.138], [0, 0, Math.PI + Math.PI * 0.1])

  sam.add(head)

  return { sam, head, hips, armL, armR, eyes, materials: M }
}

/** Free every geometry and material the rig owns. */
export function disposeSam(root) {
  root?.traverse?.((o) => {
    o.geometry?.dispose?.()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
    else o.material?.dispose?.()
  })
}
