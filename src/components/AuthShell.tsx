import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Eyebrow } from './ui'

export const authInputClass =
  'w-full rounded-lg border px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60'

export const primaryBtnClass =
  'inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-blue-300/60 bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_24px_rgba(37,99,235,0.28)] transition hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:opacity-60'

// Centered card used by the login and signup screens.
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-3">
          <img src="/checkpoint.svg" alt="Checkpoint" className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight text-slate-800">Checkpoint</span>
        </Link>
        <section className="glass-card rounded-2xl p-8">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </main>
  )
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
      <span className="h-px flex-1 bg-slate-200/70" />
      or
      <span className="h-px flex-1 bg-slate-200/70" />
    </div>
  )
}

export function GoogleButton({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-white/60 bg-white/60 px-5 py-2.5 text-sm font-medium text-slate-700 backdrop-blur transition hover:bg-white/80 disabled:opacity-60"
    >
      {icon}
      {label}
    </button>
  )
}
