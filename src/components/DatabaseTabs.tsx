import { NavLink } from 'react-router-dom'
import { FaCodeBranch, FaPlay, FaPlug, FaTable } from 'react-icons/fa'
import type { DatabaseEngine } from '../types'
import { engineSupportsMigrations, engineSupportsQuery } from '../lib/engines'

const TABS = [
  { to: 'schema', label: 'Schema', icon: <FaTable size={12} />, cap: 'always' as const },
  { to: 'query', label: 'Read panel', icon: <FaPlay size={12} />, cap: 'query' as const },
  { to: 'migrations', label: 'Migrations', icon: <FaCodeBranch size={12} />, cap: 'migrations' as const },
  { to: 'connections', label: 'Connections', icon: <FaPlug size={12} />, cap: 'always' as const },
]

// Tabs are gated by engine capability — e.g. a Redis database shows no Read
// panel or Migrations tab.
export function DatabaseTabs({ databaseId, engine }: { databaseId: string; engine: DatabaseEngine }) {
  const tabs = TABS.filter((t) =>
    t.cap === 'query' ? engineSupportsQuery(engine) : t.cap === 'migrations' ? engineSupportsMigrations(engine) : true,
  )
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 backdrop-blur md:max-w-fit">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={`/databases/${databaseId}/${tab.to}`}
          className={({ isActive }) =>
            `flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              isActive ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-white/75'
            }`
          }
        >
          {tab.icon}
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
