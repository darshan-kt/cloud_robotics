/** @type {import('tailwindcss').Config} */
// A deliberately small token set — the same warm-dark family as the
// robostore console, but ~10 colours instead of a full design system.
// This is a teaching demo; the palette should be readable in one glance.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#100f0d",
        surface: "#181715",
        raised: "#1f1e1b",
        line: "#2b2925",
        ink: "#faf9f5",
        body: "#d4d0c8",
        muted: "#a09d96",
        faint: "#908d86",
        coral: "#cc785c",
        nominal: "#5db8a6",
        caution: "#e8a55a",
        fault: "#c64545",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
