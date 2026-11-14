import type { MiddlewareHandler } from 'hono'
import { hashSecret } from './domain/facilitator.js'

// Process-local fixed windows. No IPs, raw tokens, or durable tracking.
export function createLimiter(clock: () => number = Date.now, maxEntries = 10000) {
  const buckets = new Map<string, { count: number; until: number }>()
  let sweepAt = 0
  return (key: string, limit: number, windowMs: number): number => {
    const now = clock()
    if (now >= sweepAt) {
      for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id)
      sweepAt = now + 60000
    }
    let bucket = buckets.get(key)
    if (bucket && bucket.until <= now) { buckets.delete(key); bucket = undefined }
    if (!bucket) {
      if (buckets.size >= maxEntries) return Math.max(1, Math.ceil((sweepAt - now) / 1000))
      bucket = { count: 0, until: now + windowMs }; buckets.set(key, bucket)
    }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.until - now) / 1000))
    bucket.count++
    return 0
  }
}

export function abuseProtection(clock: () => number = Date.now): MiddlewareHandler {
  const consume = createLimiter(clock)
  return async (c, next) => {
    const reject = (seconds: number) => {
      c.header('Retry-After', String(seconds))
      return c.json({ error: 'RATE_LIMITED', message: 'Too many requests. Wait before trying again.', retryAfter: seconds }, 429)
    }
    // Global ceiling includes unauthenticated and invalid requests.
    let wait = consume('global', 12000, 60000)
    if (wait) return reject(wait)
    if (c.req.method === 'POST' && c.req.path === '/api/rooms') {
      wait = consume('create', 30, 3600000)
      if (wait) return reject(wait)
    }
    const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(c.req.path)
    if (c.req.method === 'POST' && join) {
      wait = consume(`join:${hashSecret(join[1])}`, 120, 60000)
      if (wait) return reject(wait)
    }
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (token) {
      wait = consume(`token:${hashSecret(token)}`, 120, 60000)
      if (wait) return reject(wait)
    }
    await next()
  }
}
