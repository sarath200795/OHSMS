/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Dark glass neon-tech kit (UX board 6387098). Cyan/blue is the
        // primary action (CTAs, focus, charts, sliders). Lime is success /
        // ON / progress. Orange is highlight. Magenta/purple is secondary.
        // The logo still carries coral; it is not the chrome.
        //
        // brand-600 must carry white text at AA (the skip-link and filled
        // chips). Bright cyan lives at 400/500; 700+ is text on a brand-50
        // wash — never `bg-*-700 text-white` (700 is a pastel, 1.4:1).
        brand: {
          50: '#0c2a38',
          100: '#0e3a4d',
          200: '#164e63',
          300: '#0e7490',
          400: '#22d3ee',
          500: '#22d3ee',
          600: '#0e7490',
          700: '#67e8f9',
          800: '#a5f3fc',
          900: '#cffafe',
        },
        magenta: {
          400: '#ff6bb5',
          500: '#ff2d92',
          600: '#e11d8a',
          700: '#f9a8d4',
        },
        // Screen ink is inverted vs the previous light ops look: 50–300 are
        // dark washes and hairlines, 400–900 are text. 400 is the AA floor
        // on canvas (#0c1024) — 5.5:1. Do not use 50–300 as body text.
        //
        // bg-ink-800/900/950 used to mean "near-black fill". Those sites are
        // remapped to canvas / black overlays; do not reintroduce them as
        // dark fills against this ramp.
        ink: {
          DEFAULT: '#e8eefc',
          50: '#121833',
          100: '#1a2144',
          200: '#2f3b63',
          300: '#44527a',
          400: '#8b9cb8',
          500: '#a8b6cc',
          600: '#c5d0e0',
          700: '#dbe3f0',
          800: '#e8eefc',
          900: '#f4f7ff',
          950: '#ffffff',
        },
        canvas: {
          DEFAULT: '#0c1024',
        },
        // Glass cards. DEFAULT is the raised panel; 50–400 are wells, row
        // washes and hairline-adjacent fills.
        surface: {
          DEFAULT: '#151b36',
          50: '#121833',
          100: '#1a2144',
          200: '#243056',
          300: '#33406a',
          400: '#4a5a82',
        },
        accent: {
          teal: '#2dd4bf',
          amber: '#fbbf24',
          orange: '#fb923c',
          lime: '#a3e635',
          steel: '#8b9cb8',
          leaf: '#a3e635',
        },
        // LOTO's original dark steel + hazard-yellow vocabulary. steel-50 is
        // the near-white heading again, now that the SPA is dark.
        steel: {
          50: '#f4f7ff',
          100: '#e8eefc',
          200: '#c5d0e0',
          300: '#a8b6cc',
          400: '#8b9cb8',
          500: '#64748b',
          600: '#44527a',
          700: '#2f3b63',
          800: '#1a2144',
          900: '#121833',
          950: '#0c1024',
        },
        hazard: {
          DEFAULT: '#fbbf24',
          dark: '#d97706',
        },
        danger: {
          DEFAULT: '#f87171',
        },
        // Tailwind's 50-tint palette is a light wash. On navy those chips
        // flash white, and 700-text on them fails AA. 50/100/200 are dark
        // washes; 700/800/900 are light text on those washes. 500/600 stay
        // saturated fills. Do not put white text on a 700 fill — that stop
        // is a pastel now (axe measured white on cyan-700 at 1.44:1).
        red: {
          50: '#3a1522',
          100: '#4a1c2c',
          200: '#7f2d40',
          700: '#fca5a5',
          800: '#fecaca',
          900: '#fee2e2',
        },
        rose: {
          50: '#3a1522',
          100: '#4a1c2c',
          200: '#7f2d40',
          700: '#fda4af',
          800: '#fecdd3',
          900: '#ffe4e6',
        },
        orange: {
          50: '#3a2414',
          100: '#4a2e18',
          200: '#7c4a1e',
          700: '#fdba74',
          800: '#fed7aa',
          900: '#ffedd5',
        },
        amber: {
          50: '#3a2e14',
          100: '#4a3b18',
          200: '#7c5c1e',
          700: '#fcd34d',
          800: '#fde68a',
          900: '#fef3c7',
        },
        yellow: {
          50: '#3a3514',
          100: '#4a4418',
          200: '#7c6e1e',
          700: '#fde047',
          800: '#fef08a',
          900: '#fef9c3',
        },
        lime: {
          50: '#1c3314',
          100: '#244418',
          200: '#3f6e1e',
          700: '#bef264',
          800: '#d9f99d',
          900: '#ecfccb',
        },
        green: {
          50: '#14331c',
          100: '#184424',
          200: '#1e6e3f',
          700: '#86efac',
          800: '#bbf7d0',
          900: '#dcfce7',
        },
        emerald: {
          50: '#14332c',
          100: '#18443a',
          200: '#1e6e5c',
          700: '#6ee7b7',
          800: '#a7f3d0',
          900: '#d1fae5',
        },
        teal: {
          50: '#14333a',
          100: '#18444a',
          200: '#1e6e7c',
          700: '#5eead4',
          800: '#99f6e4',
          900: '#ccfbf1',
        },
        cyan: {
          50: '#0c2a38',
          100: '#0e3a4d',
          200: '#164e63',
          700: '#67e8f9',
          800: '#a5f3fc',
          900: '#cffafe',
        },
        sky: {
          50: '#0c2438',
          100: '#0e324d',
          200: '#164e7c',
          700: '#7dd3fc',
          800: '#bae6fd',
          900: '#e0f2fe',
        },
        blue: {
          50: '#121833',
          100: '#1a2144',
          200: '#1e3a7c',
          700: '#93c5fd',
          800: '#bfdbfe',
          900: '#dbeafe',
        },
        indigo: {
          50: '#1a1538',
          100: '#241c4a',
          200: '#3f2d7c',
          700: '#a5b4fc',
          800: '#c7d2fe',
          900: '#e0e7ff',
        },
        violet: {
          50: '#221538',
          100: '#2c1c4a',
          200: '#4a2d7c',
          700: '#c4b5fd',
          800: '#ddd6fe',
          900: '#ede9fe',
        },
        purple: {
          50: '#2a1538',
          100: '#361c4a',
          200: '#5c2d7c',
          700: '#d8b4fe',
          800: '#e9d5ff',
          900: '#f3e8ff',
        },
        fuchsia: {
          50: '#33143a',
          100: '#44184a',
          200: '#6e1e7c',
          700: '#f0abfc',
          800: '#f5d0fe',
          900: '#fae8ff',
        },
        pink: {
          50: '#3a1528',
          100: '#4a1c34',
          200: '#7c2d52',
          700: '#f9a8d4',
          800: '#fbcfe8',
          900: '#fce7f3',
        },
        slate: { 50: '#121833', 100: '#1a2144', 200: '#243056' },
      },
      fontFamily: {
        sans: ['Roboto', 'system-ui', 'Segoe UI', 'sans-serif'],
        body: ['"Open Sans"', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      // Emil Kowalski motion tokens — stronger-than-default custom curves.
      transitionTimingFunction: {
        emil: 'cubic-bezier(0.23, 1, 0.32, 1)', // ease-out: enter/exit, responsive
        'emil-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)', // on-screen movement (wizards)
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)', // drawers/sheets
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.28), 0 8px 28px -8px rgba(34,211,238,0.45)',
        card: '0 0 0 1px rgba(255,255,255,0.08), 0 12px 32px rgba(4,8,24,0.45)',
        // Glass elevation + a thin light hairline. No dual-direction clay.
        elev: '0 0 0 1px rgba(255,255,255,0.08), 0 10px 28px rgba(4,8,24,0.4)',
        'elev-sm': '0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px rgba(4,8,24,0.28)',
        'elev-lg':
          '0 0 0 1px rgba(255,255,255,0.1), 0 18px 48px rgba(4,8,24,0.55), 0 0 40px rgba(34,211,238,0.08)',
        'elev-brand': '0 0 0 1px rgba(56,189,248,0.4), 0 8px 24px rgba(14,165,233,0.32)',
      },
      keyframes: {
        // Skeleton shimmer sweep.
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(34,211,238,0.5)' },
          '70%': { boxShadow: '0 0 0 14px rgba(34,211,238,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,211,238,0)' },
        },
        // Stagger entrance (decorative, short).
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // A logo turning slowly in place while the cursor rests on its tile.
        // It runs only on hover, so nothing on the page is moving unprompted.
        wobble3d: {
          '0%,100%': { transform: 'rotateY(-20deg) rotateX(11deg)' },
          '50%': { transform: 'rotateY(16deg) rotateX(-4deg)' },
        },
        // ── Module logo motions. Each is the object doing the thing it is for,
        // which is why they are separate keyframes rather than one shared wiggle.
        // The second set below is the payload — the spray, the toss, the pop —
        // that turns a movement into an action.
        spray: {
          '0%': { transform: 'translate(0,0) scale(0.3)', opacity: '0' },
          '25%': { opacity: '0.9' },
          '100%': { transform: 'translate(16px,-10px) scale(1.9)', opacity: '0' },
        },
        tossUp: {
          '0%,100%': { transform: 'translateZ(10px) translateY(0) rotate(-8deg)' },
          '30%': { transform: 'translateZ(22px) translateY(-13px) rotate(-26deg)' },
          '60%': { transform: 'translateZ(16px) translateY(-4px) rotate(4deg)' },
        },
        tassel: {
          '0%,100%': { transform: 'rotate(0deg)' },
          '30%': { transform: 'rotate(26deg)' },
          '65%': { transform: 'rotate(-16deg)' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0) rotate(0deg)' },
          '25%': { transform: 'translateX(-1.5px) rotate(-3deg)' },
          '75%': { transform: 'translateX(1.5px) rotate(3deg)' },
        },
        popIn: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '55%': { transform: 'scale(1.15)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        liftHandset: {
          '0%,100%': { transform: 'translateZ(12px) translateY(0) rotate(-6deg)' },
          '40%': { transform: 'translateZ(20px) translateY(-9px) rotate(-22deg)' },
          '70%': { transform: 'translateZ(16px) translateY(-4px) rotate(8deg)' },
        },
        trendRise: {
          '0%,100%': {
            transform: 'translateZ(18px) translate(-4px,6px) rotate(-30deg)',
            opacity: '0.35',
          },
          '50%': { transform: 'translateZ(22px) translate(6px,-6px) rotate(-30deg)', opacity: '1' },
        },
        tagSwing: {
          '0%,100%': { transform: 'rotate(-10deg)' },
          '50%': { transform: 'rotate(14deg)' },
        },
        scanGlow: {
          '0%,100%': { opacity: '0.2' },
          '50%': { opacity: '0.7' },
        },
        // A warning light turning, rather than simply blinking.
        beacon: {
          '0%,100%': { transform: 'translateZ(20px) scaleX(1)', opacity: '1' },
          '50%': { transform: 'translateZ(20px) scaleX(0.25)', opacity: '0.55' },
        },
        // A signal running down a connector from the organisation to one of its
        // stakeholders. Fades in at the bar, fades out as it lands, so three of
        // these on staggered delays read as continuous traffic rather than
        // three dots ticking in unison.
        flowDown: {
          '0%': { transform: 'translateY(0)', opacity: '0' },
          '15%': { opacity: '1' },
          '75%': { opacity: '1' },
          '100%': { transform: 'translateY(13px)', opacity: '0' },
        },
        // The stakeholder acknowledging it — a small lift as the signal lands,
        // not a bounce. These are people, not notifications.
        stakeNod: {
          '0%,100%': { transform: 'translateY(0)' },
          '55%': { transform: 'translateY(-1.5px)' },
        },
        // A CCTV camera sweeping its arc from a wall bracket, and pausing at
        // the ends of the sweep the way a real pan-tilt head does rather than
        // sliding back immediately.
        //
        // No translateZ baked in, unlike the older keyframes here: this one is
        // applied to an inner span whose parent carries the depth, so the
        // keyframe replacing `transform` cannot flatten the scene.
        cameraPan: {
          '0%,100%': { transform: 'rotate(-26deg)' },
          '8%': { transform: 'rotate(-26deg)' },
          '46%,54%': { transform: 'rotate(26deg)' },
          '92%': { transform: 'rotate(-26deg)' },
        },
        // The recording light: a hard on/off, not a fade. A camera's LED blinks.
        recBlink: {
          '0%,44%': { opacity: '1' },
          '45%,100%': { opacity: '0.15' },
        },
        // The field of view brightening as the camera settles at each end.
        viewCone: {
          '0%,100%': { opacity: '0.42' },
          '46%,54%': { opacity: '0.42' },
          '25%,75%': { opacity: '0.16' },
        },
        // The needle of a risk matrix settling on a square.
        needleSweep: {
          '0%,100%': { transform: 'translateZ(20px) rotate(-38deg)' },
          '45%': { transform: 'translateZ(20px) rotate(32deg)' },
          '70%': { transform: 'translateZ(20px) rotate(18deg)' },
        },
        // A stamp coming down on a permit.
        stampDown: {
          '0%,100%': {
            transform: 'translateZ(26px) translateY(-13px) rotate(-9deg)',
            opacity: '0.9',
          },
          '45%': { transform: 'translateZ(16px) translateY(1px) rotate(-3deg)', opacity: '1' },
          '60%': { transform: 'translateZ(18px) translateY(-2px) rotate(-4deg)', opacity: '1' },
        },
        // A sheet lifting out of the folder and settling back.
        filePull: {
          '0%,100%': { transform: 'translateZ(14px) translateY(0)' },
          '45%': { transform: 'translateZ(24px) translateY(-11px) rotate(5deg)' },
        },
        // An item ticking off and the list moving up to fill the gap.
        // The list moving down rather than up: work arriving on the tracker
        // instead of clearing off the top of it.
        // A drop falling clear of the cloud and fading as it goes.
        rainFall: {
          '0%': { transform: 'translateY(-4px)', opacity: '0' },
          '25%': { opacity: '1' },
          '100%': { transform: 'translateY(9px)', opacity: '0' },
        },
        listAdvance: {
          '0%,100%': { transform: 'translateY(0)', opacity: '1' },
          '55%': { transform: 'translateY(7px)', opacity: '0.35' },
        },
        // An arrow landing in the middle of the target.
        arrowHit: {
          '0%': { transform: 'translateZ(28px) translate(17px,-15px) rotate(38deg)', opacity: '0' },
          '30%': { opacity: '1' },
          '65%,100%': {
            transform: 'translateZ(28px) translate(1px,-1px) rotate(38deg)',
            opacity: '1',
          },
        },
        barGrow: {
          '0%,100%': { transform: 'scaleY(0.45)' },
          '50%': { transform: 'scaleY(1)' },
        },
        magnify: {
          '0%,100%': { transform: 'translateZ(14px) translate(-4px,-3px) rotate(-12deg)' },
          '50%': { transform: 'translateZ(18px) translate(5px,3px) rotate(-2deg)' },
        },
        lockOpen: {
          '0%,100%': { transform: 'translateZ(6px) translateY(0)' },
          '45%': { transform: 'translateZ(6px) translateY(-6px) rotate(12deg)' },
        },
        squeeze: {
          '0%,100%': { transform: 'translateZ(12px) rotate(-6deg)' },
          '50%': { transform: 'translateZ(16px) rotate(-14deg) translateY(-2px)' },
        },
        blare: {
          '0%,100%': { transform: 'translateZ(10px) scale(1)', opacity: '0.85' },
          '50%': { transform: 'translateZ(16px) scale(1.14)', opacity: '1' },
        },
        chatter: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        penWrite: {
          '0%,100%': { transform: 'translateZ(16px) rotate(28deg) translate(-3px,2px)' },
          '50%': { transform: 'translateZ(16px) rotate(28deg) translate(4px,-2px)' },
        },
        // The highlight that crosses a glossy face as it turns.
        sheen: {
          '0%': { transform: 'translateX(-120%) skewX(-18deg)', opacity: '0' },
          '18%': { opacity: '0.75' },
          '100%': { transform: 'translateX(220%) skewX(-18deg)', opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s infinite',
        pulseRing: 'pulseRing 2s infinite',
        'fade-in-up': 'fadeInUp 300ms cubic-bezier(0.23,1,0.32,1) both',
        wobble3d: 'wobble3d 2.8s cubic-bezier(0.45,0,0.55,1) infinite',
        sheen: 'sheen 1.5s cubic-bezier(0.23,1,0.32,1) infinite',
        'bar-grow': 'barGrow 1.4s cubic-bezier(0.45,0,0.55,1) infinite',
        magnify: 'magnify 2s cubic-bezier(0.45,0,0.55,1) infinite',
        'lock-open': 'lockOpen 1.6s cubic-bezier(0.23,1,0.32,1) infinite',
        squeeze: 'squeeze 1.4s cubic-bezier(0.45,0,0.55,1) infinite',
        blare: 'blare 0.85s cubic-bezier(0.45,0,0.55,1) infinite',
        chatter: 'chatter 1.1s cubic-bezier(0.45,0,0.55,1) infinite',
        'pen-write': 'penWrite 1.3s cubic-bezier(0.45,0,0.55,1) infinite',
        spray: 'spray 1.1s cubic-bezier(0.23,1,0.32,1) infinite',
        'toss-up': 'tossUp 1.8s cubic-bezier(0.23,1,0.32,1) infinite',
        tassel: 'tassel 1.8s cubic-bezier(0.45,0,0.55,1) infinite',
        shake: 'shake 0.32s cubic-bezier(0.36,0,0.66,1) infinite',
        'pop-in': 'popIn 1.6s cubic-bezier(0.23,1,0.32,1) infinite',
        'lift-handset': 'liftHandset 1.6s cubic-bezier(0.23,1,0.32,1) infinite',
        'trend-rise': 'trendRise 1.4s cubic-bezier(0.45,0,0.55,1) infinite',
        'tag-swing': 'tagSwing 1.3s cubic-bezier(0.45,0,0.55,1) infinite',
        'scan-glow': 'scanGlow 1.2s cubic-bezier(0.45,0,0.55,1) infinite',
        beacon: 'beacon 0.9s cubic-bezier(0.45,0,0.55,1) infinite',
        'flow-down': 'flowDown 1.9s cubic-bezier(0.45,0,0.55,1) infinite',
        'stake-nod': 'stakeNod 1.9s cubic-bezier(0.45,0,0.55,1) infinite',
        'camera-pan': 'cameraPan 4.2s cubic-bezier(0.45,0,0.55,1) infinite',
        'rec-blink': 'recBlink 1.1s steps(1,end) infinite',
        'view-cone': 'viewCone 4.2s cubic-bezier(0.45,0,0.55,1) infinite',
        'needle-sweep': 'needleSweep 2.1s cubic-bezier(0.23,1,0.32,1) infinite',
        'stamp-down': 'stampDown 1.5s cubic-bezier(0.23,1,0.32,1) infinite',
        'file-pull': 'filePull 1.7s cubic-bezier(0.23,1,0.32,1) infinite',
        'rain-fall': 'rainFall 1.1s cubic-bezier(0.55,0,1,0.45) infinite',
        'list-advance': 'listAdvance 1.5s cubic-bezier(0.45,0,0.55,1) infinite',
        'arrow-hit': 'arrowHit 1.8s cubic-bezier(0.23,1,0.32,1) infinite',
      },
    },
  },
  // Custom shadow / canvas utilities must be generated even when they only
  // appear inside @apply, or PostCSS reports them as missing and the app
  // paints a blank page.
  safelist: ['bg-canvas', 'shadow-elev', 'shadow-elev-sm', 'shadow-elev-lg', 'shadow-elev-brand'],
  plugins: [],
}
