/**
 * Runtime configuration for the frontend.
 *
 * Production (nginx "prod" Docker target): fetches /config.json, which the
 * container's entrypoint generates at startup from API_BASE_URL via
 * envsubst - so the exact same built JS bundle works against any backend
 * address without a rebuild (see docs/02-docker-foundations.md).
 *
 * Local dev (Vite dev server "dev" Docker target): /config.json doesn't
 * exist, so this falls back to VITE_API_BASE_URL, which Vite exposes from
 * the container's environment.
 */
export interface RuntimeConfig {
  apiBaseUrl: string
}

const DEV_FALLBACK_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'

let cached: RuntimeConfig | null = null

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached

  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) {
      cached = (await res.json()) as RuntimeConfig
      return cached
    }
  } catch {
    // /config.json isn't served in dev mode - fall through below.
  }

  cached = { apiBaseUrl: DEV_FALLBACK_API_BASE_URL }
  return cached
}
