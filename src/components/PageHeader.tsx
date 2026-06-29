import type { ReactNode } from 'react'
import { Eyebrow } from './ui'
import { Breadcrumbs, type Crumb } from './Breadcrumbs'
import { useOrg } from '../context/OrgContext'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  breadcrumbs?: Crumb[]
}) {
  const { currentOrg } = useOrg()

  // Every page shows "Org > …": the org leads, then either the page-specific
  // trail or, by default, the page title.
  const trail: Crumb[] = []
  if (currentOrg) trail.push({ label: currentOrg.name, to: '/projects' })
  trail.push(...(breadcrumbs ?? [{ label: title }]))

  return (
    <div className="mb-6">
      <Breadcrumbs items={trail} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-sm text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
