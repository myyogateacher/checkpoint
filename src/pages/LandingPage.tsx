import { Link } from 'react-router-dom'
import {
  FaArrowRight,
  FaCheckDouble,
  FaClipboardList,
  FaCodeBranch,
  FaDatabase,
  FaPlay,
  FaShieldAlt,
} from 'react-icons/fa'

// Public marketing page. Always dark, independent of the app theme.
const FEATURES = [
  {
    icon: <FaCodeBranch />,
    title: 'Reviewable migrations',
    body: 'Propose schema changes as migrations with multiple statements, reviewers, comments, and required approvals.',
  },
  {
    icon: <FaCheckDouble />,
    title: 'Approve & release',
    body: 'Nothing touches production until it is approved. Apply through a controlled write connection, every time.',
  },
  {
    icon: <FaPlay />,
    title: 'Read-only query studio',
    body: 'Explore schema and run SELECT-only queries with auto-format, multiple tabs, and saveable, shareable queries.',
  },
  {
    icon: <FaDatabase />,
    title: 'Postgres · MySQL · ClickHouse',
    body: 'Organize databases by project and environment, each with separate read and write connections.',
  },
  {
    icon: <FaClipboardList />,
    title: 'Full audit trail',
    body: 'Every action — schema pulls, queries, approvals, applies — recorded in an immutable, searchable log.',
  },
  {
    icon: <FaShieldAlt />,
    title: 'Role-based access',
    body: 'Admins, editors, and viewers. Google SSO or email — access is provisioned, never open by default.',
  },
]

function CtaButtons({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const pad = size === 'lg' ? 'px-6 py-3 text-base' : 'px-5 py-2.5 text-sm'
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        to="/signup"
        className={`inline-flex items-center gap-2 rounded-lg border border-blue-400/40 bg-gradient-to-r from-blue-600 to-indigo-600 font-medium text-white shadow-[0_8px_30px_rgba(37,99,235,0.4)] transition hover:from-blue-500 hover:to-indigo-500 ${pad}`}
      >
        Try for free <FaArrowRight size={12} />
      </Link>
      <Link
        to="/login"
        className={`inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 font-medium text-slate-100 backdrop-blur transition hover:bg-white/10 ${pad}`}
      >
        Log in
      </Link>
    </div>
  )
}

export function LandingPage() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          'radial-gradient(circle at 12% -10%, rgba(37,99,235,0.25), transparent 45%), radial-gradient(circle at 90% 0%, rgba(79,70,229,0.22), transparent 45%), linear-gradient(180deg, #0a0a0f 0%, #0b1020 60%, #0a0a0f 100%)',
      }}
    >
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <img src="/checkpoint.svg" alt="Checkpoint" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Checkpoint</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-slate-300 transition hover:text-white">
            Log in
          </Link>
          <Link
            to="/signup"
            className="rounded-lg border border-blue-400/40 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:from-blue-500 hover:to-indigo-500"
          >
            Try for free
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 text-center md:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-indigo-300">
          Database migration assistant
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          Ship database changes
          <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent"> with confidence</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-slate-300 md:text-lg">
          Checkpoint is the controlled path to production for your schema. Propose, review, and apply migrations —
          browse schema and run safe read queries — all with full audit and role-based access.
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButtons size="lg" />
        </div>
        <p className="mt-4 text-xs text-slate-500">No credit card required · Google SSO or email</p>

        {/* Faux app preview strip */}
        <div className="mx-auto mt-14 max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-2 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950/60 p-3 text-left">
            <div className="space-y-2">
              {['Core Platform', 'Analytics'].map((p) => (
                <div key={p} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                  📁 {p}
                </div>
              ))}
            </div>
            <div className="col-span-2 rounded-lg border border-white/10 bg-slate-900/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              <span className="text-emerald-400">-- migration · pending approval</span>
              <br />
              <span className="text-sky-300">ALTER TABLE</span> users
              <br />
              &nbsp;&nbsp;<span className="text-sky-300">ADD COLUMN</span> last_seen_at timestamptz;
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA footer */}
      <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-10">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Put a checkpoint before every change.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
            Start free and bring your team into a reviewed, audited migration workflow today.
          </p>
          <div className="mt-6 flex justify-center">
            <CtaButtons size="lg" />
          </div>
        </div>
        <p className="mt-10 text-xs text-slate-600">© 2026 Checkpoint · Database migration assistant</p>
      </section>
    </div>
  )
}
