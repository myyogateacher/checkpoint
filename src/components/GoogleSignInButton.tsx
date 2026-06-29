import { useEffect, useRef, useState } from 'react'
import { GOOGLE_CLIENT_ID } from '../lib/config'

// Minimal typing for the Google Identity Services client we load at runtime.
interface GsiCredentialResponse {
  credential: string
}
interface GsiId {
  initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void }): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GsiId } }
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client'

// Load the GIS script once and resolve when window.google is ready.
let gsiPromise: Promise<void> | null = null
function loadGsi(): Promise<void> {
  if (gsiPromise) return gsiPromise
  gsiPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'))
    document.head.appendChild(script)
  })
  return gsiPromise
}

export function GoogleSignInButton({
  onCredential,
  text = 'continue_with',
}: {
  onCredential: (credential: string) => void
  text?: 'signin_with' | 'signup_with' | 'continue_with'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Keep the latest callback without re-initializing GIS on every render.
  const cb = useRef(onCredential)
  cb.current = onCredential

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google sign-in is not configured (VITE_GOOGLE_CLIENT_ID is unset).')
      return
    }
    let cancelled = false
    loadGsi()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => cb.current(r.credential),
        })
        ref.current.innerHTML = ''
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          width: ref.current.offsetWidth || 360,
          text,
          logo_alignment: 'center',
        })
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Google sign-in failed to load.'))
    return () => {
      cancelled = true
    }
  }, [text])

  if (error) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">{error}</p>
  }
  return <div ref={ref} className="flex justify-center [color-scheme:light]" />
}
