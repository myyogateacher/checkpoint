import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
  FaBars,
  FaBookmark,
  FaClipboardList,
  FaCodeBranch,
  FaCog,
  FaHome,
  FaMoon,
  FaPlay,
  FaShieldAlt,
  FaSignOutAlt,
  FaSun,
  FaTimes,
  FaUsers,
} from 'react-icons/fa'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { can } from '../lib/format'
import { RoleBadge } from './badges'
import { StructureTree } from './StructureTree'
import { OrgSwitcher } from './OrgSwitcher'

// Active highlight uses indigo tints that read clearly in both themes
// (the plain bg-white surfaces are remapped to gray in dark mode).
const ACTIVE = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
const INACTIVE = 'text-slate-700 hover:bg-white/60'

const iconBtn =
  'cursor-pointer rounded-lg p-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700 dark:hover:text-slate-200'

function NavItem({
  to,
  icon,
  label,
  collapsed,
  onNavigate,
}: {
  to: string
  icon: ReactNode
  label: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      end={to === '/projects'}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition ${
          collapsed ? 'justify-center' : 'gap-2.5'
        } ${isActive ? ACTIVE : INACTIVE}`
      }
    >
      <span className="text-slate-400">{icon}</span>
      {collapsed ? null : label}
    </NavLink>
  )
}

// The sidebar body, shared by the desktop rail and the mobile drawer.
function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean
  onToggleCollapse?: () => void
  onNavigate?: () => void
}) {
  const { user, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  async function handleSignOut() {
    onNavigate?.()
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Brand + collapse toggle */}
      <div className={`flex pb-4 ${collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between px-2'}`}>
        <div className="flex items-center gap-2.5">
          <img src="/checkpoint.svg" alt="Checkpoint" className="h-8 w-8" />
          {collapsed ? null : (
            <div>
              <p className="text-sm font-semibold tracking-tight">Checkpoint</p>
              <p className="text-[11px] text-slate-500">Migration Assistant</p>
            </div>
          )}
        </div>
        {onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            className={iconBtn}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <FaAngleDoubleRight size={14} /> : <FaAngleDoubleLeft size={14} />}
          </button>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="pb-3">
          <OrgSwitcher />
        </div>
      )}

      <div className="space-y-1 border-y border-slate-200/60 py-3">
        <NavItem to="/projects" icon={<FaHome size={14} />} label="Projects" collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem to="/query" icon={<FaPlay size={14} />} label="Query Studio" collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem to="/saved" icon={<FaBookmark size={14} />} label="Saved Queries" collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem to="/migrations" icon={<FaCodeBranch size={14} />} label="Migrations" collapsed={collapsed} onNavigate={onNavigate} />
        {can(user?.role, 'manage_users') ? (
          <NavItem to="/team" icon={<FaUsers size={14} />} label="Team" collapsed={collapsed} onNavigate={onNavigate} />
        ) : null}
        <NavItem to="/audit" icon={<FaClipboardList size={14} />} label="Audit Log" collapsed={collapsed} onNavigate={onNavigate} />
        {can(user?.role, 'manage_users') ? (
          <NavItem to="/validation-rules" icon={<FaShieldAlt size={14} />} label="Validation Rules" collapsed={collapsed} onNavigate={onNavigate} />
        ) : null}
        {can(user?.role, 'manage_users') ? (
          <NavItem to="/settings" icon={<FaCog size={14} />} label="Settings" collapsed={collapsed} onNavigate={onNavigate} />
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-2">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Structure</p>
          <StructureTree onNavigate={onNavigate} />
        </div>
      )}

      {user ? (
        <div
          className={`mt-3 border-t border-slate-200/60 pt-3 ${
            collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center gap-2'
          }`}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white"
            title={collapsed ? `${user.name} · ${user.role}` : undefined}
          >
            {user.name.charAt(0)}
          </div>
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
              <div className="mt-0.5">
                <RoleBadge role={user.role} />
              </div>
            </div>
          )}
          <div className={`shrink-0 ${collapsed ? 'flex flex-col gap-1' : 'flex gap-0.5'}`}>
            <button
              onClick={toggle}
              className={iconBtn}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <FaSun size={14} /> : <FaMoon size={14} />}
            </button>
            <button onClick={handleSignOut} className={iconBtn} title="Sign out">
              <FaSignOutAlt size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const COLLAPSE_KEY = 'checkpoint.navCollapsed'

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen text-slate-900">
      {/* Mobile top bar */}
      <div className="glass-card sticky top-0 z-30 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <img src="/checkpoint.svg" alt="Checkpoint" className="h-7 w-7" />
          <span className="text-sm font-semibold tracking-tight">Checkpoint</span>
        </div>
        <button onClick={() => setDrawerOpen(true)} className={iconBtn} aria-label="Open menu">
          <FaBars size={16} />
        </button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="glass-card absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col rounded-none p-4">
            <button
              onClick={() => setDrawerOpen(false)}
              className={`absolute right-3 top-3 ${iconBtn}`}
              aria-label="Close menu"
            >
              <FaTimes size={15} />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-screen max-w-[1500px] gap-6 px-4 py-6 md:px-8">
        {/* Desktop sidebar */}
        <aside className={`hidden shrink-0 transition-all duration-200 lg:block ${collapsed ? 'w-20' : 'w-72'}`}>
          <div className="glass-card sticky top-6 flex h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-2xl p-4">
            <SidebarContent collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 pb-12">{children}</main>
      </div>
    </div>
  )
}
