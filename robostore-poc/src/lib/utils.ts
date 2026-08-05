// Small, dependency-free helpers used across pages. Kept intentionally
// minimal - this is not a general-purpose utility library, just the few
// things more than one page needs.

/** Strips ASCII control characters (0x00 through 0x1F, plus DEL at 0x7F)
 * from free-text fields (names, reasons, descriptions) before they round-trip
 * through IndexedDB and back onto the page. Built from character codes
 * rather than a \xNN-escape regex literal, deliberately, so no tool in the
 * write path can mangle a hex-escape sequence into a raw control byte in
 * this source file. Not a security boundary by itself - React already
 * escapes everything it renders - just cheap hygiene against stray bytes. */
export function sanitizeInput(value: string): string {
  let result = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControlChar = code < 0x20 || code === 0x7f;
    if (!isControlChar) {
      result += ch;
    }
  }
  return result.trim();
}

/** Escapes the handful of characters that matter if a string is ever placed
 * into raw HTML (e.g. a toast rendered via dangerouslySetInnerHTML - none
 * currently are, this exists so that stays true on purpose, not by luck). */
export function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The login page's own footer copy sets expectations: "any email + 6-digit
 * password" - this just enforces that shape, nothing more. */
export function isValidDemoPassword(value: string): boolean {
  return /^\d{6,}$/.test(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
