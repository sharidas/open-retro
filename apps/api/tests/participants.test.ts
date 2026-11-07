import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
import { rooms } from '../src/storage/schema.js'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose()
  cleanup.length = 0
})
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'open-retro-participants-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const connection = await openDatabase(join(folder, 'rooms.sqlite'))
  cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now)
  const app = createApp(repo, () => now)
  const room = await repo.create(['A', 'B', 'C', 'D', 'E'])
  const token = randomBytes(32).toString('base64url')
  const request = (id = room.id, credential: string | null = token, method = 'POST') =>
    app.request(`/api/rooms/${id}${method === 'POST' ? '/join' : ''}`, {
      method, headers: credential ? { Authorization: `Bearer ${credential}` } : {},
    })
  return { ...connection, repo, room, token, request, app, expire: () => { now = room.expiresAt } }
}

it('joins without identity fields, stores only a room-scoped hash, and returns public metadata', async () => {
  const f = await fixture()
  const response = await f.request()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ room: f.room })
  expect(await f.db.all(sql`SELECT * FROM participants`)).toEqual([
    { room_id: f.room.id, token_hash: hashSecret(f.token), ready: 0 },
  ])
  expect((await f.request(f.room.id, f.token, 'GET')).status).toBe(200)
})

it('makes repeated and concurrent joins idempotent', async () => {
  const f = await fixture()
  const responses = await Promise.all([f.request(), f.request(), f.request()])
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
  expect(await f.db.all(sql`SELECT room_id FROM participants`)).toHaveLength(1)
})

it('allows independent participants without exposing either to the facilitator', async () => {
  const f = await fixture()
  const secret = randomBytes(32).toString('base64url')
  const room = await f.repo.create(['A'], hashSecret(secret))
  await f.request(room.id)
  await f.request(room.id, randomBytes(32).toString('base64url'))
  expect(await f.db.all(sql`SELECT room_id FROM participants`)).toHaveLength(2)
  const response = await f.app.request(`/api/rooms/${room.id}/facilitator`, {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(await response.json()).toEqual({ room })
})

it('rejects missing, malformed, query-string, and unregistered credentials', async () => {
  const f = await fixture()
  expect((await f.request(f.room.id, null)).status).toBe(401)
  expect((await f.request(f.room.id, 'invalid')).status).toBe(401)
  expect((await f.request(f.room.id, f.token, 'GET')).status).toBe(401)
  expect((await f.app.request(`/api/rooms/${f.room.id}/join?token=${f.token}`, { method: 'POST' })).status).toBe(401)
  expect(await f.db.all(sql`SELECT room_id FROM participants`)).toHaveLength(0)
})

it('does not authorize a participant in another room or grant facilitator access', async () => {
  const f = await fixture()
  await f.request()
  const other = await f.repo.create(['Another'])
  expect((await f.request(other.id, f.token, 'GET')).status).toBe(401)
  const response = await f.app.request(`/api/rooms/${f.room.id}/facilitator`, {
    headers: { Authorization: `Bearer ${f.token}` },
  })
  expect(response.status).toBe(401)
})

it('does not grant participant access merely from possession of the facilitator secret', async () => {
  const f = await fixture()
  const secret = randomBytes(32).toString('base64url')
  const room = await f.repo.create(['A'], hashSecret(secret))
  expect((await f.request(room.id, secret, 'GET')).status).toBe(401)
})

it('rejects missing and expired rooms without creating participants', async () => {
  const f = await fixture()
  expect((await f.request('missing')).status).toBe(404)
  f.expire()
  expect((await f.request()).status).toBe(404)
  expect(await f.db.all(sql`SELECT room_id FROM participants`)).toHaveLength(0)
})

it('denies reads once a joined room expires', async () => {
  const f = await fixture()
  await f.request()
  f.expire()
  expect((await f.request(f.room.id, f.token, 'GET')).status).toBe(404)
})

it('keeps closed rooms readable for existing participants and rejects new joins', async () => {
  const f = await fixture()
  await f.request()
  await f.db.update(rooms).set({ state: 'closed' }).where(eq(rooms.id, f.room.id))
  expect((await f.request(f.room.id, f.token, 'GET')).status).toBe(200)
  expect((await f.request(f.room.id, randomBytes(32).toString('base64url'))).status).toBe(409)
})

it('cascades participant deletion with its room', async () => {
  const f = await fixture()
  await f.request()
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT room_id FROM participants`)).toHaveLength(0)
})
