import type { Config } from "tailwindcss";

// Design tokens for ROBOSTORE's "mission control" theme. Dark-only — there is
// no light-mode toggle anywhere in this app, by design (see README.md).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a1b20",
        surface: "#102830",
        card: "#132e38",
        border: "#2b4d58",
        accent: "#00e5a0",
        info: "#38bdf8",
        warning: "#ffb020",
        danger: "#ff4d6a",
        text: "#e8ecf4",
        textMuted: "#8892a8",
        textDim: "#5a6580",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ['"DM Sans"', "sans-serif"],
      },
      animation: {
        "pulse-status": "pulse-status 2s ease-in-out infinite",
        "fade-up": "fade-up 0.6s ease-out both",
        "fade-in": "fade-in 0.6s ease-out both",
        "spin-slow": "spin 12s linear infinite",
        "pulse-gentle": "pulse-gentle 3s ease-in-out infinite",
      },
      keyframes: {
        "pulse-status": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.15)", opacity: "0.7" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pulse-gentle": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.08)", opacity: "0.9" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
