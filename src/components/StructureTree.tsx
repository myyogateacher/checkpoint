import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { FaChevronDown, FaChevronRight, FaDatabase, FaFolder, FaLayerGroup } from 'react-icons/fa'
import { api } from '../services/api'
import type { Database, Environment, Project } from '../types'
import { ENGINE_LABELS } from '../lib/format'

const ENGINE_DOT: Record<string, string> = {
  postgres: 'bg-sky-500',
  mysql: 'bg-amber-500',
  clickhouse: 'bg-yellow-500',
}

export function StructureTree({ onNavigate }: { onNavigate?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [databases, setDatabases] = useState<Database[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const location = useLocation()

  useEffect(() => {
    void (async () => {
      const [projs, dbs] = await Promise.all([api.getProjects(), api.getDatabases()])
      setProjects(projs)
      setDatabases(dbs)
      const envLists = await Promise.all(projs.map((p) => api.getEnvironments(p.id)))
      setEnvironments(envLists.flat())
      // Auto-expand everything on first load so the tree is discoverable.
      const initial: Record<string, boolean> = {}
      projs.forEach((p) => (initial[p.id] = true))
      envLists.flat().forEach((e) => (initial[e.id] = true))
      setOpen(initial)
    })()
  }, [])

  const envsByProject = useMemo(() => {
    const map: Record<string, Environment[]> = {}
    for (const e of environments) (map[e.project_id] ??= []).push(e)
    return map
  }, [environments])

  const dbsByEnv = useMemo(() => {
    const map: Record<string, Database[]> = {}
    for (const d of databases) (map[d.environment_id] ??= []).push(d)
    return map
  }, [databases])

  function toggle(id: string) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <nav className="space-y-1 text-sm">
      {projects.map((project) => (
        <div key={project.id}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggle(project.id)}
              className="flex cursor-pointer items-center rounded p-1 text-slate-400 hover:text-slate-600"
              aria-label="Toggle project"
            >
              {open[project.id] ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
            </button>
            <NavLink
              to={`/projects/${project.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 font-medium transition ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'text-slate-700 hover:bg-white/60'
                }`
              }
            >
              <FaFolder className="text-indigo-400" size={13} />
              {project.name}
            </NavLink>
          </div>

          {open[project.id]
            ? (envsByProject[project.id] ?? []).map((env) => (
                <div key={env.id} className="ml-4">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggle(env.id)}
                      className="flex cursor-pointer items-center rounded p-1 text-slate-400 hover:text-slate-600"
                      aria-label="Toggle environment"
                    >
                      {open[env.id] ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                    </button>
                    <div className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-slate-600">
                      <FaLayerGroup className="text-slate-400" size={12} />
                      <span className="capitalize">{env.name}</span>
                    </div>
                  </div>

                  {open[env.id]
                    ? (dbsByEnv[env.id] ?? []).map((db) => {
                        const active = location.pathname.startsWith(`/databases/${db.id}`)
                        return (
                          <NavLink
                            key={db.id}
                            to={`/databases/${db.id}/schema`}
                            onClick={onNavigate}
                            className={`ml-8 flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                              active
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                                : 'text-slate-600 hover:bg-white/60'
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${ENGINE_DOT[db.engine]}`} title={ENGINE_LABELS[db.engine]} />
                            <FaDatabase size={11} className="text-slate-400" />
                            <span className="font-mono text-[13px]">{db.name}</span>
                          </NavLink>
                        )
                      })
                    : null}
                </div>
              ))
            : null}
        </div>
      ))}
    </nav>
  )
}
