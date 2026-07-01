import { useMemo, useState } from 'react'
import { FaChevronLeft, FaChevronRight, FaRegClock } from 'react-icons/fa'
import { Select, TextInput } from './ui'

// A self-contained date + time picker styled to match the app, used instead of
// the bare native <input type="datetime-local">. Value is a local datetime-local
// string ("YYYY-MM-DDTHH:mm"), the same format new Date(value) parses as local.

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dayOnly(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function DateTimePicker({
  value,
  onChange,
  min,
}: {
  value: string
  onChange: (v: string) => void
  min?: Date
}) {
  const selected = useMemo(() => (value ? new Date(value) : new Date()), [value])
  const [view, setView] = useState(() => ({ year: selected.getFullYear(), month: selected.getMonth() }))

  const hour = selected.getHours()
  const minute = selected.getMinutes()
  const minDay = min ? dayOnly(min) : null

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const firstWeekday = new Date(view.year, view.month, 1).getDay()
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function emit(next: Date) {
    onChange(toValue(next))
  }

  function pickDay(day: number) {
    emit(new Date(view.year, view.month, day, hour, minute))
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  // Don't let the user page to a month entirely before `min`.
  const prevDisabled = minDay != null && dayOnly(new Date(view.year, view.month, 1)) <= dayOnly(new Date(min!.getFullYear(), min!.getMonth(), 1))

  const isSelectedMonth = selected.getFullYear() === view.year && selected.getMonth() === view.month

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/50 p-3 dark:border-white/10 dark:bg-white/5">
      {/* Month navigation */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={prevDisabled}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
          aria-label="Previous month"
        >
          <FaChevronLeft size={12} />
        </button>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {MONTHS[view.month]} {view.year}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/70 dark:hover:bg-white/10"
          aria-label="Next month"
        >
          <FaChevronRight size={12} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day == null) return <span key={`e${i}`} />
          const thisDay = dayOnly(new Date(view.year, view.month, day))
          const disabled = minDay != null && thisDay < minDay
          const isSelected = isSelectedMonth && day === selected.getDate()
          return (
            <button
              key={day}
              type="button"
              onClick={() => pickDay(day)}
              disabled={disabled}
              className={`flex h-9 items-center justify-center rounded-lg text-sm transition ${
                isSelected
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-[0_4px_12px_rgba(37,99,235,0.3)]'
                  : disabled
                    ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                    : 'text-slate-700 hover:bg-white/80 dark:text-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>

      {/* Time selection */}
      <div className="mt-3 flex items-center gap-2 border-t border-slate-200/60 pt-3 dark:border-white/10">
        <span className="flex items-center gap-1.5 text-sm text-slate-500">
          <FaRegClock size={12} /> Time
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Select
            className="w-auto py-1.5"
            value={hour}
            onChange={(e) => emit(new Date(view.year, view.month, selected.getDate(), Number(e.target.value), minute))}
            aria-label="Hour"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {pad(h)}
              </option>
            ))}
          </Select>
          <span className="text-slate-400">:</span>
          <TextInput
            type="number"
            min={0}
            max={59}
            className="w-16 py-1.5 text-center"
            value={minute}
            onChange={(e) => {
              const n = Math.max(0, Math.min(59, Math.trunc(Number(e.target.value) || 0)))
              emit(new Date(view.year, view.month, selected.getDate(), hour, n))
            }}
            aria-label="Minute"
          />
        </div>
      </div>
    </div>
  )
}
