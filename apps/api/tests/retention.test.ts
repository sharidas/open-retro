import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
const disposers: (() => unknown)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposers.reverse()) await dispose(); disposers.length = 0 })
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'retro-retention-'))
  disposers.push(() => rm(folder, { recursive: true, force: true }))
  const connection = await openDatabase(join(folder, 'db.sqlite')); disposers.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now), app = createApp(repo, () => now)
  const secret = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url')
  const room = await repo.create(['A'], hashSecret(secret), undefined, true)
  await repo.joinParticipant(room.id, hashSecret(token))
  await repo.saveMood(room.id, hashSecret(token), 'good')
  await repo.startWriting(room.id, hashSecret(secret))
  await repo.setReady(room.id, hashSecret(token), true)
  await repo.changeTimer(room.id, hashSecret(secret), { action: 'start', version: 0, seconds: 60 })
  const card = await repo.submitCard(room.id, hashSecret(token), 0, 'Temporary retro data')
  const request = (suffix = '/facilitator', method = 'DELETE', credential: string | null = secret) => app.request(`/api/rooms/${room.id}${suffix}`, {
    method, headers: credential ? { Authorization: `Bearer ${credential}` } : {},
  })
  return { ...connection, repo, app, room, card: card!, secret, token, request, expire: () => { now = room.expiresAt } }
}
const tables = ['rooms', 'participants', 'cards', 'votes', 'moods', 'room_grouping', 'writing_timers']
it.each([null, 'bad', 'x'.repeat(43), 'participant'])('rejects deletion with credential %s', async credential => {
  const f = await fixture()
  expect((await f.request('/facilitator', 'DELETE', credential === 'participant' ? f.token : credential)).status).toBe(401)
  expect(await f.repo.find(f.room.id)).toBeDefined()
})
it('rejects a facilitator from a different room', async () => {
  const f = await fixture(), other = randomBytes(32).toString('base64url')
  await f.repo.create(['B'], hashSecret(other))
  expect((await f.request('/facilitator', 'DELETE', other)).status).toBe(401)
})
it.each(['writing', 'revealed', 'closed'])('deletes a %s room and all related records', async phase => {
  const f = await fixture()
  if (phase !== 'writing') {
    await f.repo.revealRoom(f.room.id, hashSecret(f.secret))
    await f.repo.changeVote(f.room.id, hashSecret(f.token), f.card.id, true)
    await f.db.$client.execute({ sql: 'INSERT INTO room_grouping(room_id, version, groups) VALUES (?, 1, ?)', args: [f.room.id, JSON.stringify([{ id: randomUUID(), name: 'Theme', cardIds: [f.card.id] }])] })
    if (phase === 'closed') await f.repo.closeRoom(f.room.id, hashSecret(f.secret))
  }
  const result = await f.request()
  expect(result.status).toBe(204); expect(result.headers.get('Cache-Control')).toBe('no-store')
  for (const table of tables) expect((await f.db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n).toBe(0)
  for (const [suffix, method, credential] of [['/facilitator', 'GET', f.secret], ['/cards', 'GET', f.token], ['/join', 'POST', f.token]]) {
    expect([401, 404]).toContain((await f.request(suffix, method, credential)).status)
  }
  expect((await f.request()).status).toBe(401)
})
it('denies expired access before cleanup and preserves unexpired rooms', async () => {
  const f = await fixture(); f.expire()
  const live = await f.repo.create(['Still active'])
  expect((await f.request()).status).toBe(404)
  expect((await f.request('/cards', 'GET', f.token)).status).toBe(404)
  expect(await f.repo.cleanupExpired()).toBe(1)
  expect(await f.repo.cleanupExpired()).toBe(0)
  expect(await f.repo.find(live.id)).toBeDefined()
  for (const table of tables.slice(1)) expect((await f.db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n).toBe(0)
})
it.each(['expiry', 'capability'])('rechecks %s atomically after authorization', async change => {
  const f = await fixture(), original = f.repo.deleteRoom.bind(f.repo)
  vi.spyOn(f.repo, 'deleteRoom').mockImplementationOnce(async (...args) => {
    if (change === 'expiry') f.expire()
    else await f.db.$client.execute({ sql: 'UPDATE rooms SET facilitator_secret_hash = ? WHERE id = ?', args: [hashSecret('replacement'), f.room.id] })
    return original(...args)
  })
  expect((await f.request()).status).toBe(409); expect(await f.repo.find(f.room.id)).toBeDefined()
})
it('bounds cleanup batches and drains the backlog on subsequent runs', async () => {
  const f = await fixture()
  for (let i = 0; i < 101; i++) await f.repo.create(['Old'])
  f.expire()
  expect(await f.repo.cleanupExpired()).toBe(100)
  expect(await f.repo.cleanupExpired()).toBe(2)
  expect(await f.repo.cleanupExpired()).toBe(0)
})

it.each(['deleted', 'expired'])('rejects joining a room that becomes %s during authorization', async change => {
  const f = await fixture(), original = f.repo.joinParticipant.bind(f.repo)
  vi.spyOn(f.repo, 'joinParticipant').mockImplementationOnce(async (...args) => {
    if (change === 'deleted') await f.repo.deleteRoom(f.room.id, hashSecret(f.secret))
    else f.expire()
    return original(...args)
  })
  expect((await f.request('/join', 'POST', f.token)).status).toBe(404)
})
