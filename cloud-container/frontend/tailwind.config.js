/** Design tokens from DESIGN.md, expressed as the Tailwind theme so the
 * whole console composes from named tokens instead of raw palette
 * classes (the previous `bg-slate-900 / text-sky-400` spread had no
 * single source of truth, so nothing could be restyled centrally).
 *
 * Two deliberate adaptations of DESIGN.md, which documents a marketing
 * surface and lists the product surface as a known gap:
 *
 *  1. `instrument.*` is DESIGN.md's `surface-dark` family under the name
 *     of the job it does here. DESIGN.md reserves dark surfaces for
 *     "product chrome"; in this console that is precisely the live
 *     robot surfaces (camera, LiDAR, teleop pad). Chrome stays cream,
 *     instruments are dark, and the split is a rule, not a mood.
 *
 *  2. `metric-*` sizes are new. DESIGN.md's display sizes are serif with
 *     negative tracking tuned for Copernicus; live telemetry needs the
 *     same optical weight in tabular mono, which needs its own tokens.
 *
 * Section rhythm stays on the 24/32/48 tokens rather than DESIGN.md's
 * 96px band spacing, which is a landing-page cadence - an operator
 * reading six panels at once should not have to scroll past it.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#faf9f5',
        surface: { soft: '#f5f0e8', card: '#efe9de', strong: '#e8e0d2' },
        instrument: { DEFAULT: '#181715', elevated: '#252320', soft: '#1f1e1b' },
        hairline: { DEFAULT: '#e6dfd8', soft: '#ebe6df' },
        ink: '#141413',
        body: { DEFAULT: '#3d3d3a', strong: '#252523' },
        muted: { DEFAULT: '#6c6a64', soft: '#8e8b82' },
        coral: { DEFAULT: '#cc785c', active: '#a9583e', disabled: '#e6dfd8' },
        'on-coral': '#ffffff',
        'on-instrument': { DEFAULT: '#faf9f5', soft: '#a09d96' },
        teal: '#5db8a6',
        gold: '#e8a55a',
        success: '#5db872',
        warning: '#d4a017',
        error: '#c64545',
      },
      fontFamily: {
        // Copernicus and StyreneB are licensed; DESIGN.md names these
        // exact substitutes in its typography notes.
        display: ['"Cormorant Garamond"', '"EB Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-lg': ['48px', { lineHeight: '1.1', letterSpacing: '-1px' }],
        'display-md': ['36px', { lineHeight: '1.15', letterSpacing: '-0.5px' }],
        'display-sm': ['28px', { lineHeight: '1.2', letterSpacing: '-0.3px' }],
        'title-lg': ['22px', { lineHeight: '1.3' }],
        'title-md': ['18px', { lineHeight: '1.4' }],
        'title-sm': ['16px', { lineHeight: '1.4' }],
        'body-md': ['16px', { lineHeight: '1.55' }],
        'body-sm': ['14px', { lineHeight: '1.55' }],
        caption: ['13px', { lineHeight: '1.4' }],
        'caption-up': ['12px', { lineHeight: '1.4', letterSpacing: '1.5px' }],
        code: ['14px', { lineHeight: '1.6' }],
        button: ['14px', { lineHeight: '1' }],
        nav: ['14px', { lineHeight: '1.4' }],
        'metric-lg': ['34px', { lineHeight: '1.05', letterSpacing: '-1px' }],
        'metric-md': ['26px', { lineHeight: '1.1', letterSpacing: '-0.6px' }],
        'metric-sm': ['19px', { lineHeight: '1.2', letterSpacing: '-0.3px' }],
      },
      borderRadius: {
        // DESIGN.md's hierarchical radius, applied as one locked rule:
        // 8px controls, 12px panels, 16px the large stage containers.
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '9999px',
      },
      spacing: { section: '96px' },
      boxShadow: {
        // DESIGN.md: "color-block first, shadow rare" - one faint,
        // background-tinted lift, used only on hover of a real link.
        lift: '0 1px 3px rgba(20,20,19,0.08), 0 6px 20px -8px rgba(20,20,19,0.10)',
      },
      keyframes: {
        'fade-rise': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        breathe: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'fade-rise': 'fade-rise 260ms cubic-bezier(0.16,1,0.3,1) both',
        breathe: 'breathe 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
