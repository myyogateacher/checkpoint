import { NavLink } from 'react-router-dom'
import { FaCodeBranch, FaPlay, FaPlug, FaTable } from 'react-icons/fa'

const TABS = [
  { to: 'schema', label: 'Schema', icon: <FaTable size={12} /> },
  { to: 'query', label: 'Read panel', icon: <FaPlay size={12} /> },
  { to: 'migrations', label: 'Migrations', icon: <FaCodeBranch size={12} /> },
  { to: 'connections', label: 'Connections', icon: <FaPlug size={12} /> },
]

export function DatabaseTabs({ databaseId }: { databaseId: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 backdrop-blur md:max-w-fit">
      {TABS.map((tab) => (
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
