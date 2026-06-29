import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { notify } from '../lib/toast'
import { PASSWORD_AUTH_ENABLED } from '../lib/config'
import { AuthShell, AuthDivider, authInputClass, primaryBtnClass } from '../components/AuthShell'
import { GoogleSignInButton } from '../components/GoogleSignInButton'

export function SignupPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  function create(e: React.FormEvent) {
    e.preventDefault()
    // The backend authenticates with Google only; there is no password endpoint.
    notify.error('Email/password sign-up isn’t enabled. Continue with Google.')
  }

  async function google(credential: string) {
    setBusy(true)
    try {
      await signIn(credential)
      navigate('/')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Sign-up failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      subtitle={PASSWORD_AUTH_ENABLED ? 'Free to start. Use Google or an email and password.' : 'Free to start. Sign up with your Google account.'}
    >
      {PASSWORD_AUTH_ENABLED ? (
        <>
          <form onSubmit={create} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className={authInputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Work email</span>
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
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className={authInputClass}
          />
        </label>
            <button type="submit" disabled={busy} className={primaryBtnClass}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <AuthDivider />
        </>
      ) : null}

      <GoogleSignInButton onCredential={google} text="signup_with" />

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}
