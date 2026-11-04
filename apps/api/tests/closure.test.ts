import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
import { rooms } from '../src/storage/schema.js'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.reverse()) await dispose()
  cleanup.length = 0
})
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'retro-close-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'db.sqlite')
  const connection = await openDatabase(path)
  cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now)
  const app = createApp(repo, () => now)
  const facilitator = randomBytes(32).toString('base64url')
  const participant = randomBytes(32).toString('base64url')
  const room = await repo.create(['A'], hashSecret(facilitator))
  await repo.joinParticipant(room.id, hashSecret(participant))
  const request = (suffix: string, method = 'GET', token: string | null = facilitator, body?: unknown) =>
    app.request(`/api/rooms/${room.id}${suffix}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { ...connection, path, repo, room, request, facilitator, participant, expire: () => { now = room.expiresAt } }
}
it.each([null, 'bad', 'x'.repeat(43), 'participant', 'other-room'])('rejects unauthorized closure: %s', async (credential) => {
  const f = await fixture()
  await f.request('/reveal', 'POST')
  let token = credential
  if (credential === 'participant') token = f.participant
  if (credential === 'other-room') {
    token = randomBytes(32).toString('base64url')
    await f.repo.create(['Other'], hashSecret(token))
  }
  expect((await f.request('/close', 'POST', token)).status).toBe(401)
  expect((await f.repo.find(f.room.id))?.state).toBe('revealed')
})
it('rejects skipping reveal, permits one concurrent closure, and persists it', async () => {
  const f = await fixture()
  expect((await f.request('/close', 'POST')).status).toBe(409)
  await f.request('/reveal', 'POST')
  const results = await Promise.all([f.request('/close', 'POST'), f.request('/close', 'POST')])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const success = results.find(r => r.status === 200)!
  expect(success.headers.get('Cache-Control')).toBe('no-store')
  expect(await success.json()).toEqual({ room: { ...f.room, state: 'closed' } })
  expect((await f.request('/close', 'POST')).status).toBe(409)
  expect((await f.request('/reveal', 'POST')).status).toBe(409)
  const second = await openDatabase(f.path)
  try { expect((await roomRepository(second.db).find(f.room.id))?.state).toBe('closed') }
  finally { second.close() }
})
it('freezes cards and votes but retains final reads for existing participants and facilitators', async () => {
  const f = await fixture()
  const { card } = await (await f.request('/cards', 'POST', f.participant, { columnIndex: 0, text: 'Discuss this' })).json()
  await f.request('/reveal', 'POST')
  expect((await f.request(`/cards/${card.id}/vote`, 'PUT', f.participant)).status).toBe(200)
  await f.request('/close', 'POST')
  for (const method of ['PUT', 'DELETE']) expect((await f.request(`/cards/${card.id}/vote`, method, f.participant)).status).toBe(409)
  expect((await f.request('/cards', 'POST', f.participant, { columnIndex: 0, text: 'Late' })).status).toBe(409)
  for (const method of ['PATCH', 'DELETE']) expect((await f.request(`/cards/${card.id}`, method, f.participant, { text: 'Late' })).status).toBe(409)
  expect(await (await f.request('/revealed-cards', 'GET', f.participant)).json()).toEqual({ cards: [card] })
  expect(await (await f.request('/facilitator/cards')).json()).toEqual({ cards: [card] })
  expect(await (await f.request('/facilitator/votes')).json()).toEqual({ votes: [{ cardId: card.id, total: 1 }] })
  expect((await (await f.request('/votes', 'GET', f.participant)).json()).remainingVotes).toBe(2)
  expect((await f.request('/join', 'POST', randomBytes(32).toString('base64url'))).status).toBe(409)
  f.expire()
  expect((await f.request('/facilitator/cards')).status).toBe(404)
  expect((await f.request('/votes', 'GET', f.participant)).status).toBe(404)
})
it('rejects expired closure', async () => {
  const f = await fixture(); await f.request('/reveal', 'POST'); f.expire()
  expect((await f.request('/close', 'POST')).status).toBe(404)
})
it.each(['expiry', 'capability'])('rechecks %s atomically after authorization', async (change) => {
  const f = await fixture(); await f.request('/reveal', 'POST')
  const original = f.repo.closeRoom.bind(f.repo)
  vi.spyOn(f.repo, 'closeRoom').mockImplementationOnce(async (...args) => {
    if (change === 'expiry') f.expire()
    else await f.db.update(rooms).set({ facilitatorSecretHash: hashSecret('replacement') }).where(eq(rooms.id, f.room.id))
    return original(...args)
  })
  expect((await f.request('/close', 'POST')).status).toBe(409)
  expect((await f.repo.find(f.room.id))?.state).toBe('revealed')
})
