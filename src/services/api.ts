// ---------------------------------------------------------------------------
// Stubbed API client. Every method returns a Promise so swapping in the real
// backend (Bun) is a drop-in change: flip USE_MOCKS to false and implement the
// matching routes. Mock branches mutate in-memory seed data so the UI behaves
// like a live app during development.
// ---------------------------------------------------------------------------

import type {
  AppSettings,
  AuditLogEntry,
  Connection,
  ConnectionInput,
  Database,
  DatabaseInput,
  Environment,
  ManagedUser,
  Migration,
  MigrationStatus,
  Project,
  QueryResult,
  SchemaSnapshot,
  SessionState,
  UserRole,
} from '../types'
import * as seed from './mockData'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const USE_MOCKS = true

// Simulate network latency so loading states are exercised.
function delay<T>(value: T, ms = 280): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  if (response.status === 204) return null as T
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || `Request failed (${response.status})`)
  }
  return payload as T
}

// --- The Google sign-in entry point is a real redirect even with mocks off ---
export function googleLoginUrl(returnTo = '/'): string {
  return `${API_BASE}/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`
}

const STORAGE_KEY = 'checkpoint.mockSession'

export const api = {
  // --- Auth -----------------------------------------------------------------
  getSession(): Promise<SessionState> {
    if (!USE_MOCKS) return request<SessionState>('/api/auth/me')
    const signedIn = localStorage.getItem(STORAGE_KEY) === '1'
    return delay({ authenticated: signedIn, user: signedIn ? clone(seed.currentUser) : null }, 200)
  },
  // Stub for the mock flow only; production uses googleLoginUrl() redirect.
  mockSignIn(): Promise<SessionState> {
    localStorage.setItem(STORAGE_KEY, '1')
    return delay({ authenticated: true, user: clone(seed.currentUser) }, 200)
  },
  logout(): Promise<null> {
    if (!USE_MOCKS) return request<null>('/api/auth/logout', { method: 'POST' })
    localStorage.removeItem(STORAGE_KEY)
    return delay(null, 150)
  },

  // --- Projects / environments / databases ----------------------------------
  getProjects(): Promise<Project[]> {
    if (!USE_MOCKS) return request<Project[]>('/api/projects')
    return delay(clone(seed.projects))
  },
  getProject(projectId: string): Promise<Project | undefined> {
    if (!USE_MOCKS) return request<Project>(`/api/projects/${projectId}`)
    return delay(clone(seed.projects.find((p) => p.id === projectId)))
  },
  getEnvironments(projectId: string): Promise<Environment[]> {
    if (!USE_MOCKS) return request<Environment[]>(`/api/projects/${projectId}/environments`)
    return delay(clone(seed.environments.filter((e) => e.project_id === projectId)))
  },
  getAllEnvironments(): Promise<Environment[]> {
    if (!USE_MOCKS) return request<Environment[]>('/api/environments')
    return delay(clone(seed.environments))
  },
  getDatabases(projectId?: string): Promise<Database[]> {
    if (!USE_MOCKS) return request<Database[]>(`/api/databases${projectId ? `?project=${projectId}` : ''}`)
    const all = projectId ? seed.databases.filter((d) => d.project_id === projectId) : seed.databases
    return delay(clone(all))
  },
  createDatabase(input: DatabaseInput): Promise<Database> {
    if (!USE_MOCKS) return request<Database>('/api/databases', { method: 'POST', body: JSON.stringify(input) })
    const id = `db_${Math.floor(performance.now())}`
    const mkConn = (mode: 'read' | 'write', c: ConnectionInput): Connection => ({
      id: `c_${mode}_${id}`,
      mode,
      host: c.host,
      port: c.port,
      username: c.username,
      database: c.database,
      ssl: c.ssl,
      has_password: c.password.length > 0,
    })
    const database: Database = {
      id,
      project_id: input.project_id,
      environment_id: input.environment_id,
      name: input.name,
      engine: input.engine,
      tags: input.tags,
      read_connection: mkConn('read', input.read),
      write_connection: mkConn('write', input.write),
      last_synced_at: null,
      table_count: 0,
    }
    seed.databases.push(database)
    const env = seed.environments.find((e) => e.id === input.environment_id)
    if (env) env.database_count += 1
    const project = seed.projects.find((p) => p.id === input.project_id)
    if (project) project.database_count += 1
    return delay(clone(database))
  },
  getDatabase(databaseId: string): Promise<Database | undefined> {
    if (!USE_MOCKS) return request<Database>(`/api/databases/${databaseId}`)
    return delay(clone(seed.databases.find((d) => d.id === databaseId)))
  },
  updateConnection(databaseId: string, conn: Connection): Promise<Connection> {
    if (!USE_MOCKS) {
      return request<Connection>(`/api/databases/${databaseId}/connections/${conn.mode}`, {
        method: 'PUT',
        body: JSON.stringify(conn),
      })
    }
    const db = seed.databases.find((d) => d.id === databaseId)
    if (db) {
      if (conn.mode === 'read') db.read_connection = clone(conn)
      else db.write_connection = clone(conn)
    }
    return delay(clone(conn))
  },

  // --- Schema ---------------------------------------------------------------
  getSchema(databaseId: string): Promise<SchemaSnapshot | undefined> {
    if (!USE_MOCKS) return request<SchemaSnapshot>(`/api/databases/${databaseId}/schema`)
    return delay(clone(seed.schemas[databaseId]), 360)
  },
  syncSchema(databaseId: string): Promise<SchemaSnapshot | undefined> {
    if (!USE_MOCKS) return request<SchemaSnapshot>(`/api/databases/${databaseId}/schema/sync`, { method: 'POST' })
    const db = seed.databases.find((d) => d.id === databaseId)
    const now = new Date().toISOString()
    if (db) db.last_synced_at = now
    const snap = seed.schemas[databaseId]
    if (snap) snap.synced_at = now
    return delay(clone(snap), 800)
  },

  // --- Read panel -----------------------------------------------------------
  runReadQuery(databaseId: string, sql: string): Promise<QueryResult> {
    if (!USE_MOCKS) {
      return request<QueryResult>(`/api/databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql }),
      })
    }
    const trimmed = sql.trim().toLowerCase()
    if (!(trimmed.startsWith('select') || trimmed.startsWith('show') || trimmed.startsWith('with') || trimmed.startsWith('explain'))) {
      return Promise.reject(new Error('Only read-only queries (SELECT / SHOW / WITH / EXPLAIN) are allowed on the read panel.'))
    }
    const snap = seed.schemas[databaseId]
    const table = snap?.tables[0]
    const columns = table ? table.columns.map((c) => c.name) : ['id', 'value']
    const rows = Array.from({ length: 8 }, (_, i) => {
      const row: Record<string, unknown> = {}
      for (const c of columns) {
        if (c === 'id' || c.endsWith('_id')) row[c] = 1000 + i
        else if (c.includes('email')) row[c] = `user${i}@example.com`
        else if (c.includes('at')) row[c] = '2026-06-25T09:0' + i + ':00Z'
        else if (c.includes('count')) row[c] = (i + 1) * 137
        else row[c] = `sample_${c}_${i}`
      }
      return row
    })
    return delay({ columns, rows, row_count: rows.length, duration_ms: 12 + Math.round(rows.length * 1.5) }, 420)
  },

  // --- Migrations -----------------------------------------------------------
  getMigrations(databaseId?: string): Promise<Migration[]> {
    if (!USE_MOCKS) return request<Migration[]>(`/api/migrations${databaseId ? `?database=${databaseId}` : ''}`)
    const all = databaseId ? seed.migrations.filter((m) => m.database_id === databaseId) : seed.migrations
    return delay(clone(all))
  },
  getProjectMigrations(projectId: string): Promise<Migration[]> {
    if (!USE_MOCKS) return request<Migration[]>(`/api/projects/${projectId}/migrations`)
    const dbIds = new Set(seed.databases.filter((d) => d.project_id === projectId).map((d) => d.id))
    return delay(clone(seed.migrations.filter((m) => dbIds.has(m.database_id))))
  },
  getMigration(id: string): Promise<Migration | undefined> {
    if (!USE_MOCKS) return request<Migration>(`/api/migrations/${id}`)
    return delay(clone(seed.migrations.find((m) => m.id === id)))
  },
  createMigration(input: {
    database_id: string
    title: string
    description: string | null
    queries: string[]
    submit: boolean
  }): Promise<Migration> {
    if (!USE_MOCKS) return request<Migration>('/api/migrations', { method: 'POST', body: JSON.stringify(input) })
    const db = seed.databases.find((d) => d.id === input.database_id)!
    const now = new Date().toISOString()
    const migration: Migration = {
      id: `m_${Math.floor(performance.now())}`,
      database_id: input.database_id,
      database_name: db?.name ?? 'unknown',
      engine: db?.engine ?? 'postgres',
      title: input.title,
      description: input.description,
      status: input.submit ? 'pending_approval' : 'draft',
      author_email: seed.currentUser.email,
      reviewers: [],
      queries: input.queries.map((sql, i) => ({ id: `q${i + 1}`, order: i + 1, sql })),
      comments: [],
      created_at: now,
      approved_by: null,
      approved_at: null,
      applied_at: null,
      events: [
        { at: now, actor_email: seed.currentUser.email, action: 'created', note: null },
        ...(input.submit ? [{ at: now, actor_email: seed.currentUser.email, action: 'submitted', note: null }] : []),
      ],
    }
    seed.migrations.unshift(migration)
    return delay(clone(migration))
  },
  transitionMigration(id: string, action: 'submit' | 'approve' | 'reject' | 'apply', note?: string): Promise<Migration> {
    if (!USE_MOCKS) {
      return request<Migration>(`/api/migrations/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) })
    }
    const m = seed.migrations.find((x) => x.id === id)!
    const now = new Date().toISOString()
    const nextStatus: Record<string, MigrationStatus> = {
      submit: 'pending_approval',
      approve: 'approved',
      reject: 'rejected',
      apply: 'applied',
    }
    m.status = nextStatus[action]
    if (action === 'approve') {
      m.approved_by = seed.currentUser.email
      m.approved_at = now
    }
    if (action === 'apply') m.applied_at = now
    m.events.push({ at: now, actor_email: seed.currentUser.email, action, note: note ?? null })
    return delay(clone(m))
  },
  setMigrationReviewers(id: string, reviewers: string[]): Promise<Migration> {
    if (!USE_MOCKS) {
      return request<Migration>(`/api/migrations/${id}/reviewers`, { method: 'PUT', body: JSON.stringify({ reviewers }) })
    }
    const m = seed.migrations.find((x) => x.id === id)!
    m.reviewers = [...reviewers]
    return delay(clone(m))
  },
  addMigrationComment(id: string, body: string): Promise<Migration> {
    if (!USE_MOCKS) {
      return request<Migration>(`/api/migrations/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
    }
    const m = seed.migrations.find((x) => x.id === id)!
    m.comments.push({
      id: `cm_${Math.floor(performance.now())}`,
      author_email: seed.currentUser.email,
      author_name: seed.currentUser.name,
      body,
      created_at: new Date().toISOString(),
    })
    return delay(clone(m))
  },

  // --- Settings -------------------------------------------------------------
  getSettings(): Promise<AppSettings> {
    if (!USE_MOCKS) return request<AppSettings>('/api/settings')
    return delay(clone(seed.settings))
  },
  saveSettings(next: AppSettings): Promise<AppSettings> {
    if (!USE_MOCKS) return request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(next) })
    seed.settings.email = { ...next.email }
    seed.settings.slack = { ...next.slack }
    return delay(clone(seed.settings))
  },

  // --- Users ----------------------------------------------------------------
  getUsers(): Promise<ManagedUser[]> {
    if (!USE_MOCKS) return request<ManagedUser[]>('/api/users')
    return delay(clone(seed.users))
  },
  inviteUser(email: string, role: UserRole): Promise<ManagedUser> {
    if (!USE_MOCKS) return request<ManagedUser>('/api/users', { method: 'POST', body: JSON.stringify({ email, role }) })
    const user: ManagedUser = {
      id: `u_${Math.floor(performance.now())}`,
      email,
      name: null,
      picture: null,
      role,
      last_login_at: null,
      is_self: false,
    }
    seed.users.push(user)
    return delay(clone(user))
  },
  setUserRole(id: string, role: UserRole): Promise<ManagedUser> {
    if (!USE_MOCKS) return request<ManagedUser>(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
    const u = seed.users.find((x) => x.id === id)!
    u.role = role
    return delay(clone(u))
  },
  removeUser(id: string): Promise<null> {
    if (!USE_MOCKS) return request<null>(`/api/users/${id}`, { method: 'DELETE' })
    const idx = seed.users.findIndex((x) => x.id === id)
    if (idx >= 0) seed.users.splice(idx, 1)
    return delay(null)
  },

  // --- Audit ----------------------------------------------------------------
  getAuditLogs(): Promise<AuditLogEntry[]> {
    if (!USE_MOCKS) return request<AuditLogEntry[]>('/api/audit-logs')
    return delay(clone(seed.auditLogs))
  },
}
