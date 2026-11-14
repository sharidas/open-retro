import { expect, it } from 'vitest'
import { Hono } from 'hono'
import { abuseProtection, createLimiter } from '../src/rate-limit.js'
it('allows the budget, rejects excess, and resets exactly at the deadline', () => {
  let now = 0; const consume = createLimiter(() => now)
  expect(consume('a', 2, 1000)).toBe(0); expect(consume('a', 2, 1000)).toBe(0)
  expect(consume('a', 2, 1000)).toBe(1); expect(consume('b', 2, 1000)).toBe(0)
  now = 1000; expect(consume('a', 2, 1000)).toBe(0)
})
it('bounds memory and recovers capacity after windows expire', () => {
  let now = 0; const consume = createLimiter(() => now, 2)
  consume('a', 1, 1000); consume('b', 1, 1000)
  expect(consume('c', 1, 1000)).toBeGreaterThan(0)
  now = 60000; expect(consume('c', 1, 1000)).toBe(0)
})
it('limits creation globally despite different credentials and spoofed IP headers', async () => {
  let now = 0; const app = new Hono(); app.use('*', abuseProtection(() => now)); app.post('/api/rooms', c => c.json({ ok: true }))
  for (let i = 0; i < 30; i++) expect((await app.request('/api/rooms', { method: 'POST' })).status).toBe(200)
  const limited = await app.request('/api/rooms', { method: 'POST', headers: { 'X-Forwarded-For': '1.2.3.4', Authorization: `Bearer ${'a'.repeat(43)}` } })
  expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('3600')
  now = 3600000; expect((await app.request('/api/rooms', { method: 'POST' })).status).toBe(200)
})
it('counts one token across reads and writes without blocking a different token', async () => {
  const app = new Hono(); app.use('*', abuseProtection()); app.all('*', c => c.text('ok'))
  const headers = { Authorization: `Bearer ${'a'.repeat(43)}` }
  for (let i = 0; i < 120; i++) expect((await app.request('/api/rooms/a', { headers })).status).toBe(200)
  expect((await app.request('/api/rooms/a/facilitator', { method: 'DELETE', headers })).status).toBe(429)
  expect((await app.request('/api/rooms/a', { headers: { Authorization: `Bearer ${'b'.repeat(43)}` } })).status).toBe(200)
})
it('bounds join attempts even when tokens rotate', async () => {
  const app = new Hono(); app.use('*', abuseProtection()); app.post('*', c => c.text('ok'))
  for (let i = 0; i < 120; i++) await app.request('/api/rooms/a/join', { method: 'POST' })
  expect((await app.request('/api/rooms/a/join', { method: 'POST' })).status).toBe(429)
  expect((await app.request('/api/rooms/b/join', { method: 'POST' })).status).toBe(200)
})
