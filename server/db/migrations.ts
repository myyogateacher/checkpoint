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
  {
    version: 4,
    name: 'deployer_role_and_deploy_gated',
    statements: [
      // Deployment migrations (PROD-7464): ship together with a code deploy and may
      // only be applied by an admin or the new deployer role.
      `ALTER TABLE users MODIFY COLUMN role ENUM('admin','editor','deployer','viewer') NOT NULL DEFAULT 'viewer'`,
      `ALTER TABLE migrations ADD COLUMN deploy_gated TINYINT(1) NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 5,
    name: 'api_tokens',
    statements: [
      // Personal access tokens (PROD-7495): hash-only storage, soft revoke via revoked_at.
      `CREATE TABLE IF NOT EXISTS api_tokens (
         id            VARCHAR(40)  NOT NULL PRIMARY KEY,
         user_id       VARCHAR(40)  NOT NULL,
         name          VARCHAR(100) NOT NULL,
         token_hash    CHAR(64)     NOT NULL,
         token_prefix  VARCHAR(16)  NOT NULL,
         scopes        JSON         NOT NULL,
         expires_at    DATETIME     DEFAULT NULL,
         last_used_at  DATETIME     DEFAULT NULL,
         revoked_at    DATETIME     DEFAULT NULL,
         created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_api_tokens_hash (token_hash),
         KEY idx_api_tokens_user (user_id),
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
  {
    version: 6,
    name: 'project_settings_self_approvers',
    statements: [
      // Self-approval is now a user list instead of a boolean: authors listed here
      // may approve their own migrations, with '*' meaning everyone. Nullable so an
      // env override can leave it NULL and inherit the project list via COALESCE.
      `ALTER TABLE project_settings ADD COLUMN self_approvers JSON DEFAULT NULL`,
      `ALTER TABLE project_env_settings ADD COLUMN self_approvers JSON DEFAULT NULL`,
    ],
  },
  {
    version: 7,
    name: 'project_settings_self_approvers_backfill',
    statements: [
      // Carry the old blanket flag over: on → the "everyone" sentinel, off → an
      // explicit empty list. Unconditional (no WHERE) because every existing row
      // held a real boolean, and leaving an env override NULL would make it
      // silently inherit the project list — re-enabling self-approval on an
      // environment where it was deliberately off. DML is split from the v6 DDL:
      // MySQL auto-commits DDL, so a failure here must not re-run those ALTERs.
      // allow_self_approval stays (append-only) but is no longer read.
      `UPDATE project_settings SET self_approvers = IF(allow_self_approval = 1, JSON_ARRAY('*'), JSON_ARRAY())`,
      `UPDATE project_env_settings SET self_approvers = IF(allow_self_approval = 1, JSON_ARRAY('*'), JSON_ARRAY())`,
    ],
  },
  {
    version: 8,
    name: 'dms_table_recovery',
    statements: [
      // Recovery history for the MySQL -> Redshift DMS replica. One row per table.
      // Persisted rather than kept in memory because the escalation decision is
      // historical: a table still in Table Error after we already reloaded it is a
      // schema mismatch, not a fresh failure, and a restart must not lose that.
      `CREATE TABLE IF NOT EXISTS dms_table_recovery (
         schema_name     VARCHAR(128) NOT NULL,
         table_name      VARCHAR(128) NOT NULL,
         attempts        INT          NOT NULL DEFAULT 0,
         last_strategy   VARCHAR(32)  DEFAULT NULL,
         last_attempt_at DATETIME     DEFAULT NULL,
         first_seen_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         resolved_at     DATETIME     DEFAULT NULL,
         PRIMARY KEY (schema_name, table_name)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ],
  },
]
