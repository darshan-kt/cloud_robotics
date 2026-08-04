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
  // TURN relay for the Robot page's WebRTC video (Milestone 9) - see
  // docker-compose.yml's coturn service and docs/09-frontend.md for why
  // this is required, not just a nice-to-have: Chrome hides its own local
  // ICE candidates behind mDNS by default, which this project's
  // GStreamer/libnice robot side can't resolve, so a real, unobfuscated
  // TURN relay candidate is what actually lets the connection complete.
  // turnUsername/turnCredential are the coturn long-term-credential pair -
  // same "one shared dev credential" shape as the operator login above,
  // not a secret worth hiding harder than that already isn't.
  turnUrl: string
  turnUsername: string
  turnCredential: string
}

const DEV_FALLBACK_CONFIG: RuntimeConfig = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000',
  turnUrl: (import.meta.env.VITE_TURN_URL as string | undefined) ?? 'turn:localhost:3478',
  turnUsername: (import.meta.env.VITE_TURN_USERNAME as string | undefined) ?? 'turnuser',
  turnCredential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) ?? 'turn_dev_password',
}

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

  cached = DEV_FALLBACK_CONFIG
  return cached
}
