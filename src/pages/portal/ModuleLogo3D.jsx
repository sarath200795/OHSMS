// ─────────────────────────────────────────────────────────────────────────────
// Module logos as small 3D objects that do something.
//
// A line icon says "clipboard". These say "the thing you do here": the pen
// crosses the page and ticks land behind it, the extinguisher squeezes and
// actually sprays, the cap is thrown rather than tilted. The action is the
// point — a shape that only rotates is still a glyph, just a busier one.
//
// Built from layered boxes at different translateZ depths inside the tile's
// existing perspective, so turning the tile genuinely parts them. Not WebGL:
// there are fourteen of these on one screen and a GL context each would exhaust
// the browser's limit before it troubled the machine. Everything is transform
// and opacity, so it composites on the GPU and costs nothing standing still.
//
// Every animation is group-hover only, so nothing here moves until the cursor
// is on the tile, and none of it costs a React render.
// ─────────────────────────────────────────────────────────────────────────────

/** An absolutely-positioned slab. `z` is its depth in the little scene. */
const Slab = ({ z = 0, className = '', style, children }) => (
  <span className={`absolute ${className}`} style={{ transform: `translateZ(${z}px)`, ...style }}>
    {children}
  </span>
)

// ── Inspections: a pen crosses the page and ticks land behind it ─────────────
function InspectionPad() {
  return (
    <>
      <Slab z={6} className="h-[34px] w-[26px] rounded-[5px] bg-white/95 shadow-[0_2px_4px_rgba(0,0,0,0.25)]" />
      <Slab z={9} className="h-[7px] w-[13px] -translate-y-[16px] rounded-[3px] bg-slate-300" />
      {[0, 1, 2].map((i) => (
        <Slab key={`r${i}`} z={8} className="h-[2px] w-[13px] rounded-full bg-slate-400/70"
          style={{ transform: `translateZ(8px) translateY(${-4 + i * 7}px) translateX(1px)` }} />
      ))}
      {/* Ticks land one after another, so the pen looks like it is causing them. */}
      {[0, 1, 2].map((i) => (
        <span
          key={`t${i}`}
          className={`absolute h-[7px] w-[3.5px] rotate-45 border-b-[2.5px] border-r-[2.5px] border-emerald-400 opacity-0 group-hover:animate-pop-in motion-reduce:group-hover:animate-none`}
          style={{
            transform: `translateZ(11px) translateY(${-5 + i * 7}px) translateX(-9px) rotate(45deg)`,
            animationDelay: `${0.25 + i * 0.36}s`,
          }}
        />
      ))}
      <span
        className={`absolute h-[15px] w-[3px] rounded-full bg-amber-300 group-hover:animate-pen-write motion-reduce:group-hover:animate-none`}
        style={{ transform: 'translateZ(16px) rotate(28deg)' }}
      />
    </>
  )
}

// ── Equipment: the extinguisher squeezes and sprays ──────────────────────────
function Extinguisher() {
  return (
    <>
      <span className={`relative group-hover:animate-squeeze motion-reduce:group-hover:animate-none`} style={{ transform: 'translateZ(12px) rotate(-6deg)' }}>
        <span className="absolute -left-[9px] -top-[8px] h-[26px] w-[18px] rounded-[7px] bg-red-600 shadow-[inset_-3px_0_5px_rgba(0,0,0,0.28)]" />
        <span className="absolute -left-[7px] top-0 h-[9px] w-[14px] rounded-[2px] bg-white/90" />
        <span className="absolute -left-[4px] -top-[13px] h-[6px] w-[8px] rounded-[2px] bg-slate-700" />
        <span className="absolute -left-[10px] -top-[16px] h-[3px] w-[16px] rounded-full bg-slate-500" />
        <span className="absolute left-[5px] -top-[14px] h-[3px] w-[9px] rotate-[35deg] rounded-full bg-slate-400" />
      </span>
      {/* Three puffs leaving the nozzle on a stagger. */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`absolute h-[7px] w-[7px] rounded-full bg-white/80 opacity-0 group-hover:animate-spray motion-reduce:group-hover:animate-none`}
          style={{ transform: 'translateZ(18px) translate(10px,-12px)', animationDelay: `${i * 0.28}s` }}
        />
      ))}
    </>
  )
}

// ── Mock drills: the hooter shakes and throws sound ──────────────────────────
function Hooter() {
  return (
    <>
      <span className={`relative group-hover:animate-shake motion-reduce:group-hover:animate-none`}>
        <Slab z={8} className="h-[16px] w-[10px] -translate-x-[16px] -translate-y-[8px] rounded-[3px] bg-slate-700" />
        <span
          className="absolute -left-[7px] -top-[13px] h-0 w-0 border-y-[13px] border-l-[20px] border-y-transparent border-l-amber-400"
          style={{ transform: 'translateZ(12px)' }}
        />
      </span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`absolute rounded-full border-[2.5px] border-white/75 opacity-0 group-hover:animate-blare motion-reduce:group-hover:animate-none`}
          style={{
            height: 14 + i * 10, width: 14 + i * 10,
            transform: `translateZ(${10 + i * 3}px) translateX(${12 + i * 3}px)`,
            animationDelay: `${i * 0.16}s`,
            clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
          }}
        />
      ))}
    </>
  )
}

// ── Internal audit: the glass sweeps and the page lights under it ────────────
function MagnifierOverPaper() {
  return (
    <>
      <Slab z={4} className="h-[32px] w-[25px] rounded-[4px] bg-white/95 shadow-[0_2px_4px_rgba(0,0,0,0.25)]" />
      {[0, 1, 2, 3].map((i) => (
        <Slab key={i} z={6} className="h-[2px] rounded-full bg-slate-400/70"
          style={{ transform: `translateZ(6px) translateY(${-9 + i * 6}px)`, width: i === 3 ? 10 : 15 }} />
      ))}
      <span className={`absolute group-hover:animate-magnify motion-reduce:group-hover:animate-none`} style={{ transform: 'translateZ(14px) translate(-4px,-3px) rotate(-12deg)' }}>
        <span className="absolute h-[19px] w-[19px] rounded-full border-[3px] border-slate-200 bg-sky-200/30" />
        {/* What the lens finds, glowing under it. */}
        <span className={`absolute left-[3px] top-[3px] h-[13px] w-[13px] rounded-full bg-sky-100/70 group-hover:animate-scan-glow motion-reduce:group-hover:animate-none`} />
        <span className="absolute left-[15px] top-[15px] h-[11px] w-[3.5px] rotate-[-45deg] rounded-full bg-slate-300" />
      </span>
    </>
  )
}

// ── HSE committee: three people bob and one speaks ───────────────────────────
function CommitteeGroup() {
  const person = (x, z, h, tone, delay) => (
    <span
      key={x}
      className={`absolute group-hover:animate-chatter motion-reduce:group-hover:animate-none`}
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
      {/* Somebody makes a point. */}
      <span
        className={`absolute grid h-[13px] w-[16px] place-items-center rounded-[5px] bg-white opacity-0 group-hover:animate-pop-in motion-reduce:group-hover:animate-none`}
        style={{ transform: 'translateZ(20px) translate(9px,-19px)', animationDelay: '0.3s' }}
      >
        <span className="flex gap-[2px]">
          {[0, 1, 2].map((i) => <span key={i} className="h-[2px] w-[2px] rounded-full bg-slate-500" />)}
        </span>
      </span>
    </>
  )
}

// ── Emergency response: the handset is picked up ─────────────────────────────
function Telephone() {
  return (
    <>
      <Slab z={5} className="h-[13px] w-[30px] translate-y-[10px] rounded-[4px] bg-slate-700" />
      <Slab z={6} className="h-[3px] w-[18px] translate-y-[6px] rounded-full bg-slate-500/70" />
      <span className={`absolute group-hover:animate-lift-handset motion-reduce:group-hover:animate-none`} style={{ transform: 'translateZ(12px) rotate(-6deg)' }}>
        <span className="absolute -left-[15px] -top-[6px] h-[10px] w-[10px] rounded-[4px] bg-white/95" />
        <span className="absolute left-[5px] -top-[6px] h-[10px] w-[10px] rounded-[4px] bg-white/95" />
        <span className="absolute -left-[11px] -top-[10px] h-[5px] w-[22px] rounded-[3px] bg-white/95" />
      </span>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={`absolute rounded-full border-[2px] border-white/70 opacity-0 group-hover:animate-blare motion-reduce:group-hover:animate-none`}
          style={{
            height: 18 + i * 10, width: 18 + i * 10,
            transform: `translateZ(${8 + i * 3}px) translate(-16px,-10px)`,
            animationDelay: `${i * 0.2}s`,
            clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)',
          }}
        />
      ))}
    </>
  )
}

// ── Analytics: bars grow in sequence under a rising trend arrow ──────────────
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
          className={`absolute w-[7px] rounded-t-[3px] bg-white/95 group-hover:animate-bar-grow motion-reduce:group-hover:animate-none`}
          style={{
            height: b.h,
            transform: `translateZ(10px) translateX(${b.x}px) translateY(${14 - b.h / 2}px)`,
            transformOrigin: 'bottom',
            animationDelay: `${b.d}s`,
          }}
        />
      ))}
      {/* The trend the bars add up to. */}
      <span
        className={`absolute h-[3px] w-[26px] rounded-full bg-emerald-300 group-hover:animate-trend-rise motion-reduce:group-hover:animate-none`}
        style={{ transform: 'translateZ(18px) translate(-4px,6px) rotate(-30deg)' }}
      >
        <span className="absolute -right-[1px] -top-[3px] h-0 w-0 border-y-[4.5px] border-l-[7px] border-y-transparent border-l-emerald-300" />
      </span>
    </>
  )
}

// ── Training: the cap is thrown and the tassel swings ────────────────────────
function GraduationCap() {
  return (
    <>
      <Slab z={4} className="h-[13px] w-[19px] translate-y-[9px] rounded-b-[6px] bg-slate-200/90" />
      <span className={`absolute group-hover:animate-toss-up motion-reduce:group-hover:animate-none`} style={{ transform: 'translateZ(10px) rotate(-8deg)' }}>
        <span
          className="absolute -left-[19px] -top-[8px] h-[10px] w-[38px] rounded-[3px] bg-slate-800 shadow-[0_2px_3px_rgba(0,0,0,0.3)]"
          style={{ clipPath: 'polygon(50% 0, 100% 45%, 50% 90%, 0 45%)' }}
        />
        <span className={`absolute left-[13px] -top-[6px] origin-top group-hover:animate-tassel motion-reduce:group-hover:animate-none`}>
          <span className="absolute h-[13px] w-[2px] rounded-full bg-amber-300" />
          <span className="absolute top-[12px] -left-[2px] h-[6px] w-[6px] rounded-full bg-amber-300" />
        </span>
      </span>
    </>
  )
}

// ── LOTO: the shackle lifts and the tag swings off it ────────────────────────
function LotoLock() {
  return (
    <>
      <span
        className={`absolute h-[15px] w-[17px] rounded-t-[9px] border-[3.5px] border-b-0 border-slate-200 group-hover:animate-lock-open motion-reduce:group-hover:animate-none`}
        style={{ transform: 'translateZ(6px) translateY(-11px)' }}
      />
      <Slab z={12} className="h-[21px] w-[26px] translate-y-[5px] rounded-[5px] bg-red-600 shadow-[inset_-3px_-2px_5px_rgba(0,0,0,0.3)]" />
      <Slab z={15} className="h-[6px] w-[6px] translate-y-[3px] rounded-full bg-slate-900/70" />
      <Slab z={15} className="h-[5px] w-[2.5px] translate-y-[8px] rounded-full bg-slate-900/70" />
      {/* The danger tag every lockout carries. */}
      <span
        className={`absolute origin-top group-hover:animate-tag-swing motion-reduce:group-hover:animate-none`}
        style={{ transform: 'translateZ(17px) translate(16px,-6px) rotate(-10deg)' }}
      >
        <span className="absolute h-[5px] w-[1.5px] bg-slate-300" />
        <span className="absolute top-[4px] -left-[5px] h-[14px] w-[11px] rounded-[2px] bg-amber-300 shadow-[0_1px_2px_rgba(0,0,0,0.3)]" />
        <span className="absolute top-[7px] -left-[3px] h-[1.5px] w-[7px] rounded-full bg-amber-700/70" />
        <span className="absolute top-[11px] -left-[3px] h-[1.5px] w-[5px] rounded-full bg-amber-700/70" />
      </span>
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
