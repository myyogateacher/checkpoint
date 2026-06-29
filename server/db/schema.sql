-- Checkpoint metadata store (MySQL 8). Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40) PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255),
  picture       TEXT,
  role          ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  is_banned     TINYINT(1) NOT NULL DEFAULT 0,
  -- Argon2id hash for email/password auth; NULL for Google-only / unclaimed accounts.
  password_hash TEXT NULL,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-use, time-limited tokens for the forgot-password flow. We store only a
-- SHA-256 of the token so a metadata-store leak can't be used to reset passwords.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id    VARCHAR(40) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id         VARCHAR(64) PRIMARY KEY,
  user_id    VARCHAR(40) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS organizations (
  id         VARCHAR(40) PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS memberships (
  org_id  VARCHAR(40) NOT NULL,
  user_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(40) PRIMARY KEY,
  org_id      VARCHAR(40) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  tags        JSON,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (org_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS environments (
  id         VARCHAR(40) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  color      VARCHAR(32) NOT NULL DEFAULT 'emerald',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `databases` (
  id             VARCHAR(40) PRIMARY KEY,
  project_id     VARCHAR(40) NOT NULL,
  environment_id VARCHAR(40) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  engine         VARCHAR(40) NOT NULL,
  tags           JSON,
  last_synced_at DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (project_id),
  INDEX (environment_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS connections (
  id           VARCHAR(40) PRIMARY KEY,
  database_id  VARCHAR(40) NOT NULL,
  mode         ENUM('read','write') NOT NULL,
  host         VARCHAR(255) NOT NULL,
  port         INT NOT NULL,
  username     VARCHAR(255) NOT NULL,
  db_name      VARCHAR(255) NOT NULL,
  ssl          TINYINT(1) NOT NULL DEFAULT 1,
  password_enc TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (database_id, mode),
  FOREIGN KEY (database_id) REFERENCES `databases`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schema_snapshots (
  database_id VARCHAR(40) PRIMARY KEY,
  synced_at   DATETIME NOT NULL,
  payload     JSON NOT NULL,
  FOREIGN KEY (database_id) REFERENCES `databases`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migrations (
  id           VARCHAR(40) PRIMARY KEY,
  database_id  VARCHAR(40) NOT NULL,
  title        VARCHAR(500) NOT NULL,
  description  TEXT,
  status       VARCHAR(32) NOT NULL DEFAULT 'draft',
  author_email VARCHAR(255) NOT NULL,
  approved_by  VARCHAR(255) NULL,
  approved_at  DATETIME NULL,
  applied_at   DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (database_id),
  FOREIGN KEY (database_id) REFERENCES `databases`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migration_queries (
  id           VARCHAR(40) PRIMARY KEY,
  migration_id VARCHAR(40) NOT NULL,
  ord          INT NOT NULL,
  sql_text     MEDIUMTEXT NOT NULL,
  INDEX (migration_id),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migration_reviewers (
  migration_id   VARCHAR(40) NOT NULL,
  reviewer_email VARCHAR(255) NOT NULL,
  PRIMARY KEY (migration_id, reviewer_email),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migration_comments (
  id           VARCHAR(40) PRIMARY KEY,
  migration_id VARCHAR(40) NOT NULL,
  author_email VARCHAR(255) NOT NULL,
  author_name  VARCHAR(255),
  body         TEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (migration_id),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migration_events (
  id           VARCHAR(40) PRIMARY KEY,
  migration_id VARCHAR(40) NOT NULL,
  at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_email  VARCHAR(255) NOT NULL,
  action       VARCHAR(40) NOT NULL,
  note         TEXT NULL,
  INDEX (migration_id),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saved_queries (
  id           VARCHAR(40) PRIMARY KEY,
  org_id       VARCHAR(40) NOT NULL,
  database_id  VARCHAR(40) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  tags         JSON,
  sql_text     MEDIUMTEXT NOT NULL,
  shared       TINYINT(1) NOT NULL DEFAULT 0,
  author_email VARCHAR(255) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_settings (
  project_id        VARCHAR(40) PRIMARY KEY,
  approvers         JSON NOT NULL,
  releasers         JSON NOT NULL,
  required_approvals INT NOT NULL DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_settings (
  org_id VARCHAR(40) PRIMARY KEY,
  email  JSON NOT NULL,
  slack  JSON NOT NULL,
  query  JSON NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS validation_rules (
  org_id   VARCHAR(40) NOT NULL,
  engine   VARCHAR(40) NOT NULL,
  sections JSON NOT NULL,
  PRIMARY KEY (org_id, engine),
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           VARCHAR(40) PRIMARY KEY,
  org_id       VARCHAR(40) NULL,
  actor_email  VARCHAR(255) NOT NULL,
  actor_name   VARCHAR(255),
  action       VARCHAR(64) NOT NULL,
  entity_type  VARCHAR(64) NOT NULL,
  entity_id    VARCHAR(64) NULL,
  entity_label VARCHAR(255) NOT NULL,
  summary      TEXT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (org_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
