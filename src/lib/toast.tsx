import toast, { Toaster, type Toast } from 'react-hot-toast'
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaTimes } from 'react-icons/fa'
import type { ReactNode } from 'react'

// Custom-rendered toasts so they match the glass theme (light + dark) instead
// of react-hot-toast's default look.

type Variant = 'success' | 'error' | 'info'

const VARIANT_META: Record<Variant, { icon: ReactNode; accent: string }> = {
  success: { icon: <FaCheckCircle />, accent: 'text-emerald-500' },
  error: { icon: <FaExclamationCircle />, accent: 'text-rose-500' },
  info: { icon: <FaInfoCircle />, accent: 'text-sky-500' },
}

function ToastCard({ t, variant, message }: { t: Toast; variant: Variant; message: string }) {
  const meta = VARIANT_META[variant]
  return (
    <div
      className={`glass-card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg transition-all ${
        t.visible ? 'animate-[fadeIn_0.15s_ease-out] opacity-100' : 'opacity-0'
      }`}
    >
      <span className={`mt-0.5 text-base ${meta.accent}`}>{meta.icon}</span>
      <p className="flex-1 text-sm text-slate-800 dark:text-slate-100">{message}</p>
      <button
        onClick={() => toast.dismiss(t.id)}
        className="cursor-pointer rounded p-1 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
        aria-label="Dismiss"
      >
        <FaTimes size={11} />
      </button>
    </div>
  )
}

function show(variant: Variant, message: string) {
  return toast.custom((t) => <ToastCard t={t} variant={variant} message={message} />, {
    duration: variant === 'error' ? 5000 : 3000,
  })
}

export const notify = {
  success: (message: string) => show('success', message),
  error: (message: string) => show('error', message),
  info: (message: string) => show('info', message),
}

// Mounted once in App; renders the toast stack in the top-right.
export function ToastHost() {
  return <Toaster position="top-right" gutter={10} containerClassName="!top-4 !right-4" />
}
