import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Theme preference.
//
// Four choices, three palettes: "auto" is a preference, not a theme — it
// resolves to light or dark from the OS and keeps following it, so a machine
// that dims at sunset takes the console with it.
//
// The resolved value lands on <html data-theme>, which is the only thing the
// CSS knows about (see src/index.css). Nothing in the component tree reads a
// colour directly, so a swap is a single attribute write and no re-render of
// anything that draws.
//
// The same read happens again in index.html, inline, before first paint — see
// the comment there. This hook is the second half of that: it owns changes,
// the inline script owns the initial value, and both agree on the key.
// ---------------------------------------------------------------------------

export type ThemePref = "auto" | "light" | "dark" | "blue";
export type ResolvedTheme = "light" | "dark" | "blue";

const STORAGE_KEY = "robostore_theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function readPref(): ThemePref {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "auto" || raw === "light" || raw === "dark" || raw === "blue") return raw;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return "auto";
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref !== "auto") return pref;
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  // Keeps the browser chrome (address bar on mobile, form controls) in step
  // with the page rather than leaving a light bar above a dark console.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const canvas = getComputedStyle(document.documentElement).getPropertyValue("--c-canvas").trim();
    if (canvas) meta.setAttribute("content", `rgb(${canvas})`);
  }
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPref()));

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* preference just won't survive a reload — not worth failing the click */
    }
    const r = resolve(next);
    setResolved(r);
    apply(r);
  }, []);

  // Only while on "auto": follow the OS if it changes under us.
  useEffect(() => {
    if (pref !== "auto") return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const onChange = () => {
      const r = resolve("auto");
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return { pref, resolved, setPref };
}
