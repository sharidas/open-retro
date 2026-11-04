import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function createFacilitatorSecret() {
  const secret = randomBytes(32).toString('base64url')
  return { secret, hash: hashSecret(secret) }
}

export function verifyFacilitatorSecret(secret: string, storedHash: string | null): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || !storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) {
    return false
  }
  return timingSafeEqual(Buffer.from(hashSecret(secret), 'hex'), Buffer.from(storedHash, 'hex'))
}
