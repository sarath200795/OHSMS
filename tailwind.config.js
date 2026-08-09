/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WEHS brand — warm coral/terracotta drawn from the logo's siren & heart.
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
        // Warm stone ink for text (kraft-paper companion).
        ink: {
          50: '#faf8f5',
          100: '#f2ede5',
          200: '#e5dccf',
          300: '#d1c3af',
          400: '#ab987f',
          500: '#8a7660',
          600: '#6e5c49',
          700: '#57493a',
          800: '#40352b',
          900: '#2c241d',
          950: '#1b1610',
        },
        // Kraft-paper "clay" surfaces: raised panels over a warm paper base.
        clay: {
          bg: '#eadfcd',
          surface: '#f8f1e4',
          50: '#faf4e9',
          100: '#f1e7d5',
          200: '#e5d6bd',
          300: '#d1ba98',
          400: '#b29470',
        },
        // Logo accent set (icons): teal hands, amber vest, steel first-aid kit.
        accent: {
          teal: '#7fc4bb',
          amber: '#e8a33d',
          steel: '#8ba7bd',
          leaf: '#8fbc74',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        clay: '1.5rem',
      },
      // Emil Kowalski motion tokens — stronger-than-default custom curves.
      transitionTimingFunction: {
        emil: 'cubic-bezier(0.23, 1, 0.32, 1)', // ease-out: enter/exit, responsive
        'emil-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)', // on-screen movement (wizards)
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)', // drawers/sheets
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(199,74,51,0.15), 0 10px 40px -10px rgba(199,74,51,0.38)',
        card: '0 1px 2px rgba(64,53,43,0.06), 0 12px 32px -12px rgba(64,53,43,0.18)',
        // Claymorphism, kraft-tinted: warm brown drop + paper-white highlight.
        clay: '6px 6px 14px rgba(178,148,112,0.42), -6px -6px 14px rgba(255,251,242,0.95)',
        'clay-sm': '3px 3px 8px rgba(178,148,112,0.38), -3px -3px 8px rgba(255,251,242,0.90)',
        // Lifted state — the shadow travels further and softens as a tile rises.
        'clay-lg': '9px 11px 22px rgba(178,148,112,0.46), -6px -6px 14px rgba(255,251,242,0.95)',
        'clay-inset': 'inset 4px 4px 8px rgba(178,148,112,0.42), inset -4px -4px 8px rgba(255,251,242,0.95)',
        'clay-pressed': 'inset 5px 5px 10px rgba(178,148,112,0.52), inset -4px -4px 8px rgba(255,251,242,0.85)',
        'clay-brand': '5px 5px 12px rgba(199,74,51,0.28), -5px -5px 12px rgba(255,251,242,0.80)',
      },
      keyframes: {
        // Skeleton shimmer sweep.
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
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
          '0%,100%': { transform: 'translateZ(18px) translate(-4px,6px) rotate(-30deg)', opacity: '0.35' },
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
          '0%,100%': { transform: 'translateZ(26px) translateY(-13px) rotate(-9deg)', opacity: '0.9' },
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
          '65%,100%': { transform: 'translateZ(28px) translate(1px,-1px) rotate(38deg)', opacity: '1' },
        },
        hatTip: {
          '0%,100%': { transform: 'translateZ(10px) rotate(-8deg)' },
          '35%': { transform: 'translateZ(16px) rotate(-30deg) translateY(-3px)' },
          '70%': { transform: 'translateZ(12px) rotate(-2deg)' },
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
        phoneRing: {
          '0%,100%': { transform: 'translateZ(12px) rotate(-6deg)' },
          '25%': { transform: 'translateZ(12px) rotate(10deg)' },
          '55%': { transform: 'translateZ(12px) rotate(-10deg)' },
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
        float: 'float 6s ease-in-out infinite',
        pulseRing: 'pulseRing 2s infinite',
        'fade-in-up': 'fadeInUp 300ms cubic-bezier(0.23,1,0.32,1) both',
        wobble3d: 'wobble3d 2.8s cubic-bezier(0.45,0,0.55,1) infinite',
        sheen: 'sheen 1.5s cubic-bezier(0.23,1,0.32,1) infinite',
        'hat-tip': 'hatTip 1.6s cubic-bezier(0.23,1,0.32,1) infinite',
        'bar-grow': 'barGrow 1.4s cubic-bezier(0.45,0,0.55,1) infinite',
        magnify: 'magnify 2s cubic-bezier(0.45,0,0.55,1) infinite',
        'lock-open': 'lockOpen 1.6s cubic-bezier(0.23,1,0.32,1) infinite',
        'phone-ring': 'phoneRing 0.9s cubic-bezier(0.36,0,0.66,1) infinite',
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
  plugins: [],
}
