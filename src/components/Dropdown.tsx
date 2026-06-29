import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FaCheck, FaChevronDown, FaSearch } from 'react-icons/fa'

export interface DropdownOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

// A themed replacement for native <select>. The menu is rendered in a portal
// with fixed positioning so it is never clipped by an ancestor's overflow
// (e.g. a table or modal). Closes on outside-click, scroll, resize, or Escape.
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  menuMinWidth,
  searchable = false,
  searchPlaceholder = 'Search…',
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  // When set, the popover may grow wider than the trigger (px) — useful when
  // options carry descriptive hint sub-lines.
  menuMinWidth?: number
  // Show a type-to-filter search box at the top of the menu.
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    if (!open) setQuery('')
  }, [open])

  const q = query.trim().toLowerCase()
  const visibleOptions =
    searchable && q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
      : options

  useEffect(() => {
    if (!open) return
    function reposition() {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  // Flip above the trigger when there isn't enough room below.
  const openUp = rect ? window.innerHeight - rect.bottom < 260 && rect.top > 260 : false

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-indigo-400 ring-2 ring-indigo-200/60' : ''
        }`}
      >
        <span className={`truncate ${selected ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <FaChevronDown size={11} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                left: rect.left,
                ...(menuMinWidth
                  ? {
                      minWidth: Math.max(rect.width, menuMinWidth),
                      maxWidth: Math.min(menuMinWidth + 80, window.innerWidth - rect.left - 12),
                    }
                  : { width: rect.width }),
                ...(openUp
                  ? { bottom: window.innerHeight - rect.top + 4 }
                  : { top: rect.bottom + 4 }),
              }}
              className="glass-card z-[60] flex max-h-72 flex-col rounded-lg p-1 shadow-xl"
            >
              {searchable ? (
                <div className="relative p-1">
                  <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={11} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full rounded-md border py-1.5 pl-7 pr-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60"
                  />
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {visibleOptions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-400">{q ? 'No matches' : 'No options'}</p>
                ) : (
                  visibleOptions.map((opt) => {
                    const active = opt.value === value
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        disabled={opt.disabled}
                        onClick={() => {
                          if (opt.disabled) return
                          onChange(opt.value)
                          setOpen(false)
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                            : 'text-slate-700 hover:bg-white/70 dark:text-slate-200'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{opt.label}</span>
                          {opt.hint ? (
                            <span className="mt-0.5 block text-xs leading-snug text-slate-400">{opt.hint}</span>
                          ) : null}
                        </span>
                        {active ? <FaCheck size={11} className="mt-0.5 shrink-0" /> : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
