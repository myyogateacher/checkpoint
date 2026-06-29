// Centralized, validated environment configuration for the backend.

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Session signing secret (cookie HMAC) — must be stable across restarts.
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',
  // Days a session stays valid.
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 14),

  // Google OAuth — the client obtains an ID token and posts it here for verification.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',

  // Email/password auth. Shares the client's VITE_ENABLE_PASSWORD_AUTH flag so the
  // UI and API agree; defaults to enabled unless explicitly set to 'false'.
  passwordAuthEnabled: process.env.VITE_ENABLE_PASSWORD_AUTH !== 'false',

  // Public origin used to build password-reset links (e.g. https://checkpoint.example.com).
  // Falls back to the request origin when unset.
  appBaseUrl: (process.env.APP_BASE_URL ?? '').replace(/\/$/, ''),

  // Single-tenant lock: when set, this org is auto-created and every user joins it.
  lockedOrg: (process.env.VITE_ORG ?? process.env.LOCKED_ORG ?? '').trim(),

  // Key used to encrypt managed-database connection passwords at rest (32+ chars).
  secretKey: process.env.APP_SECRET_KEY ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',

  // MySQL metadata store (the app's own database).
  db: {
    url: process.env.APP_DATABASE_URL ?? '',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'checkpoint',
    password: process.env.DB_PASSWORD ?? 'checkpoint',
    database: process.env.DB_NAME ?? 'checkpoint',
  },
}

export const ORG_LOCKED = env.lockedOrg.length > 0

// Resolve MySQL connection settings, preferring APP_DATABASE_URL when present.
export function resolveDbConfig() {
  if (env.db.url) {
    const u = new URL(env.db.url)
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    }
  }
  return { host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, database: env.db.database }
}

export { required }
