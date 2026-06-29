// ---------------------------------------------------------------------------
// API client. Every method talks to the Bun backend over fetch with the
// session cookie (credentials: 'include'). The matching routes live under
// server/modules/*.
// ---------------------------------------------------------------------------

import type {
  AppSettings,
  AuditLogEntry,
  Connection,
  Database,
  DatabaseInput,
  Environment,
  ManagedUser,
  Migration,
  Organization,
  Project,
  ProjectSettings,
  QueryResult,
  SavedQuery,
  SchemaSnapshot,
  SessionState,
  UserRole,
} from '../types'
import type { ValidationSection } from '../lib/validationRules'
import type { DatabaseEngine } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

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

export const api = {
  // --- Auth -----------------------------------------------------------------
  getSession(): Promise<SessionState> {
    return request<SessionState>('/api/auth/me')
  },
  // The client obtains a Google ID token (credential) via Google Identity
  // Services and posts it here; the server verifies it and sets the session.
  googleSignIn(credential: string): Promise<SessionState> {
    return request<SessionState>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    })
  },
  signup(input: { name: string; email: string; password: string }): Promise<SessionState> {
    return request<SessionState>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) })
  },
  passwordSignIn(email: string, password: string): Promise<SessionState> {
    return request<SessionState>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  },
  requestPasswordReset(email: string): Promise<{ ok: true }> {
    return request<{ ok: true }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
  },
  resetPassword(token: string, password: string): Promise<SessionState> {
    return request<SessionState>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
  },
  logout(): Promise<null> {
    return request<null>('/api/auth/logout', { method: 'POST' })
  },

  // --- Organizations --------------------------------------------------------
  getOrganizations(): Promise<Organization[]> {
    return request<Organization[]>('/api/organizations')
  },
  createOrganization(name: string): Promise<Organization> {
    return request<Organization>('/api/organizations', { method: 'POST', body: JSON.stringify({ name }) })
  },

  // --- Projects / environments / databases ----------------------------------
  getProjects(orgId?: string): Promise<Project[]> {
    return request<Project[]>(`/api/projects${orgId ? `?org=${orgId}` : ''}`)
  },
  createProject(input: { org_id: string; name: string; description: string | null; tags: string[] }): Promise<Project> {
    return request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) })
  },
  getProject(projectId: string): Promise<Project | undefined> {
    return request<Project>(`/api/projects/${projectId}`)
  },
  getProjectSettings(projectId: string): Promise<ProjectSettings> {
    return request<ProjectSettings>(`/api/projects/${projectId}/settings`)
  },
  saveProjectSettings(projectId: string, next: ProjectSettings): Promise<ProjectSettings> {
    return request<ProjectSettings>(`/api/projects/${projectId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(next),
    })
  },
  getEnvironments(projectId: string): Promise<Environment[]> {
    return request<Environment[]>(`/api/projects/${projectId}/environments`)
  },
  getAllEnvironments(): Promise<Environment[]> {
    return request<Environment[]>('/api/environments')
  },
  createEnvironment(projectId: string, input: { name: string; color?: string }): Promise<Environment> {
    return request<Environment>(`/api/projects/${projectId}/environments`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  getDatabases(projectId?: string, orgId?: string): Promise<Database[]> {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    if (orgId) params.set('org', orgId)
    const qs = params.toString()
    return request<Database[]>(`/api/databases${qs ? `?${qs}` : ''}`)
  },
  createDatabase(input: DatabaseInput): Promise<Database> {
    return request<Database>('/api/databases', { method: 'POST', body: JSON.stringify(input) })
  },
  getDatabase(databaseId: string): Promise<Database | undefined> {
    return request<Database>(`/api/databases/${databaseId}`)
  },
  updateConnection(databaseId: string, conn: Connection): Promise<Connection> {
    return request<Connection>(`/api/databases/${databaseId}/connections/${conn.mode}`, {
      method: 'PUT',
      body: JSON.stringify(conn),
    })
  },

  // --- Schema ---------------------------------------------------------------
  getSchema(databaseId: string): Promise<SchemaSnapshot | undefined> {
    return request<SchemaSnapshot>(`/api/databases/${databaseId}/schema`)
  },
  syncSchema(databaseId: string): Promise<SchemaSnapshot | undefined> {
    return request<SchemaSnapshot>(`/api/databases/${databaseId}/schema/sync`, { method: 'POST' })
  },

  // --- Read panel -----------------------------------------------------------
  runReadQuery(databaseId: string, sql: string, timeoutSeconds?: number): Promise<QueryResult> {
    return request<QueryResult>(`/api/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql, timeout_seconds: timeoutSeconds }),
    })
  },

  // --- Saved queries --------------------------------------------------------
  getSavedQueries(): Promise<SavedQuery[]> {
    return request<SavedQuery[]>('/api/saved-queries')
  },
  getSavedQuery(id: string): Promise<SavedQuery | undefined> {
    return request<SavedQuery>(`/api/saved-queries/${id}`)
  },
  createSavedQuery(input: {
    database_id: string
    name: string
    description: string | null
    tags: string[]
    sql: string
    shared: boolean
  }): Promise<SavedQuery> {
    return request<SavedQuery>('/api/saved-queries', { method: 'POST', body: JSON.stringify(input) })
  },

  // --- Migrations -----------------------------------------------------------
  getMigrations(databaseId?: string, orgId?: string): Promise<Migration[]> {
    const params = new URLSearchParams()
    if (databaseId) params.set('database', databaseId)
    if (orgId) params.set('org', orgId)
    const qs = params.toString()
    return request<Migration[]>(`/api/migrations${qs ? `?${qs}` : ''}`)
  },
  getProjectMigrations(projectId: string): Promise<Migration[]> {
    return request<Migration[]>(`/api/projects/${projectId}/migrations`)
  },
  getMigration(id: string): Promise<Migration | undefined> {
    return request<Migration>(`/api/migrations/${id}`)
  },
  createMigration(input: {
    database_id: string
    title: string
    description: string | null
    queries: string[]
    submit: boolean
  }): Promise<Migration> {
    return request<Migration>('/api/migrations', { method: 'POST', body: JSON.stringify(input) })
  },
  transitionMigration(id: string, action: 'submit' | 'approve' | 'reject' | 'apply', note?: string): Promise<Migration> {
    return request<Migration>(`/api/migrations/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) })
  },
  setMigrationReviewers(id: string, reviewers: string[]): Promise<Migration> {
    return request<Migration>(`/api/migrations/${id}/reviewers`, { method: 'PUT', body: JSON.stringify({ reviewers }) })
  },
  addMigrationComment(id: string, body: string): Promise<Migration> {
    return request<Migration>(`/api/migrations/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  },

  // --- Validation rules -----------------------------------------------------
  getValidationRules(engine: DatabaseEngine): Promise<ValidationSection[]> {
    return request<ValidationSection[]>(`/api/validation-rules/${engine}`)
  },
  saveValidationRules(engine: DatabaseEngine, sections: ValidationSection[]): Promise<ValidationSection[]> {
    return request<ValidationSection[]>(`/api/validation-rules/${engine}`, {
      method: 'PUT',
      body: JSON.stringify(sections),
    })
  },

  // --- Settings -------------------------------------------------------------
  getSettings(): Promise<AppSettings> {
    return request<AppSettings>('/api/settings')
  },
  saveSettings(next: AppSettings): Promise<AppSettings> {
    return request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(next) })
  },

  // --- Users ----------------------------------------------------------------
  getUsers(): Promise<ManagedUser[]> {
    return request<ManagedUser[]>('/api/users')
  },
  inviteUser(email: string, role: UserRole): Promise<ManagedUser> {
    return request<ManagedUser>('/api/users', { method: 'POST', body: JSON.stringify({ email, role }) })
  },
  setUserRole(id: string, role: UserRole): Promise<ManagedUser> {
    return request<ManagedUser>(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
  },
  removeUser(id: string): Promise<null> {
    return request<null>(`/api/users/${id}`, { method: 'DELETE' })
  },

  // --- Audit ----------------------------------------------------------------
  getAuditLogs(): Promise<AuditLogEntry[]> {
    return request<AuditLogEntry[]>('/api/audit-logs')
  },
}
