import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaGoogle } from 'react-icons/fa'
import { useAuth } from '../context/AuthContext'
import { Eyebrow } from '../components/ui'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function handleSignIn() {
    setBusy(true)
    try {
      await signIn()
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src="/checkpoint.svg" alt="Checkpoint" className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight text-slate-800">Checkpoint</span>
        </div>

        <section className="glass-card rounded-2xl p-8 md:p-10">
          <Eyebrow>Authentication</Eyebrow>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="mt-3 text-sm text-slate-600">
            Checkpoint is the controlled path for database migrations. Access requires Google
            sign-in; your role determines what you can review and apply.
          </p>

          <button
            onClick={handleSignIn}
            disabled={busy}
            className="mt-6 inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-blue-300/60 bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_24px_rgba(37,99,235,0.28)] transition duration-150 ease-out hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:opacity-60"
          >
            <FaGoogle />
            {busy ? 'Signing in…' : 'Continue with Google'}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Backend is stubbed — this signs you in locally as an admin for the demo.
          </p>
        </section>
      </div>
    </main>
  )
}
