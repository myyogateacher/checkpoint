import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaBuilding, FaCheck, FaChevronDown, FaPlus } from 'react-icons/fa'
import { useOrg } from '../context/OrgContext'

// Shows the active organization with a popover to switch or create another.
export function OrgSwitcher() {
  const { orgs, currentOrg, currentOrgId, setCurrentOrg, locked } = useOrg()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!currentOrg) return null

  // Locked single-org deployments just show the name, no switching/creating.
  const interactive = !locked || orgs.length > 1

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => interactive && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border border-slate-200/60 bg-white/40 px-2.5 py-1.5 text-left transition ${
          interactive ? 'cursor-pointer hover:bg-white/70' : 'cursor-default'
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-500">
          <FaBuilding size={11} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{currentOrg.name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-slate-400">Organization</span>
        </span>
        {interactive ? <FaChevronDown size={10} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} /> : null}
      </button>

      {open ? (
        <div className="glass-card absolute z-50 mt-1 w-full overflow-hidden rounded-lg p-1 shadow-xl">
          {orgs.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setCurrentOrg(o.id)
                setOpen(false)
                navigate('/')
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                o.id === currentOrgId
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                  : 'text-slate-700 hover:bg-white/70 dark:text-slate-200'
              }`}
            >
              <span className="truncate">{o.name}</span>
              {o.id === currentOrgId ? <FaCheck size={10} className="shrink-0" /> : null}
            </button>
          ))}
          {!locked ? (
            <button
              onClick={() => {
                setOpen(false)
                navigate('/create-org')
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-slate-200/60 px-2.5 py-1.5 text-left text-sm text-slate-600 transition hover:bg-white/70 dark:text-slate-300"
            >
              <FaPlus size={10} /> Create organization
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
