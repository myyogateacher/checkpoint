import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { OrgProvider, useOrg } from './context/OrgContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastHost } from './lib/toast'
import { CreateOrgPage } from './pages/CreateOrgPage'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { LandingPage } from './pages/LandingPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectLayout } from './pages/ProjectLayout'
import { ProjectDatabasesPage } from './pages/ProjectDatabasesPage'
import { ProjectMigrationsPage } from './pages/ProjectMigrationsPage'
import { ProjectSettingsPage } from './pages/ProjectSettingsPage'
import { DatabaseLayout } from './pages/DatabaseLayout'
import { SchemaPage } from './pages/SchemaPage'
import { QueryPage } from './pages/QueryPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { DatabaseMigrationsPage } from './pages/DatabaseMigrationsPage'
import { CreateMigrationPage } from './pages/CreateMigrationPage'
import { MigrationDetailPage } from './pages/MigrationDetailPage'
import { MigrationsListPage } from './pages/MigrationsListPage'
import { QueryStudioPage } from './pages/QueryStudioPage'
import { SavedQueriesPage } from './pages/SavedQueriesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ValidationRulesPage } from './pages/ValidationRulesPage'
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

// Authenticated + belongs to an org. Users with no org are sent to onboarding.
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const org = useOrg()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (org.loading) return <FullScreenLoader />
  if (org.orgs.length === 0) return <Navigate to="/create-org" replace />
  return <Layout>{children}</Layout>
}

// Public pages redirect to the app once authenticated.
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

// Create-org screen: used both for first-time onboarding (no org) and for
// creating an additional org. Blocked only when signed out or in locked mode.
function CreateOrgGate() {
  const { user, loading } = useAuth()
  const org = useOrg()
  if (loading || org.loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  if (org.locked) return <Navigate to="/" replace />
  return <CreateOrgPage />
}

// Root: marketing landing page when signed out, the app (/projects) when in.
function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!user) return <LandingPage />
  return <Navigate to="/projects" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/create-org" element={<CreateOrgGate />} />

      <Route path="/" element={<HomeRoute />} />
      <Route
        path="/projects"
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
        <Route path="settings" element={<ProjectSettingsPage />} />
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
        path="/saved"
        element={
          <RequireAuth>
            <SavedQueriesPage />
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
        path="/team"
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
        path="/validation-rules"
        element={
          <RequireAuth>
            <ValidationRulesPage />
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
        <OrgProvider>
          <AppRoutes />
          <ToastHost />
        </OrgProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
