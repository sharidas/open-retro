import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
import { rooms } from '../src/storage/schema.js'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0 })
async function fixture(enabled = true) {
  const folder = await mkdtemp(join(tmpdir(), 'retro-mood-')); cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'db.sqlite'); const connection = await openDatabase(path); cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now), app = createApp(repo, () => now)
  const facilitator = randomBytes(32).toString('base64url'), participant = randomBytes(32).toString('base64url'), peer = randomBytes(32).toString('base64url')
  const response = await app.request('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns: ['A'], moodCheckIn: enabled }) })
  expect(response.status).toBe(201)
  const created = await response.json(); const room = created.room
  // Use the real creation capability and register two anonymous members.
  await repo.joinParticipant(room.id, hashSecret(participant)); await repo.joinParticipant(room.id, hashSecret(peer))
  const request = (suffix: string, method = 'GET', token: string | null = participant, body?: unknown) => app.request(`/api/rooms/${room.id}${suffix}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const start = () => request('/start-writing', 'POST', created.facilitatorSecret)
  return { ...connection, path, repo, room, participant, peer, facilitator: created.facilitatorSecret as string, unrelated: facilitator, request, start, expire: () => { now = room.expiresAt } }
}
it('keeps answers private, replaces one answer, supports withdrawal, and reveals only aggregates', async () => {
  const f = await fixture()
  expect(f.room.checkIn).toBe('open')
  for (const mood of ['good', 'good', 'low']) expect((await f.request('/mood', 'PUT', f.participant, { mood })).status).toBe(200)
  await f.request('/mood', 'PUT', f.peer, { mood: 'energised' })
  expect(await (await f.request('/mood')).json()).toEqual({ checkIn: 'open', selected: 'low', totals: null })
  expect(await (await f.request('/facilitator/mood', 'GET', f.facilitator)).json()).toEqual({ checkIn: 'open', totals: null })
  await f.request('/mood', 'PUT', f.participant, { mood: null })
  expect((await (await f.request('/mood')).json()).selected).toBeNull()
  await f.start()
  const result = await (await f.request('/facilitator/mood', 'GET', f.facilitator)).json()
  expect(result).toEqual({ checkIn: 'complete', totals: [
    { mood: 'drained', total: 0 }, { mood: 'low', total: 0 }, { mood: 'steady', total: 0 }, { mood: 'good', total: 0 }, { mood: 'energised', total: 1 },
  ] })
  expect(await (await f.request('/mood')).json()).toEqual({ ...result, selected: null })
  expect(await f.db.all(sql`SELECT mood FROM moods`)).toEqual([{ mood: 'energised' }])
})
it('gates writing and reveal until check-in ends, then freezes mood changes through closure', async () => {
  const f = await fixture()
  const card = { columnIndex: 0, text: 'Hello' }
  expect((await f.request('/cards', 'POST', f.participant, card)).status).toBe(409)
  expect(await f.repo.submitCard(f.room.id, hashSecret(f.participant), 0, 'stale request')).toBeUndefined()
  expect((await f.request('/reveal', 'POST', f.facilitator)).status).toBe(409)
  expect(await f.repo.revealRoom(f.room.id, hashSecret(f.facilitator))).toBeUndefined()
  const results = await Promise.all([f.start(), f.start()])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect((await f.request('/cards', 'POST', f.participant, card)).status).toBe(201)
  for (const mood of ['low', null]) expect((await f.request('/mood', 'PUT', f.participant, { mood })).status).toBe(409)
  await f.request('/reveal', 'POST', f.facilitator); await f.request('/close', 'POST', f.facilitator)
  expect((await f.start()).status).toBe(409)
  expect((await f.request('/mood', 'PUT', f.participant, { mood: 'good' })).status).toBe(409)
  expect((await f.request('/mood')).status).toBe(200)
})
it('keeps disabled rooms on the existing writing flow', async () => {
  const f = await fixture(false)
  expect(f.room.checkIn).toBe('off')
  expect((await f.start()).status).toBe(409)
  expect((await f.request('/mood', 'PUT', f.participant, { mood: 'good' })).status).toBe(409)
  expect((await f.request('/cards', 'POST', f.participant, { columnIndex: 0, text: 'Hi' })).status).toBe(201)
})
it.each([null, 'bad', 'participant', 'unrelated'])('rejects invalid facilitator access: %s', async credential => {
  const f = await fixture(); const token = credential === 'participant' ? f.participant : credential === 'unrelated' ? f.unrelated : credential
  expect((await f.request('/start-writing', 'POST', token)).status).toBe(401)
  expect((await f.request('/facilitator/mood', 'GET', token)).status).toBe(401)
})
it('rejects facilitator credentials and cross-room members on participant mood routes', async () => {
  const f = await fixture()
  for (const token of [null, f.facilitator, f.unrelated]) {
    expect((await f.request('/mood', 'GET', token)).status).toBe(401)
    expect((await f.request('/mood', 'PUT', token, { mood: 'good' })).status).toBe(401)
  }
  const other = await f.repo.create(['Other']); await f.repo.joinParticipant(other.id, hashSecret(f.unrelated))
  expect((await f.request('/mood', 'GET', f.unrelated)).status).toBe(401)
})
it.each([{ mood: 'invalid' }, { mood: 1 }, {}, { mood: 'good', participant: 'forged' }])('rejects invalid mood input: %j', async body => {
  const f = await fixture(); expect((await f.request('/mood', 'PUT', f.participant, body)).status).toBe(400)
  expect(await f.db.all(sql`SELECT * FROM moods`)).toEqual([])
})
it('persists check-in and answers across database connections and cascades deletion', async () => {
  const f = await fixture(); await f.request('/mood', 'PUT', f.participant, { mood: 'steady' }); await f.start()
  const second = await openDatabase(f.path)
  try {
    const repo = roomRepository(second.db)
    expect((await repo.find(f.room.id))?.checkIn).toBe('complete')
    expect((await repo.readMood(f.room.id, hashSecret(f.participant)))?.selected).toBe('steady')
  } finally { second.close() }
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT * FROM moods`)).toEqual([])
})
it('rejects expired reads and mutations including expiry during start authorization', async () => {
  const f = await fixture(); const original = f.repo.startWriting.bind(f.repo)
  vi.spyOn(f.repo, 'startWriting').mockImplementationOnce(async (...args) => { f.expire(); return original(...args) })
  expect((await f.start()).status).toBe(409)
  expect((await f.start()).status).toBe(404)
  expect((await f.request('/mood')).status).toBe(404)
  expect((await f.request('/mood', 'PUT', f.participant, { mood: 'good' })).status).toBe(404)
})
it('rejects an answer when check-in ends after participant authorization', async () => {
  const f = await fixture(); const original = f.repo.saveMood.bind(f.repo)
  vi.spyOn(f.repo, 'saveMood').mockImplementationOnce(async (...args) => { await f.repo.startWriting(f.room.id, hashSecret(f.facilitator)); return original(...args) })
  expect((await f.request('/mood', 'PUT', f.participant, { mood: 'good' })).status).toBe(409)
  expect(await f.db.all(sql`SELECT * FROM moods`)).toEqual([])
})
