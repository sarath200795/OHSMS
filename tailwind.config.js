/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WEHS kraft-glass kit, sourced from public/wehs.svg.
        //
        // Canvas is espresso kraft (ink #26211a, deepened). Glass is cream
        // paper (#f7f3ec) at low alpha over that canvas. Brand is the logo
        // teal (hands / mint), darkened at 600 so white text clears AA.
        // Amber is hi-vis, siren red is danger, leaf green is success,
        // slate is the first-aid kit. Magenta is no longer neon pink — it
        // aliases the kraft outline so existing `magenta-*` chips stay
        // secondary without bringing cyan/magenta back.
        //
        // brand-600 must carry white text at AA (skip-link, filled chips).
        // Bright teal lives at 400/500; 700+ is text on a brand-50 wash —
        // never `bg-*-700 text-white` (700 is a pastel).
        brand: {
          50: '#1a2e2c',
          100: '#21403c',
          200: '#2d5650',
          300: '#3d7a72',
          400: '#6db3aa',
          500: '#6db3aa',
          600: '#2f6d66',
          700: '#7fc4bb',
          800: '#b5ddd7',
          900: '#dcefee',
        },
        magenta: {
          400: '#c6946c',
          500: '#8a6844',
          600: '#6b4e32',
          700: '#e4bd97',
        },
        // Screen ink stays inverted: 50–300 are dark kraft washes and
        // hairlines, 400–900 are cream text. 400 is the AA floor on canvas
        // (#1f1a16) — 8.2:1. Do not use 50–300 as body text.
        //
        // bg-ink-800/900/950 used to mean "near-black fill". Those sites are
        // remapped to canvas / black overlays; do not reintroduce them as
        // dark fills against this ramp.
        ink: {
          DEFAULT: '#f7f3ec',
          50: '#261f19',
          100: '#332a22',
          200: '#4a3c30',
          300: '#6b5744',
          400: '#c4b09a',
          500: '#d4c4b0',
          600: '#e4d8c8',
          700: '#ebe3d8',
          800: '#f4f1ea',
          900: '#f7f3ec',
          950: '#faf3ea',
        },
        canvas: {
          DEFAULT: '#1f1a16',
        },
        // Opaque kraft panels used where glass cannot (menus, wells, map
        // bubbles). `.card` overlays cream frost on top of these.
        surface: {
          DEFAULT: '#2c241c',
          50: '#261f19',
          100: '#332a22',
          200: '#3f342a',
          300: '#524539',
          400: '#6b5744',
        },
        accent: {
          teal: '#6db3aa',
          amber: '#e8a33d',
          orange: '#f0a231',
          lime: '#8fbc74',
          steel: '#8ba7bd',
          leaf: '#8fbc74',
        },
        // LOTO steel + hazard. steel-50 is the cream heading on dark kraft.
        steel: {
          50: '#f7f3ec',
          100: '#f4f1ea',
          200: '#e4d8c8',
          300: '#d4c4b0',
          400: '#8ba7bd',
          500: '#8d99a5',
          600: '#6b5744',
          700: '#4a3c30',
          800: '#332a22',
          900: '#261f19',
          950: '#1f1a16',
        },
        hazard: {
          DEFAULT: '#e8a33d',
          dark: '#c77f18',
        },
        danger: {
          DEFAULT: '#e8877c',
        },
        // Tailwind's 50-tint palette is a light wash. On kraft those chips
        // flash cream-white, and 700-text on them fails AA. 50/100/200 are
        // dark washes; 700/800/900 are light text on those washes. 500/600
        // stay saturated fills. Do not put white text on a 700 fill — that
        // stop is a pastel.
        red: {
          50: '#3a1c18',
          100: '#4a2420',
          200: '#7c3a32',
          700: '#f0897d',
          800: '#f5b5ae',
          900: '#f8d4d0',
        },
        rose: {
          50: '#3a1c18',
          100: '#4a2420',
          200: '#7c3a32',
          700: '#e8877c',
          800: '#f0b0a8',
          900: '#f6d4ce',
        },
        orange: {
          50: '#3a2414',
          100: '#4a2e18',
          200: '#7c4a1e',
          700: '#f0a231',
          800: '#e8b93d',
          900: '#f6e3bb',
        },
        amber: {
          50: '#3a2e14',
          100: '#4a3b18',
          200: '#7c5c1e',
          700: '#e8a33d',
          800: '#e8b93d',
          900: '#f6e3bb',
        },
        yellow: {
          50: '#3a3214',
          100: '#4a4218',
          200: '#7c6a1e',
          700: '#e8b93d',
          800: '#f6e3bb',
          900: '#faf3ea',
        },
        lime: {
          50: '#24301c',
          100: '#2c3c22',
          200: '#4a6a32',
          700: '#8fbc74',
          800: '#b5d49e',
          900: '#dcecc8',
        },
        green: {
          50: '#24301c',
          100: '#2c3c22',
          200: '#3f6e32',
          700: '#8fbc74',
          800: '#b5d49e',
          900: '#dcecc8',
        },
        emerald: {
          50: '#1a2e2c',
          100: '#21403c',
          200: '#2d5650',
          700: '#6db3aa',
          800: '#7fc4bb',
          900: '#c5e6e0',
        },
        teal: {
          50: '#1a2e2c',
          100: '#21403c',
          200: '#2d5650',
          700: '#6db3aa',
          800: '#7fc4bb',
          900: '#c5e6e0',
        },
        cyan: {
          50: '#1a2e2c',
          100: '#21403c',
          200: '#2d5650',
          700: '#6db3aa',
          800: '#7fc4bb',
          900: '#c5e6e0',
        },
        sky: {
          50: '#1c2830',
          100: '#243440',
          200: '#3a5060',
          700: '#8ba7bd',
          800: '#b3c5d4',
          900: '#d6e2ea',
        },
        blue: {
          50: '#1c2830',
          100: '#243440',
          200: '#3a5060',
          700: '#8ba7bd',
          800: '#b3c5d4',
          900: '#d6e2ea',
        },
        indigo: {
          50: '#261f19',
          100: '#332a22',
          200: '#4a3c30',
          700: '#c4b09a',
          800: '#e4d8c8',
          900: '#f4f1ea',
        },
        violet: {
          50: '#2a221c',
          100: '#3a3028',
          200: '#524539',
          700: '#c4b09a',
          800: '#e4d8c8',
          900: '#f4f1ea',
        },
        purple: {
          50: '#2a221c',
          100: '#3a3028',
          200: '#524539',
          700: '#c4b09a',
          800: '#e4d8c8',
          900: '#f4f1ea',
        },
        fuchsia: {
          50: '#3a1c18',
          100: '#4a2420',
          200: '#7c3a32',
          700: '#e8877c',
          800: '#f0b0a8',
          900: '#f6d4ce',
        },
        pink: {
          50: '#3a1c18',
          100: '#4a2420',
          200: '#7c3a32',
          700: '#e8877c',
          800: '#f0b0a8',
          900: '#f6d4ce',
        },
        slate: { 50: '#261f19', 100: '#332a22', 200: '#3f342a' },
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
        // Soft kraft umbra + cream hairline. No neon halo, no clay dual-inset.
        glow: '0 1px 2px rgba(38,33,26,0.12), 0 10px 28px -8px rgba(38,33,26,0.38), 0 0 0 1px rgba(247,243,236,0.14)',
        card: '0 1px 2px rgba(38,33,26,0.08), 0 12px 32px rgba(38,33,26,0.28), 0 0 0 1px rgba(247,243,236,0.12)',
        elev: '0 1px 2px rgba(38,33,26,0.08), 0 10px 28px rgba(38,33,26,0.24), 0 0 0 1px rgba(247,243,236,0.12)',
        'elev-sm':
          '0 1px 1px rgba(38,33,26,0.06), 0 4px 14px rgba(38,33,26,0.16), 0 0 0 1px rgba(247,243,236,0.1)',
        'elev-lg':
          '0 2px 4px rgba(38,33,26,0.1), 0 18px 48px rgba(38,33,26,0.32), 0 0 0 1px rgba(247,243,236,0.14)',
        'elev-brand':
          '0 1px 2px rgba(47,109,102,0.2), 0 8px 24px rgba(47,109,102,0.22), 0 0 0 1px rgba(109,179,170,0.28)',
      },
      keyframes: {
        // Skeleton shimmer sweep.
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(109,179,170,0.45)' },
          '70%': { boxShadow: '0 0 0 14px rgba(109,179,170,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(109,179,170,0)' },
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
