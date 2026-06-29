import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../env'

// AES-256-GCM encryption for secrets at rest (connection & SMTP passwords).
// Stored format: base64(iv).base64(authTag).base64(ciphertext).
const key = createHash('sha256').update(env.secretKey).digest()

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const [ivb, tagb, datab] = blob.split('.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivb, 'base64'))
  decipher.setAuthTag(Buffer.from(tagb, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(datab, 'base64')), decipher.final()]).toString('utf8')
}
