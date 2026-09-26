import type { Config } from "tailwindcss";

// ROBOSTORE design tokens — DESIGN.md's system, instantiated on its dark ramp.
//
// DESIGN.md specifies a warm-cream editorial system whose *dark* surface
// family (`surface-dark` #181715 → `surface-dark-elevated` #252320) is where
// it says product chrome lives — code editors, terminal output, status
// panels. A teleoperation console is product chrome, and it runs for hours
// in dim control rooms, so this app uses that dark family as its floor
// rather than the cream canvas. Every hex below is lifted from DESIGN.md
// verbatim; the three exceptions are marked EXTENDED and stay inside the
// same warm hue family so the ramp reads as one system.
//
// The one rule that matters most here: COLOR IS SEMANTIC, NEVER DECORATION.
//   coral   → brand + primary action, nothing else
//   nominal → teal, "this is live and healthy"
//   caution → amber, "degraded / stale / needs attention"
//   fault   → red, "stopped / failed / unsafe"
// An app tile does not get a colour because it would look nice with one. If
// every tile is a different hue, red has no impact budget left when the
// robot actually faults. See src/components/ui/Signal.tsx.

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ---- Colour ----------------------------------------------------
      // Every value resolves to a CSS variable defined in src/index.css, as
      // an "R G B" triplet wrapped in rgb(... / <alpha-value>). The wrapper
      // is what preserves Tailwind's opacity modifiers across a theme swap:
      // `bg-coral/10` still compiles, and picks up whichever theme is active.
      //
      // The token NAMES are the contract and do not change per theme. `coral`
      // means "the one accent this theme spends"; under [data-theme="blue"]
      // that happens to be azure. Pages never learn which.
      colors: {
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-soft": "rgb(var(--c-line-soft) / <alpha-value>)",

        ink: "rgb(var(--c-ink) / <alpha-value>)",
        body: "rgb(var(--c-body) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",

        coral: "rgb(var(--c-coral) / <alpha-value>)",
        "coral-active": "rgb(var(--c-coral-active) / <alpha-value>)",
        "on-coral": "rgb(var(--c-on-coral) / <alpha-value>)",

        nominal: "rgb(var(--c-nominal) / <alpha-value>)",
        caution: "rgb(var(--c-caution) / <alpha-value>)",
        warning: "rgb(var(--c-warning) / <alpha-value>)",
        fault: "rgb(var(--c-fault) / <alpha-value>)",
        "fault-bright": "rgb(var(--c-fault-bright) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
      },

      // DESIGN.md's type hierarchy table, as real tokens with line-height
      // and tracking baked in — so a page cannot invent a size.
      fontSize: {
        "display-xl": ["4rem", { lineHeight: "1.05", letterSpacing: "-1.5px", fontWeight: "400" }],
        "display-lg": ["3rem", { lineHeight: "1.1", letterSpacing: "-1px", fontWeight: "400" }],
        "display-md": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.5px", fontWeight: "400" }],
        "display-sm": ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.3px", fontWeight: "400" }],
        "title-lg": ["1.375rem", { lineHeight: "1.3", letterSpacing: "0", fontWeight: "500" }],
        "title-md": ["1.125rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        "title-sm": ["1rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        "body-md": ["1rem", { lineHeight: "1.55", letterSpacing: "0", fontWeight: "400" }],
        "body-sm": ["0.875rem", { lineHeight: "1.55", letterSpacing: "0", fontWeight: "400" }],
        caption: ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        label: ["0.6875rem", { lineHeight: "1.4", letterSpacing: "1px", fontWeight: "500" }], // DESIGN.md caption-uppercase, tracking eased for dark
        code: ["0.875rem", { lineHeight: "1.6", letterSpacing: "0", fontWeight: "400" }],
        button: ["0.875rem", { lineHeight: "1", letterSpacing: "0", fontWeight: "500" }],
        nav: ["0.875rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        // Numeric readouts — mono, tabular, sized for glanceability across a
        // control room rather than for reading up close.
        "readout-lg": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.5px", fontWeight: "500" }],
        "readout-md": ["1.375rem", { lineHeight: "1.2", letterSpacing: "-0.2px", fontWeight: "500" }],
        "readout-sm": ["1rem", { lineHeight: "1.3", letterSpacing: "0", fontWeight: "500" }],
      },

      fontFamily: {
        // DESIGN.md: Copernicus/Tiempos for display. Its own substitution
        // note names Cormorant Garamond as the closest open-source match.
        display: ['"Cormorant Garamond"', "Tiempos Headline", "Garamond", "Times New Roman", "serif"],
        // DESIGN.md: StyreneB, with Inter as the sanctioned substitute.
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },

      // DESIGN.md radius hierarchy
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px", // buttons + inputs
        lg: "12px", // content + product cards
        xl: "16px", // hero containers
        pill: "9999px",
      },

      // DESIGN.md 4px-base spacing scale, as named tokens alongside
      // Tailwind's numeric ones.
      spacing: {
        xxs: "4px",
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        xxl: "48px",
        section: "96px",
        rail: "72px", // persistent app-rail width — see AppShell
        bar: "56px", // command-bar height
      },

      // DESIGN.md: "color-block first, shadow rare".
      boxShadow: {
        hairline: "0 1px 3px rgb(var(--c-shadow) / var(--a-sh-soft))",
        raise:
          "inset 0 1px 0 0 rgb(var(--c-lit) / var(--a-lit)), 0 16px 32px -16px rgb(var(--c-shadow) / var(--a-sh-raise))",
        // Tinted with the theme's own shadow hue (warm on dark, warm-grey on
        // light, near-black on blue) so panels read as lit from above rather
        // than floating on a grey smudge.
        panel:
          "inset 0 1px 0 0 rgb(var(--c-lit) / var(--a-lit)), 0 1px 2px rgb(var(--c-shadow) / var(--a-sh-mid)), 0 12px 32px -18px rgb(var(--c-shadow) / var(--a-sh-deep))",
        alarm:
          "0 0 0 1px rgb(var(--c-fault) / 0.5), 0 0 40px -6px rgb(var(--c-fault-bright) / 0.45)",
        // Full-viewport frame shown on every route while the E-stop latches.
        "alarm-frame":
          "inset 0 0 0 3px rgb(var(--c-fault)), inset 0 0 120px -40px rgb(var(--c-fault-bright) / 0.8)",
      },

      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.35s ease-out both",
        // The only looping animations left in the system. Each one encodes
        // live state — nothing loops for decoration.
        breathe: "breathe 2.4s ease-in-out infinite", // "this value is streaming"
        alarm: "alarm 1.1s ease-in-out infinite", // "the robot is stopped"
        sweep: "sweep 4s linear infinite", // lidar radar sweep
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        breathe: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        alarm: {
          "0%, 100%": { opacity: "0.9" },
          "50%": { opacity: "0.4" },
        },
        sweep: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
