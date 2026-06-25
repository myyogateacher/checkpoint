import { Link } from 'react-router-dom'
import { FaChevronRight } from 'react-icons/fa'

export interface Crumb {
  label: string
  to?: string
}

// Wayfinding trail shown above page headers, especially useful on mobile where
// the sidebar is collapsed into a drawer.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {item.to && !last ? (
              <Link to={item.to} className="transition hover:text-indigo-600 dark:hover:text-indigo-400">
                {item.label}
              </Link>
            ) : (
              <span className={last ? 'font-medium text-slate-700 dark:text-slate-200' : ''}>{item.label}</span>
            )}
            {!last ? <FaChevronRight size={8} className="text-slate-300" /> : null}
          </span>
        )
      })}
    </nav>
  )
}
