import { OAuth2Client } from 'google-auth-library'
import { env } from '../env'
import { badRequest } from './http'

const client = new OAuth2Client(env.googleClientId)

export interface GoogleProfile {
  email: string
  name: string
  picture: string | null
}

// Verify a Google ID token (the credential the client obtains via Google Identity
// Services) and return the validated profile. Throws on any failure.
export async function verifyGoogleToken(credential: string): Promise<GoogleProfile> {
  if (!env.googleClientId) throw badRequest('Google sign-in is not configured on the server.')
  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.googleClientId })
    payload = ticket.getPayload()
  } catch {
    throw badRequest('Invalid Google credential.')
  }
  if (!payload?.email || payload.email_verified === false) throw badRequest('Google account email is not verified.')
  return {
    email: payload.email.toLowerCase(),
    name: payload.name ?? payload.email,
    picture: payload.picture ?? null,
  }
}
