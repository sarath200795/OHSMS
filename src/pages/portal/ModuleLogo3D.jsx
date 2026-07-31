// ─────────────────────────────────────────────────────────────────────────────
// Module logos as small 3D objects.
//
// A line icon says "clipboard"; these say "the thing you do here". Each is
// built from layered boxes at different translateZ depths inside the tile's
// existing perspective, so turning the tile genuinely parts them — the same
// technique Sam's original used.
//
// Not WebGL, deliberately: there are fourteen of these on one screen, and a GL
// context each would exhaust the browser's limit before it exhausted the
// laptop. Everything here is transform and opacity, so it composites on the GPU
// and costs nothing when still.
//
// Every animation is group-hover only, so nothing here moves until the cursor
// is on the tile, and none of it costs a React render.
// ─────────────────────────────────────────────────────────────────────────────

/** An absolutely-positioned slab. `z` is its depth in the little scene. */
const Slab = ({ z = 0, className = '', style, children }) => (
  <span
    className={`absolute ${className}`}
    style={{ transform: `translateZ(${z}px)`, ...style }}
  >
    {children}
  </span>
)

// ── Inspections: a clipboard with a pen moving across it ─────────────────────
function InspectionPad() {
  return (
    <>
      <Slab z={6} className="h-[34px] w-[26px] rounded-[5px] bg-white/95 shadow-[0_2px_4px_rgba(0,0,0,0.25)]" />
      <Slab z={9} className="h-[7px] w-[13px] -translate-y-[16px] rounded-[3px] bg-slate-300" />
      {[0, 1, 2].map((i) => (
        <Slab key={i} z={8} className="h-[2px] w-[15px] rounded-full bg-slate-400/80"
          style={{ transform: `translateZ(8px) translateY(${-4 + i * 6}px) translateX(-2px)` }} />
      ))}
      {/* the tick that says it passed */}
      <Slab z={10} className="h-[8px] w-[4px] translate-x-[6px] translate-y-[8px] rotate-45 border-b-[3px] border-r-[3px] border-emerald-400" />
      <span
        className="absolute h-[15px] w-[3px] rounded-full bg-amber-300 group-hover:animate-pen-write motion-reduce:group-hover:animate-none"
        style={{ transform: 'translateZ(16px) rotate(28deg)' }}
      />
    </>
  )
}

// ── Equipment: a fire extinguisher, squeezed ─────────────────────────────────
function Extinguisher() {
  return (
    <span className="relative group-hover:animate-squeeze motion-reduce:group-hover:animate-none" style={{ transform: 'translateZ(12px) rotate(-6deg)' }}>
      <span className="absolute -left-[9px] -top-[10px] h-[26px] w-[18px] rounded-[7px] bg-red-600 shadow-[inset_-3px_0_5px_rgba(0,0,0,0.28)]" />
      <span className="absolute -left-[7px] -top-[2px] h-[9px] w-[14px] rounded-[2px] bg-white/90" />
      <span className="absolute -left-[4px] -top-[15px] h-[6px] w-[8px] rounded-[2px] bg-slate-700" />
      <span className="absolute -left-[10px] -top-[18px] h-[3px] w-[16px] rounded-full bg-slate-500" />
      <span className="absolute left-[5px] -top-[16px] h-[3px] w-[9px] rotate-[35deg] rounded-full bg-slate-400" />
    </span>
  )
}

// ── Mock drills: a hooter, blaring ───────────────────────────────────────────
function Hooter() {
  return (
    <>
      <Slab z={8} className="h-[16px] w-[10px] -translate-x-[7px] rounded-[3px] bg-slate-700" />
      <span
        className="absolute -right-[2px] h-0 w-0 border-y-[13px] border-l-[20px] border-y-transparent border-l-amber-400"
        style={{ transform: 'translateZ(12px)' }}
      />
      {[0, 1].map((i) => (
        <span
          key={i}
          className="absolute rounded-full border-[2.5px] border-white/70 group-hover:animate-blare motion-reduce:group-hover:animate-none"
          style={{
            height: 16 + i * 12, width: 16 + i * 12,
            transform: `translateZ(${8 + i * 4}px) translateX(${10 + i * 4}px)`,
            animationDelay: `${i * 0.18}s`,
            clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
          }}
        />
      ))}
    </>
  )
}

// ── Internal audit: a magnifying glass sweeping a page ───────────────────────
function MagnifierOverPaper() {
  return (
    <>
      <Slab z={4} className="h-[32px] w-[25px] rounded-[4px] bg-white/95 shadow-[0_2px_4px_rgba(0,0,0,0.25)]" />
      {[0, 1, 2, 3].map((i) => (
        <Slab key={i} z={6} className="h-[2px] rounded-full bg-slate-400/70"
          style={{ transform: `translateZ(6px) translateY(${-9 + i * 6}px)`, width: i === 3 ? 10 : 15 }} />
      ))}
      <span className="absolute group-hover:animate-magnify motion-reduce:group-hover:animate-none" style={{ transform: 'translateZ(14px) translate(-4px,-3px) rotate(-12deg)' }}>
        <span className="absolute h-[19px] w-[19px] rounded-full border-[3px] border-slate-200 bg-sky-200/35" />
        <span className="absolute left-[15px] top-[15px] h-[11px] w-[3.5px] rotate-[-45deg] rounded-full bg-slate-300" />
      </span>
    </>
  )
}

// ── HSE committee: three people around a table, talking ──────────────────────
function CommitteeGroup() {
  const person = (x, z, h, tone, delay) => (
    <span
      key={x}
      className="absolute group-hover:animate-chatter motion-reduce:group-hover:animate-none"
      style={{ transform: `translateZ(${z}px) translateX(${x}px)`, animationDelay: `${delay}s` }}
    >
      <span className={`absolute -top-[13px] left-[-4px] h-[8px] w-[8px] rounded-full ${tone}`} />
      <span className={`absolute -top-[4px] left-[-6px] w-[12px] rounded-t-[6px] ${tone}`} style={{ height: h }} />
    </span>
  )
  return (
    <>
      {person(-13, 6, 13, 'bg-white/90', 0)}
      {person(0, 12, 15, 'bg-sky-200', 0.14)}
      {person(13, 6, 13, 'bg-white/75', 0.28)}
      <Slab z={14} className="h-[4px] w-[38px] translate-y-[13px] rounded-full bg-slate-700/80" />
    </>
  )
}

// ── Emergency response: a telephone handset, ringing ─────────────────────────
function Telephone() {
  return (
    <>
      <Slab z={5} className="h-[13px] w-[30px] translate-y-[10px] rounded-[4px] bg-slate-700" />
      <span className="absolute group-hover:animate-phone-ring motion-reduce:group-hover:animate-none" style={{ transform: 'translateZ(12px) rotate(-6deg)' }}>
        <span className="absolute -left-[15px] -top-[6px] h-[10px] w-[10px] rounded-[4px] bg-white/95" />
        <span className="absolute left-[5px] -top-[6px] h-[10px] w-[10px] rounded-[4px] bg-white/95" />
        <span className="absolute -left-[11px] -top-[10px] h-[5px] w-[22px] rounded-[3px] bg-white/95" />
      </span>
    </>
  )
}

// ── Analytics: bars rising and falling ───────────────────────────────────────
function BarGraph() {
  const bars = [
    { x: -14, h: 12, d: 0 },
    { x: -5, h: 22, d: 0.16 },
    { x: 4, h: 16, d: 0.32 },
    { x: 13, h: 26, d: 0.48 },
  ]
  return (
    <>
      <Slab z={4} className="h-[2px] w-[38px] translate-y-[15px] rounded-full bg-white/50" />
      {bars.map((b) => (
        <span
          key={b.x}
          className="absolute w-[7px] rounded-t-[3px] bg-white/95 group-hover:animate-bar-grow motion-reduce:group-hover:animate-none"
          style={{
            height: b.h,
            transform: `translateZ(10px) translateX(${b.x}px) translateY(${14 - b.h / 2}px)`,
            transformOrigin: 'bottom',
            animationDelay: `${b.d}s`,
          }}
        />
      ))}
    </>
  )
}

// ── Training: a graduation cap, tipping ──────────────────────────────────────
function GraduationCap() {
  return (
    <>
      <Slab z={4} className="h-[13px] w-[19px] translate-y-[8px] rounded-b-[6px] bg-slate-200/90" />
      <span className="absolute group-hover:animate-hat-tip motion-reduce:group-hover:animate-none" style={{ transform: 'translateZ(10px) rotate(-8deg)' }}>
        <span className="absolute -left-[19px] -top-[8px] h-[10px] w-[38px] rotate-[-4deg] rounded-[3px] bg-slate-800 shadow-[0_2px_3px_rgba(0,0,0,0.3)]"
          style={{ clipPath: 'polygon(50% 0, 100% 45%, 50% 90%, 0 45%)' }} />
        <span className="absolute left-[13px] -top-[6px] h-[13px] w-[2px] rounded-full bg-amber-300" />
        <span className="absolute left-[11px] top-[6px] h-[6px] w-[6px] rounded-full bg-amber-300" />
      </span>
    </>
  )
}

// ── LOTO: a padlock whose shackle lifts ──────────────────────────────────────
function LotoLock() {
  return (
    <>
      <span
        className="absolute h-[15px] w-[17px] rounded-t-[9px] border-[3.5px] border-b-0 border-slate-200 group-hover:animate-lock-open motion-reduce:group-hover:animate-none"
        style={{ transform: 'translateZ(6px) translateY(-11px)' }}
      />
      <Slab z={12} className="h-[21px] w-[26px] translate-y-[5px] rounded-[5px] bg-red-600 shadow-[inset_-3px_-2px_5px_rgba(0,0,0,0.3)]" />
      <Slab z={15} className="h-[6px] w-[6px] translate-y-[3px] rounded-full bg-slate-900/70" />
      <Slab z={15} className="h-[5px] w-[2.5px] translate-y-[8px] rounded-full bg-slate-900/70" />
    </>
  )
}

const LOGOS = {
  inspections: InspectionPad,
  equipment: Extinguisher,
  drills: Hooter,
  audit: MagnifierOverPaper,
  committee: CommitteeGroup,
  emergency: Telephone,
  analytics: BarGraph,
  training: GraduationCap,
  loto: LotoLock,
}

export const has3DLogo = (key) => !!LOGOS[key]

/**
 * The 3D object for a module, or nothing when it has none — the tile falls back
 * to its line icon rather than being given a shape that means something else.
 */
export default function ModuleLogo3D({ moduleKey }) {
  const Logo = LOGOS[moduleKey]
  if (!Logo) return null
  return (
    <span className="relative grid h-full w-full place-items-center [transform-style:preserve-3d]">
      <Logo />
    </span>
  )
}
