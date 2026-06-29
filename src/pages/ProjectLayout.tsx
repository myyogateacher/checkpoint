import { useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { FaCodeBranch, FaCog, FaDatabase } from 'react-icons/fa'
import type { Project } from '../types'
import { api } from '../services/api'
import { PageHeader } from '../components/PageHeader'
import { TagList } from '../components/badges'
import { Card, Spinner } from '../components/ui'

type ProjectContext = { project: Project }

export function useProject(): Project {
  return useOutletContext<ProjectContext>().project
}

const TABS = [
  { to: '', label: 'Databases', icon: <FaDatabase size={12} />, end: true },
  { to: 'migrations', label: 'Migrations', icon: <FaCodeBranch size={12} />, end: false },
  { to: 'settings', label: 'Settings', icon: <FaCog size={12} />, end: false },
]

export function ProjectLayout() {
  const { projectId = '' } = useParams()
  const [project, setProject] = useState<Project | null | undefined>(null)

  useEffect(() => {
    setProject(null)
    void api.getProject(projectId).then((p) => setProject(p ?? undefined))
  }, [projectId])

  if (project === null) {
    return (
      <Card className="p-6">
        <Spinner label="Loading project…" />
      </Card>
    )
  }
  if (project === undefined) return <PageHeader title="Project not found" />

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={project.description ?? undefined}
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
        actions={<TagList tags={project.tags} />}
      />

      <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-white/60 bg-white/55 p-1 backdrop-blur md:max-w-fit">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to ? `/projects/${project.id}/${tab.to}` : `/projects/${project.id}`}
            end={tab.end}
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

      <Outlet context={{ project } satisfies ProjectContext} />
    </>
  )
}
