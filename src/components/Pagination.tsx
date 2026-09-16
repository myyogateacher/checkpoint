import type { ReactNode } from 'react'
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import { Dropdown } from './Dropdown'

const PAGE_SIZES = [10, 25, 50, 100]

// Page numbers to render: always the first, last and the window around the
// current page; `null` marks an elided run (rendered as an ellipsis).
export function pageItems(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const pages = new Set([1, pageCount, page, page - 1, page + 1])
  // Keep the strip a constant width at either end rather than letting it shrink.
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const items: Array<number | null> = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) items.push(null)
    items.push(p)
    prev = p
  }
  return items
}

// Reusable pager for server-paginated lists. `total` is the filtered row count,
// `page` is 1-based. Renders nothing when there is a single page and no page-size
// control to offer.
export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className = '',
}: {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)

  const step = (delta: number) => {
    const next = Math.min(pageCount, Math.max(1, page + delta))
    if (next !== page) onPageChange(next)
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>
          Showing <span className="font-medium text-slate-700">{first}</span>–
          <span className="font-medium text-slate-700">{last}</span> of{' '}
          <span className="font-medium text-slate-700">{total}</span>
        </span>
        {onPageSizeChange ? (
          <span className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Per page</span>
            <Dropdown
              value={String(pageSize)}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => onPageSizeChange(Number(v))}
              className="w-[4.5rem]"
            />
          </span>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PagerButton label="Previous page" disabled={page <= 1} onClick={() => step(-1)}>
            <FaChevronLeft size={10} />
            <span className="hidden sm:inline">Prev</span>
          </PagerButton>
          <div className="flex items-center gap-1">
            {pageItems(page, pageCount).map((p, i) =>
              p === null ? (
                <span key={`gap-${i}`} className="px-1 text-xs text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => p !== page && onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={`min-w-8 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    p === page
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                      : 'text-slate-600 hover:bg-white/60'
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </div>
          <PagerButton label="Next page" disabled={page >= pageCount} onClick={() => step(1)}>
            <span className="hidden sm:inline">Next</span>
            <FaChevronRight size={10} />
          </PagerButton>
        </nav>
      ) : null}
    </div>
  )
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/60 bg-white/60 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
