// Brand logo mark — a magnifying glass inspecting gears (full colour).
// Gears are generated procedurally so the cog outlines stay crisp at any size.
// `size` sets width/height; extra props pass through.
const INK = '#14181f'

function gearPath(cx, cy, rOuter, rRoot, teeth) {
  cx = Number(cx); cy = Number(cy); rOuter = Number(rOuter); rRoot = Number(rRoot)
  const tw = ((Math.PI * 2) / teeth) * 0.46 // angular tooth width
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const c = (i / teeth) * Math.PI * 2
    const ring = [
      [c - tw / 2, rRoot],
      [c - tw / 2, rOuter],
      [c + tw / 2, rOuter],
      [c + tw / 2, rRoot],
    ]
    ring.forEach(([a, r]) => {
      const x = (cx + Math.cos(a) * r).toFixed(1)
      const y = (cy + Math.sin(a) * r).toFixed(1)
      d += `${d ? 'L' : 'M'}${x} ${y} `
    })
  }
  return d + 'Z'
}

function Gear({ cx, cy, rOuter, rRoot, teeth, hub, body = '#5d6d7e', cap = '#aab2bb' }) {
  return (
    <g stroke={INK} strokeWidth="13" strokeLinejoin="round">
      <path d={gearPath(cx, cy, rOuter, rRoot, teeth)} fill={body} />
      <circle cx={cx} cy={cy} r={hub} fill={cap} />
    </g>
  )
}

export default function InspectorMark({ size = 24, className = '', ...props }) {
  // Handle axis (from just inside the lens rim, out to the grip tip).
  const S = [196, 318]
  const E = [64, 452]
  const at = (t) => `${(S[0] + (E[0] - S[0]) * t).toFixed(1)} ${(S[1] + (E[1] - S[1]) * t).toFixed(1)}`
  const seg = (t1, t2, color, w) => (
    <path d={`M${at(t1)} L${at(t2)}`} stroke={color} strokeWidth={w} strokeLinecap="round" />
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Inspections"
      {...props}
    >
      <defs>
        <clipPath id="lensClip">
          <circle cx="300" cy="208" r="120" />
        </clipPath>
      </defs>

      {/* Gears behind the magnifier */}
      <Gear cx={150} cy={158} rOuter={92} rRoot={64} teeth={8} hub={30} />
      <Gear cx={372} cy={372} rOuter={104} rRoot={74} teeth={8} hub={34} />

      {/* Handle — black outline under, then ferrule / collar / grip / tip */}
      <path d={`M${at(0)} L${at(1)}`} stroke={INK} strokeWidth="58" strokeLinecap="round" />
      {seg(0.0, 0.24, '#f15a24', 40)}
      {seg(0.24, 0.34, '#7f8a94', 40)}
      {seg(0.32, 0.88, '#29abe2', 40)}
      {seg(0.86, 1.0, '#aeb6be', 40)}

      {/* Lens: blue fill, a gear + chart line seen through it, then the orange rim */}
      <circle cx="300" cy="208" r="128" fill="#29abe2" stroke={INK} strokeWidth="12" />
      <g clipPath="url(#lensClip)">
        <g stroke={INK} strokeWidth="11" strokeLinejoin="round">
          <path d={gearPath(312, 262, 70, 48, 8)} fill="#2f3a45" />
          <circle cx="312" cy="262" r="22" fill="#5d6d7e" />
        </g>
        <path d="M214 196 L262 232 L300 176 L344 222 L388 168" fill="none" stroke="#1c2630" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* Orange rim with black edges */}
      <circle cx="300" cy="208" r="140" fill="none" stroke="#f7941e" strokeWidth="26" />
      <circle cx="300" cy="208" r="153" fill="none" stroke={INK} strokeWidth="7" />
      <circle cx="300" cy="208" r="127" fill="none" stroke={INK} strokeWidth="7" />
    </svg>
  )
}
