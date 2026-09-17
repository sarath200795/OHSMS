/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WEHS brand — coral from the logo siren & heart, used as an accent
        // on an otherwise cool ops-dashboard palette. Not a material.
        brand: {
          50: '#fdf4f1',
          100: '#fbe5df',
          200: '#f6c8bd',
          300: '#efa392',
          400: '#e77a64',
          500: '#dd5a41',
          600: '#c74a33',
          700: '#a63c2a',
          800: '#873426',
          900: '#6f2f24',
        },
        // Cool slate ink. 400–900 are AA on canvas (#f4f6f8), the binding
        // (darker) page surface; on white every figure is ~0.4 higher:
        //   400 5.45   500 6.95   600 8.31   700 10.97   800 14.26   900 16.48
        //
        // 50–300 are surfaces, borders and placeholder tones, never body text.
        // If one of them ever becomes text, it needs this treatment first.
        //
        // The 400/500 stops used to fail AA on the old kraft canvas (2.12 and
        // 3.29). Axe found 43 offending nodes on portal home alone. These
        // numbers are the whole point of the ramp — a regression is silent.
        ink: {
          DEFAULT: '#0f172a',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#5b6573',
          500: '#4a5568',
          600: '#3d4a5c',
          700: '#2c3848',
          800: '#1b2533',
          900: '#0f172a',
          950: '#020617',
        },
        // Page canvas. Cards sit on this as white panels with a hairline.
        canvas: {
          DEFAULT: '#f4f6f8',
        },
        // Raised / inset surfaces. DEFAULT is a white card; 50–400 are the
        // muted fills, row washes and hairline-adjacent greys. There is no
        // recessed "pressed into paper" stop — muted fill + border is the well.
        surface: {
          DEFAULT: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
        },
        // Logo accent set (icons): teal hands, amber vest, steel first-aid kit.
        accent: {
          teal: '#0f766e',
          amber: '#d97706',
          steel: '#64748b',
          leaf: '#4d7c0f',
        },
        // LOTO was ported from a dark "steel + hazard-yellow" theme whose
        // Tailwind palette never landed in this config. The classes still
        // compiled (Tailwind does not error on unknown colours) and did
        // nothing, so titles, muted copy, table headers and lock-out buttons
        // all inherited body text — one weight, no hierarchy, no accent.
        //
        // These stops remap that vocabulary onto the cool ops scale rather
        // than restoring the dark theme: steel-50 was "almost white heading"
        // and is now the ink heading; steel-800 was "dark well" and is now a
        // muted surface wash. hazard is the amber vest from the logo.
        steel: {
          50: '#0f172a',
          100: '#1b2533',
          200: '#2c3848',
          300: '#3d4a5c',
          400: '#4a5568',
          500: '#5b6573',
          600: '#cbd5e1',
          700: '#cbd5e1',
          800: '#e2e8f0',
          900: '#f1f5f9',
          950: '#f4f6f8',
        },
        hazard: {
          DEFAULT: '#d97706',
          dark: '#b45309',
        },
        danger: {
          DEFAULT: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      // Emil Kowalski motion tokens — stronger-than-default custom curves.
      transitionTimingFunction: {
        emil: 'cubic-bezier(0.23, 1, 0.32, 1)', // ease-out: enter/exit, responsive
        'emil-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)', // on-screen movement (wizards)
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)', // drawers/sheets
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(199,74,51,0.16), 0 8px 20px -10px rgba(199,74,51,0.35)',
        card: '0 1px 2px rgba(15,23,42,0.05), 0 1px 3px rgba(15,23,42,0.04)',
        // One-direction elevation. No dual-direction neumorphic pair, no
        // inset "pressed into paper" well. Hairline borders do the rest.
        elev: '0 1px 2px rgba(15,23,42,0.05), 0 1px 3px rgba(15,23,42,0.04)',
        'elev-sm': '0 1px 2px rgba(15,23,42,0.06)',
        'elev-lg': '0 10px 15px -3px rgba(15,23,42,0.08), 0 4px 6px -4px rgba(15,23,42,0.04)',
        'elev-brand': '0 1px 2px rgba(199,74,51,0.12), 0 4px 12px -4px rgba(199,74,51,0.32)',
      },
      keyframes: {
        // Skeleton shimmer sweep.
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(221,90,65,0.5)' },
          '70%': { boxShadow: '0 0 0 14px rgba(221,90,65,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(221,90,65,0)' },
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
  safelist: [
    'bg-canvas',
    'shadow-elev',
    'shadow-elev-sm',
    'shadow-elev-lg',
    'shadow-elev-brand',
  ],
  plugins: [],
}
