// Forward-only, incremental schema migrations.
//
// The full baseline schema lives in docs/schema.sql and is applied once to a fresh
// database (recorded as BASELINE_VERSION in server_config). Every schema change
// *after* that baseline is a Migration appended to the list below: give it the next
// version number and the SQL to run.
//
// On boot, initDb() applies every migration whose version is greater than the one
// recorded in server_config, in ascending order, exactly once, then records the new
// version. So the DB is never re-checked statement-by-statement against a spec — it
// only runs what it hasn't run yet.
//
// Rules:
//   - Append only. Never edit or renumber a migration that may already have shipped.
//   - `version` must be ascending and contiguous, starting at BASELINE_VERSION + 1.
//   - Each `statements` entry is exactly one SQL statement; they run in array order.
//   - Prefer idempotent DDL (IF NOT EXISTS / IF EXISTS) where MySQL supports it.

// The version represented by docs/schema.sql. Bump only if you regenerate the
// baseline dump to fold in past migrations (a fresh install then starts higher).
export const BASELINE_VERSION = 1

export type Migration = {
  version: number
  name: string
  statements: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'project_env_settings',
    statements: [
      // Per-environment overrides of a project's migration governance. When a row
      // exists for (project, environment) it wins over project_settings.
      `CREATE TABLE IF NOT EXISTS project_env_settings (
         project_id          VARCHAR(40) NOT NULL,
         environment_id      VARCHAR(40) NOT NULL,
         approvers           JSON NOT NULL,
         releasers           JSON NOT NULL,
         required_approvals  INT NOT NULL DEFAULT 1,
         allow_self_approval TINYINT(1) NOT NULL DEFAULT 0,
         PRIMARY KEY (project_id, environment_id),
         FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
         FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
  {
    version: 3,
    name: 'migrations_slack_thread',
    statements: [
      // Slack thread anchor for a migration: the "submitted for approval" message's
      // ts + channel, so approve/apply/reviewer notifications reply in-thread and
      // react on the parent. Populated on the submit notification (PROD-7178).
      `ALTER TABLE migrations
         ADD COLUMN slack_message_ts VARCHAR(64) DEFAULT NULL,
         ADD COLUMN slack_channel_id VARCHAR(64) DEFAULT NULL`,
    ],
  },
]
