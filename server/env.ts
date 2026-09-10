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

  // When the frontend is served from a different site than the API (e.g. localhost
  // frontend → ngrok/HTTPS backend), the session cookie must be SameSite=None; Secure
  // for the browser to store and send it. Requires HTTPS on both ends.
  crossSiteCookies: process.env.CROSS_SITE_COOKIES === 'true',

  // Browser origins allowed to call the API with credentials (comma-separated).
  // When empty in development, any localhost/127.0.0.1 origin is allowed.
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),

  // Single-tenant lock: when set, this org is auto-created and every user joins it.
  lockedOrg: (process.env.VITE_ORG ?? process.env.LOCKED_ORG ?? '').trim(),

  // Key used to encrypt managed-database connection passwords at rest (32+ chars).
  secretKey: process.env.APP_SECRET_KEY ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',

  // AWS DMS reload for the MySQL -> Redshift replica. Unset taskArn = feature off.
  // Credentials come from the standard AWS provider chain, never Checkpoint's store.
  dms: {
    // Full task ARN; its region is parsed out of the ARN itself.
    taskArn: (process.env.DMS_TASK_ARN ?? '').trim(),
    // Checkpoint does not run on EC2, so there is no instance role to fall back on
    // and these are the only credentials available. Passed to the SDK explicitly:
    // left to the default chain it would try the instance metadata endpoint and fail
    // with a timeout that says nothing about the real problem.
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID ?? '').trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY ?? '').trim(),
    // MySQL schema the task replicates. A migration triggers a reload only when its
    // write connection points at this schema, so other databases are untouched.
    sourceSchema: (process.env.DMS_SOURCE_SCHEMA ?? '').trim(),
    // On by default: a migration that breaks the replica should heal itself. A
    // reload re-runs the full load, and the task's TargetTablePrepMode decides
    // whether the Redshift table is emptied or dropped for that window — set false
    // if that is not acceptable and reload by hand instead.
    autoReload: process.env.DMS_AUTO_RELOAD !== 'false',
    // Channel for reload notifications; falls back to the org's Slack channel.
    slackChannel: (process.env.DMS_SLACK_CHANNEL ?? '').trim(),
    // Poll DMS for tables that fell out of the replica. On by default once a task
    // ARN is set, because the migration hook alone cannot tell whether its reload
    // actually worked — a table needing a drop looks identical to one that healed.
    // The poll is what closes that loop, and it also catches drift from a manual
    // ALTER or another tool.
    watchEnabled: process.env.DMS_WATCH_ENABLED !== 'false',
    // How long an attempt is given to take effect before the table is judged still
    // broken. A full load of a large table is not quick.
    retryGraceMinutes: Number.isFinite(Number(process.env.DMS_RETRY_GRACE_MINUTES))
      ? Number(process.env.DMS_RETRY_GRACE_MINUTES)
      : 30,
    // Dropping a warehouse table is destructive and opt-in. Nothing is lost while it
    // is a pure replica of MySQL, but that is a fact about this deployment, not a
    // property of the code, so it stays off until someone turns it on.
    allowDrop: process.env.DMS_ALLOW_DROP === 'true',
  },

  // Redshift target connection, used only to drop a table whose schema has drifted
  // so the next DMS reload recreates it. Configured here rather than as a managed
  // database in Checkpoint: nothing else needs it, and the recovery runs on a cron
  // with no user session behind it. Host empty = no drop, describe it in Slack.
  redshift: {
    host: (process.env.REDSHIFT_HOST ?? '').trim(),
    port: Number(process.env.REDSHIFT_PORT ?? 5439),
    database: (process.env.REDSHIFT_DATABASE ?? '').trim(),
    username: (process.env.REDSHIFT_USER ?? '').trim(),
    password: process.env.REDSHIFT_PASSWORD ?? '',
    // Redshift refuses plaintext on most clusters, so this defaults on.
    ssl: process.env.REDSHIFT_SSL !== 'false',
  },

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
