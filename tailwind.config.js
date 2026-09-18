/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WEHS amber+white glass kit, sourced from public/wehs.svg.
        //
        // Canvas is the logo cream/amber wash (#f6e3bb). Glass is white frost
        // over that canvas. Brand is the logo teal (hands / mint), darkened
        // at 600 so white text clears AA. Amber is hi-vis, siren red is
        // danger, leaf green is success. Magenta aliases the kraft outline
        // so existing `magenta-*` chips stay secondary without cyan/magenta.
        //
        // brand-600 must carry white text at AA (skip-link, filled chips).
        // Bright teal lives at 400/500; 700+ is dark text on a brand-50
        // wash — never `bg-*-700 text-white`.
        brand: {
          50: '#e8f4f2',
          100: '#d0e8e4',
          200: '#b5ddd7',
          300: '#7fc4bb',
          400: '#6db3aa',
          500: '#3d7a72',
          600: '#2f6d66',
          700: '#246058',
          800: '#1a4a44',
          900: '#123632',
        },
        magenta: {
          400: '#c6946c',
          500: '#8a6844',
          600: '#6b4e32',
          700: '#4a3c30',
        },
        // Light-theme ink: 50–300 are cream washes and hairlines, 400–900
        // are body text. 400 is the AA floor on amber canvas and on frosted
        // glass over a dim overlay (axe measured a site-dialog hint at 4.2:1
        // when 400 was the lighter kraft stop). Do not use 50–300 as body text.
        ink: {
          DEFAULT: '#26211a',
          50: '#faf3ea',
          100: '#f4f1ea',
          200: '#e8dcc8',
          300: '#d2c4b4',
          400: '#615344',
          500: '#534637',
          600: '#4a3c30',
          700: '#332a22',
          800: '#261f19',
          900: '#1b1610',
          950: '#14110d',
        },
        canvas: {
          DEFAULT: '#f6e3bb',
        },
        // Opaque cream/white panels where glass cannot (menus, wells).
        // `.card` overlays white frost on top of these.
        surface: {
          DEFAULT: '#ffffff',
          50: '#faf3ea',
          100: '#f4f1ea',
          200: '#e8dcc8',
          300: '#d2c4b4',
          400: '#c6946c',
        },
        accent: {
          teal: '#6db3aa',
          amber: '#e8a33d',
          orange: '#f0a231',
          lime: '#8fbc74',
          steel: '#8ba7bd',
          leaf: '#8fbc74',
        },
        // LOTO steel + hazard. steel-50 is the dark heading on light glass.
        steel: {
          50: '#261f19',
          100: '#332a22',
          200: '#4a3c30',
          300: '#6b5744',
          400: '#8a6844',
          500: '#8d99a5',
          600: '#c6946c',
          700: '#d2c4b4',
          800: '#e8dcc8',
          900: '#f4f1ea',
          950: '#faf3ea',
        },
        hazard: {
          DEFAULT: '#e8a33d',
          dark: '#c77f18',
        },
        danger: {
          DEFAULT: '#c43d32',
        },
        // Tailwind's 50-tint palette is a light wash. 50/100/200 stay light
        // so chips on white glass are a tint, not a flash of cream-on-dark.
        // 700/800/900 are dark text on those washes. Do not put white text
        // on a 700 fill.
        red: {
          50: '#fdf2f0',
          100: '#f8ddd8',
          200: '#f0b0a8',
          700: '#c43d32',
          800: '#a8342a',
          900: '#7a241e',
        },
        rose: {
          50: '#fdf2f0',
          100: '#f8ddd8',
          200: '#f0b0a8',
          700: '#c43d32',
          800: '#a8342a',
          900: '#7a241e',
        },
        orange: {
          50: '#fdf6e8',
          100: '#f8edd0',
          200: '#f0d89a',
          700: '#92400e',
          800: '#7a4e10',
          900: '#6b430c',
        },
        amber: {
          50: '#fdf6e8',
          100: '#f8edd0',
          200: '#f0d89a',
          700: '#92400e',
          800: '#7a4e10',
          900: '#6b430c',
        },
        yellow: {
          50: '#fdf8e8',
          100: '#f6e3bb',
          200: '#e8b93d',
          700: '#92400e',
          800: '#7a4e10',
          900: '#6b430c',
        },
        lime: {
          50: '#eef6e8',
          100: '#dcecc8',
          200: '#b5d49e',
          700: '#3f6e32',
          800: '#2c5024',
          900: '#24301c',
        },
        green: {
          50: '#eef6e8',
          100: '#dcecc8',
          200: '#b5d49e',
          700: '#3f6e32',
          800: '#2c5024',
          900: '#24301c',
        },
        emerald: {
          50: '#e8f4f2',
          100: '#d0e8e4',
          200: '#b5ddd7',
          700: '#246058',
          800: '#1a4a44',
          900: '#123632',
        },
        teal: {
          50: '#e8f4f2',
          100: '#d0e8e4',
          200: '#b5ddd7',
          700: '#246058',
          800: '#1a4a44',
          900: '#123632',
        },
        cyan: {
          50: '#e8f4f2',
          100: '#d0e8e4',
          200: '#b5ddd7',
          700: '#246058',
          800: '#1a4a44',
          900: '#123632',
        },
        sky: {
          50: '#eef3f6',
          100: '#d6e2ea',
          200: '#b3c5d4',
          700: '#4a6578',
          800: '#3a5060',
          900: '#243440',
        },
        blue: {
          50: '#eef3f6',
          100: '#d6e2ea',
          200: '#b3c5d4',
          700: '#4a6578',
          800: '#3a5060',
          900: '#243440',
        },
        indigo: {
          50: '#f4f1ea',
          100: '#e8dcc8',
          200: '#d2c4b4',
          700: '#6b5744',
          800: '#4a3c30',
          900: '#332a22',
        },
        violet: {
          50: '#f4f1ea',
          100: '#e8dcc8',
          200: '#d2c4b4',
          700: '#6b5744',
          800: '#4a3c30',
          900: '#332a22',
        },
        purple: {
          50: '#f4f1ea',
          100: '#e8dcc8',
          200: '#d2c4b4',
          700: '#6b5744',
          800: '#4a3c30',
          900: '#332a22',
        },
        fuchsia: {
          50: '#fdf2f0',
          100: '#f8ddd8',
          200: '#f0b0a8',
          700: '#c43d32',
          800: '#a8342a',
          900: '#7a241e',
        },
        pink: {
          50: '#fdf2f0',
          100: '#f8ddd8',
          200: '#f0b0a8',
          700: '#c43d32',
          800: '#a8342a',
          900: '#7a241e',
        },
        slate: { 50: '#faf3ea', 100: '#f4f1ea', 200: '#e8dcc8' },
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
        // Soft ink umbra + white hairline. No neon halo, no clay dual-inset.
        glow: '0 1px 2px rgba(38,33,26,0.06), 0 10px 28px -8px rgba(38,33,26,0.14), 0 0 0 1px rgba(255,255,255,0.72)',
        card: '0 1px 2px rgba(38,33,26,0.05), 0 12px 32px rgba(38,33,26,0.10), 0 0 0 1px rgba(255,255,255,0.7)',
        elev: '0 1px 2px rgba(38,33,26,0.05), 0 12px 32px rgba(38,33,26,0.10), 0 0 0 1px rgba(255,255,255,0.7)',
        'elev-sm':
          '0 1px 1px rgba(38,33,26,0.04), 0 4px 14px rgba(38,33,26,0.08), 0 0 0 1px rgba(255,255,255,0.65)',
        'elev-lg':
          '0 2px 4px rgba(38,33,26,0.06), 0 18px 48px rgba(38,33,26,0.14), 0 0 0 1px rgba(255,255,255,0.75)',
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
