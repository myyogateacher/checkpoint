// Which browser origins may talk to the API. Shared by the CORS layer and by the
// MCP endpoint's DNS-rebinding check, so both answer the same question the same way.

import { env } from '../env'

// Compare origins ignoring a trailing slash (some clients send "https://x/").
function normalize(origin: string): string {
  return origin.replace(/\/$/, '')
}

// Whether a concrete Origin header value is allowed. In production only the
// configured CORS_ORIGINS list is honored; in development any localhost origin is.
export function isAllowedOrigin(origin: string): boolean {
  const normalized = normalize(origin)
  if (env.corsOrigins.length > 0) return env.corsOrigins.includes(normalized)
  if (env.isProd) return false
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '127.0.0.1'
  } catch {
    return false
  }
}

// The Origin to echo in Access-Control-Allow-Origin, or null for no CORS headers.
// A request with no Origin header is not a cross-origin browser request at all.
export function resolveCorsOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  return isAllowedOrigin(origin) ? origin : null
}
