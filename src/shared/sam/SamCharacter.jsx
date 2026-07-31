// ─────────────────────────────────────────────────────────────────────────────
// Sam — a 3D safety officer, built from CSS 3D transforms.
//
// Real geometry, not a sprite: every body part is a box whose faces are placed
// in 3D space with translateZ/rotateY inside `transform-style: preserve-3d`, so
// turning the rig genuinely reveals its sides. The idle turn exists to show
// that depth — a flat illustration would look wrong the moment it rotated.
//
// Why not WebGL: Sam is mounted app-wide and visible on every page, so a
// three.js build would add several hundred KB to the bundle and hold a live GL
// context open for the whole session, on every one of the 100–200 concurrent
// users this app targets. CSS 3D is GPU-composited, costs nothing to download,
// and degrades cleanly. Every animation here is transform/opacity only, so it
// stays off the main thread.
//
// Motion is suppressed entirely under prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

// Taken from the Sam 3D design's material list, so the two read as the same
// character. The vest is brand terracotta over a navy shirt rather than generic
// hi-vis yellow, and the reflective tape is clay-surface — Sam wears the
// product's own palette instead of borrowing a stock safety look.
const C = {
  hair: '#e8a33d',        // accent-amber
  hairDark: '#c9861f',
  skin: '#eec9a0',
  skinDark: '#d9ac7f',
  vest: '#c74a33',        // brand-600
  vestDark: '#a63b28',
  band: '#f8f1e4',        // clay-surface — the reflective tape
  shirt: '#456175',
  shirtDark: '#31465a',
  trouser: '#31465a',
  trouserDark: '#273949',
  boot: '#2c241d',        // ink-900
}

/** One face of a box. */
const face = (bg, transform, extra = {}) => ({
  position: 'absolute',
  inset: 0,
  background: bg,
  transform,
  ...extra,
})

/**
 * A 3D box: a front face plus the two sides, sized w×h with depth d.
 *
 * Back, top and bottom are omitted deliberately. The rig only turns ±20°, so
 * those faces can never come into view, and every face we skip is one fewer
 * composited layer in a component that is mounted on every page for every user.
 * Omitting the back is also why no face needs `backface-visibility: hidden`,
 * which would promote a layer each.
 */
function Box({ w, h, d, color, dark, radius = 0, style, children }) {
  return (
    <div style={{ position: 'absolute', width: w, height: h, transformStyle: 'preserve-3d', ...style }}>
      <div style={face(color, `translateZ(${d / 2}px)`, { borderRadius: radius })}>{children}</div>
      <div style={face(dark, `rotateY(-90deg) translateZ(${w / 2}px)`, { width: d, left: (w - d) / 2 })} />
      <div style={face(dark, `rotateY(90deg) translateZ(${w / 2}px)`, { width: d, left: (w - d) / 2 })} />
    </div>
  )
}

/**
 * @param {boolean} walking  swing the limbs (Sam is strolling to a new spot)
 * @param {number}  facing   1 = facing right, -1 = facing left
 * @param {boolean} talking  nod while answering
 * @param {boolean} reduce   honour prefers-reduced-motion
 */
export default function SamCharacter({ walking = false, facing = 1, talking = false, reduce = false, size = 64 }) {
  // Geometry is authored at 64px and scaled, so callers can resize freely.
  const s = size / 64
  const anim = (name, dur) => (reduce ? 'none' : `${name} ${dur} infinite ease-in-out`)

  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size,
        perspective: 220 * s,
        // Sam is decorative; the button around it carries the label and focus.
        pointerEvents: 'none',
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        style={{
          position: 'relative', width: '100%', height: '100%',
          transformStyle: 'preserve-3d',
          transform: `scale(${s}) rotateY(${facing < 0 ? 20 : -20}deg)`,
          animation: anim(walking ? 'sam-bob-walk' : 'sam-bob', walking ? '0.6s' : '3.2s'),
        }}
      >
        {/* Rig — the slow turn is what reveals the geometry is solid */}
        <div
          style={{
            position: 'absolute', inset: 0, transformStyle: 'preserve-3d',
            animation: anim('sam-turn', '7s'),
          }}
        >
          {/* ── Legs ── */}
          <Box w={9} h={16} d={9} color={C.trouser} dark={C.trouserDark} radius={2}
            style={{
              left: 16, top: 46, transformOrigin: 'top center',
              animation: walking ? anim('sam-leg-a', '0.6s') : 'none',
            }}
          />
          <Box w={9} h={16} d={9} color={C.trouser} dark={C.trouserDark} radius={2}
            style={{
              left: 28, top: 46, transformOrigin: 'top center',
              animation: walking ? anim('sam-leg-b', '0.6s') : 'none',
            }}
          />
          {/* Boots */}
          <Box w={11} h={5} d={11} color={C.boot} dark={C.boot} radius={2} style={{ left: 15, top: 60 }} />
          <Box w={11} h={5} d={11} color={C.boot} dark={C.boot} radius={2} style={{ left: 27, top: 60 }} />

          {/* ── Torso: navy shirt under an open terracotta vest ── */}
          <Box w={26} h={26} d={14} color={C.shirt} dark={C.shirtDark} radius={4} style={{ left: 14, top: 22 }}>
            {/* The vest is two open panels over the shirt, not a solid front —
                which is what makes it read as worn rather than painted on. */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 8, background: C.vest, borderRadius: '4px 0 0 4px' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 8, background: C.vest, borderRadius: '0 4px 4px 0' }} />
            {/* Reflective tape, carried across both panels */}
            <div style={{ position: 'absolute', top: 8, left: 0, width: 8, height: 3, background: C.band }} />
            <div style={{ position: 'absolute', top: 8, right: 0, width: 8, height: 3, background: C.band }} />
            <div style={{ position: 'absolute', top: 16, left: 0, width: 8, height: 3, background: C.band }} />
            <div style={{ position: 'absolute', top: 16, right: 0, width: 8, height: 3, background: C.band }} />
          </Box>

          {/* ── Arms — shirt sleeves; the vest is sleeveless ── */}
          <Box w={7} h={20} d={7} color={C.shirt} dark={C.shirtDark} radius={3}
            style={{
              left: 8, top: 24, transformOrigin: 'top center',
              animation: walking ? anim('sam-arm-a', '0.6s') : anim('sam-arm-idle', '3.2s'),
            }}
          />
          <Box w={7} h={20} d={7} color={C.shirt} dark={C.shirtDark} radius={3}
            style={{
              left: 39, top: 24, transformOrigin: 'top center',
              // The free arm waves when Sam is talking — the only asymmetry, and
              // it reads as friendly rather than mechanical.
              animation: talking && !reduce ? 'sam-wave 1.1s infinite ease-in-out'
                : walking ? anim('sam-arm-b', '0.6s') : anim('sam-arm-idle-b', '3.2s'),
            }}
          />

          {/* ── Head ── */}
          <div
            style={{
              position: 'absolute', inset: 0, transformStyle: 'preserve-3d',
              transformOrigin: '50% 22px',
              animation: talking ? anim('sam-nod', '0.9s') : 'none',
            }}
          >
            <Box w={20} h={18} d={16} color={C.skin} dark={C.skinDark} radius={5} style={{ left: 17, top: 6 }}>
              {/* Face — eyes blink, which is what makes it read as alive */}
              <div style={{
                position: 'absolute', top: 7, left: 3.5, width: 3, height: 3.5, borderRadius: '50%',
                background: '#3a2c25', animation: anim('sam-blink', '4.4s'),
              }} />
              <div style={{
                position: 'absolute', top: 7, right: 3.5, width: 3, height: 3.5, borderRadius: '50%',
                background: '#3a2c25', animation: anim('sam-blink', '4.4s'),
              }} />
              <div style={{
                position: 'absolute', top: 12.5, left: '50%', width: 7, height: 3.5, marginLeft: -3.5,
                borderRadius: '0 0 7px 7px', background: '#b4705a',
              }} />
            </Box>

            {/* Hair — crown, fringe and side tufts. The 3D design has no hard
                hat: Sam is the person who runs the safety system rather than
                someone dressed for a site visit, and the vest already carries
                the safety read. */}
            <Box w={21} h={8} d={17} color={C.hair} dark={C.hairDark} radius={5} style={{ left: 16.5, top: 2.5 }} />
            <div style={{
              position: 'absolute', left: 17, top: 8, width: 20, height: 4,
              background: C.hair, borderRadius: '2px 6px 2px 2px', transform: 'translateZ(8.5px)',
            }} />
            <div style={{
              position: 'absolute', left: 15.5, top: 5, width: 4, height: 11,
              background: C.hairDark, borderRadius: 3, transform: 'translateZ(6px)',
            }} />
            <div style={{
              position: 'absolute', right: 15.5, top: 5, width: 4, height: 11,
              background: C.hairDark, borderRadius: 3, transform: 'translateZ(6px)',
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const KEYFRAMES = `
@keyframes sam-bob       { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-3px)} }
@keyframes sam-bob-walk  { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-2px)} }
@keyframes sam-turn      { 0%,100%{transform:rotateY(-16deg)} 50%{transform:rotateY(16deg)} }
@keyframes sam-blink     { 0%,92%,100%{transform:scaleY(1)}   96%{transform:scaleY(0.1)} }
@keyframes sam-nod       { 0%,100%{transform:rotateX(0)}      50%{transform:rotateX(9deg)} }
@keyframes sam-leg-a     { 0%,100%{transform:rotateX(22deg)}  50%{transform:rotateX(-22deg)} }
@keyframes sam-leg-b     { 0%,100%{transform:rotateX(-22deg)} 50%{transform:rotateX(22deg)} }
@keyframes sam-arm-a     { 0%,100%{transform:rotateX(-26deg)} 50%{transform:rotateX(26deg)} }
@keyframes sam-arm-b     { 0%,100%{transform:rotateX(26deg)}  50%{transform:rotateX(-26deg)} }
@keyframes sam-arm-idle  { 0%,100%{transform:rotateX(0)}      50%{transform:rotateX(7deg)} }
@keyframes sam-arm-idle-b{ 0%,100%{transform:rotateX(0)}      50%{transform:rotateX(-7deg)} }
@keyframes sam-wave      { 0%,100%{transform:rotateZ(0) rotateX(0)} 50%{transform:rotateZ(-52deg) rotateX(-18deg)} }
`
