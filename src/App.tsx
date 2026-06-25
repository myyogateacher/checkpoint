import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastHost } from './lib/toast'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectLayout } from './pages/ProjectLayout'
import { ProjectDatabasesPage } from './pages/ProjectDatabasesPage'
import { ProjectMigrationsPage } from './pages/ProjectMigrationsPage'
import { DatabaseLayout } from './pages/DatabaseLayout'
import { SchemaPage } from './pages/SchemaPage'
import { QueryPage } from './pages/QueryPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { DatabaseMigrationsPage } from './pages/DatabaseMigrationsPage'
import { CreateMigrationPage } from './pages/CreateMigrationPage'
import { MigrationDetailPage } from './pages/MigrationDetailPage'
import { MigrationsListPage } from './pages/MigrationsListPage'
import { QueryStudioPage } from './pages/QueryStudioPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage'
import { AuditLogPage } from './pages/AuditLogPage'
import type { ReactNode } from 'react'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading Checkpoint…" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Layout>{children}</Layout>
}

function LoginGate() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (user) return <Navigate to="/" replace />
  return <LoginPage />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <ProjectsPage />
          </RequireAuth>
        }
      />
      {/* Project workspace with Databases / Migrations tabs */}
      <Route
        path="/projects/:projectId"
        element={
          <RequireAuth>
            <ProjectLayout />
          </RequireAuth>
        }
      >
        <Route index element={<ProjectDatabasesPage />} />
        <Route path="migrations" element={<ProjectMigrationsPage />} />
      </Route>
      <Route
        path="/projects/:projectId/migrations/new"
        element={
          <RequireAuth>
            <CreateMigrationPage />
          </RequireAuth>
        }
      />

      {/* Database workspace with nested tabs */}
      <Route
        path="/databases/:databaseId"
        element={
          <RequireAuth>
            <DatabaseLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="schema" replace />} />
        <Route path="schema" element={<SchemaPage />} />
        <Route path="query" element={<QueryPage />} />
        <Route path="migrations" element={<DatabaseMigrationsPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
      </Route>

      <Route
        path="/databases/:databaseId/migrations/new"
        element={
          <RequireAuth>
            <CreateMigrationPage />
          </RequireAuth>
        }
      />

      <Route
        path="/query"
        element={
          <RequireAuth>
            <QueryStudioPage />
          </RequireAuth>
        }
      />

      <Route
        path="/migrations"
        element={
          <RequireAuth>
            <MigrationsListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/migrations/new"
        element={
          <RequireAuth>
            <CreateMigrationPage />
          </RequireAuth>
        }
      />
      <Route
        path="/migrations/:migrationId"
        element={
          <RequireAuth>
            <MigrationDetailPage />
          </RequireAuth>
        }
      />

      <Route
        path="/users"
        element={
          <RequireAuth>
            <UsersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <AuditLogPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
        <ToastHost />
      </AuthProvider>
    </ThemeProvider>
  )
}
