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
async function fixture(checkIn = false) {
  const folder = await mkdtemp(join(tmpdir(), 'retro-progress-')); cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'db.sqlite'), connection = await openDatabase(path); cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now), app = createApp(repo, () => now)
  const participant = randomBytes(32).toString('base64url'), peer = randomBytes(32).toString('base64url'), facilitator = randomBytes(32).toString('base64url')
  const room = await repo.create(['A'], hashSecret(facilitator), undefined, checkIn)
  await repo.joinParticipant(room.id, hashSecret(participant)); await repo.joinParticipant(room.id, hashSecret(peer))
  const request = (suffix: string, body?: unknown, token: string | null = participant) => app.request(`/api/rooms/${room.id}/${suffix}`, {
    method: body === undefined ? 'GET' : 'PUT', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const timer = (body: unknown) => request('facilitator/timer', body, facilitator)
  const read = async () => (await request('facilitator/writing-progress', undefined, facilitator)).json()
  return { ...connection, path, repo, room, participant, peer, facilitator, request, timer, read, now: () => now, advance: (ms: number) => { now += ms }, expire: () => { now = room.expiresAt } }
}
it('keeps readiness counts facilitator-only, supports undo, and does not reset readiness on rejoin', async () => {
  const f = await fixture()
  expect(await (await f.request('writing-progress')).json()).toEqual({ serverNow: f.now(), timer: { version: 0, status: 'idle', endsAt: null, remainingMs: 0 }, ownReady: false })
  for (let i = 0; i < 2; i++) expect((await f.request('ready', { ready: true })).status).toBe(200)
  await f.repo.joinParticipant(f.room.id, hashSecret(f.participant))
  expect(await f.read()).toMatchObject({ joinedCount: 2, readyCount: 1 })
  const peer = await (await f.request('writing-progress', undefined, f.peer)).json()
  expect(peer.ownReady).toBe(false); expect(Object.keys(peer).sort()).toEqual(['ownReady', 'serverNow', 'timer'])
  expect(Object.keys(await f.read()).sort()).toEqual(['joinedCount', 'readyCount', 'serverNow', 'timer'])
  await f.request('ready', { ready: false }); expect((await f.read()).readyCount).toBe(0)
})
it('starts, pauses, extends, and resumes using server time', async () => {
  const f = await fixture()
  expect((await f.timer({ version: 0, action: 'start', seconds: 300 })).status).toBe(200)
  expect((await f.read()).timer.endsAt).toBe(f.now() + 300000)
  f.advance(30000)
  expect((await f.timer({ version: 1, action: 'pause' })).status).toBe(200)
  expect((await f.read()).timer).toEqual({ version: 2, status: 'paused', endsAt: null, remainingMs: 270000 })
  f.advance(60000)
  await f.timer({ version: 2, action: 'extend', seconds: 60 })
  expect((await f.read()).timer.remainingMs).toBe(330000)
  await f.timer({ version: 3, action: 'resume' })
  expect((await f.read()).timer.endsAt).toBe(f.now() + 330000)
  await f.timer({ version: 4, action: 'extend', seconds: 60 })
  expect((await f.read()).timer.endsAt).toBe(f.now() + 390000)
})
it('does not reveal or lock writing when time expires; allows extension or restart', async () => {
  const f = await fixture(); await f.timer({ version: 0, action: 'start', seconds: 1 }); f.advance(2000)
  expect((await f.repo.find(f.room.id))?.state).toBe('writing')
  expect(await f.repo.submitCard(f.room.id, hashSecret(f.participant), 0, 'Still writing')).toBeDefined()
  expect((await f.request('ready', { ready: true })).status).toBe(200)
  expect((await f.timer({ version: 1, action: 'pause' })).status).toBe(409)
  expect((await f.timer({ version: 1, action: 'extend', seconds: 30 })).status).toBe(200)
  expect((await f.read()).timer.endsAt).toBe(f.now() + 30000)
  f.advance(31000); await f.timer({ version: 2, action: 'start', seconds: 60 })
  expect((await f.read()).timer.endsAt).toBe(f.now() + 60000)
})
it('rejects concurrent/stale timer commands and invalid transitions', async () => {
  const f = await fixture()
  expect((await f.timer({ version: 0, action: 'resume' })).status).toBe(409)
  const results = await Promise.all([f.timer({ version: 0, action: 'start', seconds: 300 }), f.timer({ version: 0, action: 'start', seconds: 600 })])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect((await f.timer({ version: 0, action: 'pause' })).status).toBe(409)
  expect((await f.timer({ version: 1, action: 'start', seconds: 30 })).status).toBe(409)
})
it('caps remaining time at an hour and rejects malformed duration inputs', async () => {
  const f = await fixture()
  for (const seconds of [0, -1, 3601, 1.5, '60']) expect((await f.timer({ version: 0, action: 'start', seconds })).status).toBe(400)
  await f.timer({ version: 0, action: 'start', seconds: 3600 })
  expect((await f.timer({ version: 1, action: 'extend', seconds: 1 })).status).toBe(409)
  for (const body of [{ ready: 1 }, { ready: true, token: 'other' }, {}]) expect((await f.request('ready', body)).status).toBe(400)
})
it('enforces role and room boundaries', async () => {
  const f = await fixture(), foreign = randomBytes(32).toString('base64url')
  const other = await f.repo.create(['Other']); await f.repo.joinParticipant(other.id, hashSecret(foreign))
  for (const token of [null, 'bad', foreign, f.facilitator]) {
    expect((await f.request('writing-progress', undefined, token)).status).toBe(401)
    expect((await f.request('ready', { ready: true }, token)).status).toBe(401)
  }
  for (const token of [null, foreign, f.participant]) {
    expect((await f.request('facilitator/writing-progress', undefined, token)).status).toBe(401)
    expect((await f.request('facilitator/timer', { version: 0, action: 'start', seconds: 60 }, token)).status).toBe(401)
  }
})
it('blocks check-in and revealed/closed state updates and denies expiry', async () => {
  const f = await fixture(true)
  expect((await f.request('writing-progress')).status).toBe(409)
  expect((await f.timer({ version: 0, action: 'start', seconds: 60 })).status).toBe(409)
  expect((await f.request('ready', { ready: true })).status).toBe(409)
  await f.repo.startWriting(f.room.id, hashSecret(f.facilitator)); await f.timer({ version: 0, action: 'start', seconds: 60 })
  await f.repo.revealRoom(f.room.id, hashSecret(f.facilitator))
  expect((await f.request('writing-progress')).status).toBe(409)
  expect((await f.timer({ version: 1, action: 'pause' })).status).toBe(409)
  expect((await f.request('ready', { ready: true })).status).toBe(409)
  await f.repo.closeRoom(f.room.id, hashSecret(f.facilitator))
  expect((await f.request('ready', { ready: true })).status).toBe(409)
  f.expire(); expect((await f.request('writing-progress')).status).toBe(404)
})
it.each(['expiry', 'reveal', 'capability'])('atomically rechecks %s for timer writes', async change => {
  const f = await fixture(), original = f.repo.changeTimer.bind(f.repo)
  vi.spyOn(f.repo, 'changeTimer').mockImplementationOnce(async (...args) => {
    if (change === 'expiry') f.expire()
    if (change === 'reveal') await f.repo.revealRoom(f.room.id, hashSecret(f.facilitator))
    if (change === 'capability') await f.db.update(rooms).set({ facilitatorSecretHash: hashSecret('replacement') }).where(eq(rooms.id, f.room.id))
    return original(...args)
  })
  expect((await f.timer({ version: 0, action: 'start', seconds: 60 })).status).toBe(409)
  expect(await f.db.all(sql`SELECT * FROM writing_timers`)).toEqual([])
})
it('rejects readiness when reveal happens after authorization', async () => {
  const f = await fixture(), original = f.repo.setReady.bind(f.repo)
  vi.spyOn(f.repo, 'setReady').mockImplementationOnce(async (...args) => { await f.repo.revealRoom(f.room.id, hashSecret(f.facilitator)); return original(...args) })
  expect((await f.request('ready', { ready: true })).status).toBe(409)
})
it('persists timer and readiness across connections and cascades room deletion', async () => {
  const f = await fixture(); await f.timer({ version: 0, action: 'start', seconds: 60 }); await f.request('ready', { ready: true })
  const second = await openDatabase(f.path)
  try { expect(await roomRepository(second.db).readWritingProgress(f.room.id)).toMatchObject({ readyCount: 1, joinedCount: 2, timer: { version: 1, status: 'running', endsAt: f.now() + 60000 } }) } finally { second.close() }
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT * FROM writing_timers`)).toEqual([])
  expect(await f.db.all(sql`SELECT * FROM participants`)).toEqual([])
})
