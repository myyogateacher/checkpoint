import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FaGoogle } from 'react-icons/fa'
import { useAuth } from '../context/AuthContext'
import { notify } from '../lib/toast'
import { PASSWORD_AUTH_ENABLED } from '../lib/config'
import { AuthShell, AuthDivider, authInputClass, GoogleButton, primaryBtnClass } from '../components/AuthShell'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // Mock: any credentials sign you in as the demo admin.
      await signIn()
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    try {
      await signIn()
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'forgot' && PASSWORD_AUTH_ENABLED) {
    return (
      <AuthShell eyebrow="Reset password" title="Forgot your password?" subtitle="Enter your email and we'll send a reset link.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            notify.success(`If an account exists for ${email || 'that address'}, a reset link is on its way.`)
            setMode('signin')
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={authInputClass}
            />
          </label>
          <button type="submit" className={primaryBtnClass}>
            Send reset link
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          <button onClick={() => setMode('signin')} className="cursor-pointer font-medium text-indigo-600 hover:underline">
            Back to sign in
          </button>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Checkpoint"
      subtitle={PASSWORD_AUTH_ENABLED ? 'Use your work email or Google account.' : 'Sign in with your Google account.'}
    >
      {PASSWORD_AUTH_ENABLED ? (
        <>
          <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={authInputClass}
          />
        </label>
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <button
              type="button"
              onClick={() => setMode('forgot')}
              className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={authInputClass}
          />
        </label>
            <button type="submit" disabled={busy} className={primaryBtnClass}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <AuthDivider />
        </>
      ) : null}

      <GoogleButton onClick={google} disabled={busy} label="Continue with Google" icon={<FaGoogle />} />

      <p className="mt-6 text-center text-sm text-slate-500">
        Don't have an account?{' '}
        <Link to="/signup" className="font-medium text-indigo-600 hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  )
}
