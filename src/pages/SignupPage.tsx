import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FaGoogle } from 'react-icons/fa'
import { useAuth } from '../context/AuthContext'
import { PASSWORD_AUTH_ENABLED } from '../lib/config'
import { AuthShell, AuthDivider, authInputClass, GoogleButton, primaryBtnClass } from '../components/AuthShell'

export function SignupPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // Mock: creating an account signs you in as the demo admin.
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

      <GoogleButton onClick={google} disabled={busy} label="Sign up with Google" icon={<FaGoogle />} />

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}
