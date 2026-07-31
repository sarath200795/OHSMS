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
      },
    },
  },
  plugins: [],
}
