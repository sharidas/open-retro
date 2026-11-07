import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
import { rooms } from '../src/storage/schema.js'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0 })
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'retro-groups-')); cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'db.sqlite'), connection = await openDatabase(path); cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now), app = createApp(repo, () => now)
  const participant = randomBytes(32).toString('base64url'), peer = randomBytes(32).toString('base64url'), facilitator = randomBytes(32).toString('base64url')
  const room = await repo.create(['A', 'B'], hashSecret(facilitator))
  await repo.joinParticipant(room.id, hashSecret(participant)); await repo.joinParticipant(room.id, hashSecret(peer))
  const a = (await repo.submitCard(room.id, hashSecret(participant), 0, 'One'))!
  const b = (await repo.submitCard(room.id, hashSecret(peer), 1, 'Two'))!
  const request = (body?: unknown, token: string | null = participant, admin = false) => app.request(`/api/rooms/${room.id}/${admin ? 'facilitator/' : ''}groups`, {
    method: body === undefined ? 'GET' : 'PUT', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const reveal = () => repo.revealRoom(room.id, hashSecret(facilitator))
  const group = { id: randomUUID(), name: 'Shared theme', cardIds: [a.id, b.id] }
  return { ...connection, path, repo, app, room, participant, peer, facilitator, a, b, group, request, reveal, expire: () => { now = room.expiresAt } }
}
it('lets participants and facilitators group across columns, rename, move, and ungroup without changing cards or votes', async () => {
  const f = await fixture(); await f.reveal()
  await f.repo.changeVote(f.room.id, hashSecret(f.participant), f.a.id, true)
  const cardsBefore = await f.repo.listRevealedCards(f.room.id), votesBefore = await f.repo.voteTotals(f.room.id)
  expect(await (await f.request()).json()).toEqual({ version: 0, groups: [] })
  expect((await f.request({ version: 0, groups: [f.group] })).status).toBe(200)
  const read = await f.request(undefined, f.facilitator, true)
  expect(read.headers.get('Cache-Control')).toBe('no-store')
  expect(await read.json()).toEqual({ version: 1, groups: [f.group] })
  const renamed = { ...f.group, name: 'Renamed theme' }
  expect((await f.request({ version: 1, groups: [renamed] }, f.facilitator, true)).status).toBe(200)
  const second = { id: randomUUID(), name: 'Other', cardIds: [f.b.id] }
  const split = [{ ...renamed, cardIds: [f.a.id] }, second]
  expect((await f.request({ version: 2, groups: split }, f.peer)).status).toBe(200)
  expect((await f.request({ version: 3, groups: [] }, f.peer)).status).toBe(200)
  expect(await f.repo.listRevealedCards(f.room.id)).toEqual(cardsBefore)
  expect(await f.repo.voteTotals(f.room.id)).toEqual(votesBefore)
})
it('rejects hidden reads and freezes changes after closure while retaining groups', async () => {
  const f = await fixture()
  expect((await f.request()).status).toBe(409)
  expect((await f.request({ version: 0, groups: [f.group] })).status).toBe(409)
  await f.reveal(); await f.request({ version: 0, groups: [f.group] })
  await f.repo.closeRoom(f.room.id, hashSecret(f.facilitator))
  expect((await f.request({ version: 1, groups: [] }, f.facilitator, true)).status).toBe(409)
  expect(await (await f.request()).json()).toEqual({ version: 1, groups: [f.group] })
  f.expire(); expect((await f.request()).status).toBe(404)
})
it('allows only one of two concurrent edits and requires review before retry', async () => {
  const f = await fixture(); await f.reveal()
  const results = await Promise.all([f.request({ version: 0, groups: [f.group] }), f.request({ version: 0, groups: [{ ...f.group, name: 'Peer edit' }] }, f.peer)])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect((await f.request({ version: 0, groups: [] })).status).toBe(409)
  expect((await (await f.request()).json()).version).toBe(1)
})
it('rejects unauthorized and wrong-role credentials', async () => {
  const f = await fixture(); await f.reveal()
  for (const token of [null, 'bad', randomBytes(32).toString('base64url'), f.facilitator]) {
    expect((await f.request(undefined, token)).status).toBe(401)
    expect((await f.request({ version: 0, groups: [f.group] }, token)).status).toBe(401)
  }
  expect((await f.request(undefined, f.participant, true)).status).toBe(401)
})
it('rejects cross-room membership and missing cards without saving a layout', async () => {
  const f = await fixture(); const other = await f.repo.create(['Other'])
  await f.repo.joinParticipant(other.id, hashSecret(f.participant))
  const foreign = (await f.repo.submitCard(other.id, hashSecret(f.participant), 0, 'Private elsewhere'))!
  await f.reveal()
  for (const id of [foreign.id, randomUUID()]) expect((await f.request({ version: 0, groups: [{ ...f.group, cardIds: [id] }] })).status).toBe(409)
  expect(await (await f.request()).json()).toEqual({ version: 0, groups: [] })
})
it.each(['duplicate-card', 'duplicate-group', 'empty', 'blank-name', 'long-name', 'extra-field', 'bad-version'])('rejects invalid grouping: %s', async problem => {
  const f = await fixture(); await f.reveal()
  let body: unknown = { version: 0, groups: [f.group] }
  if (problem === 'duplicate-card') body = { version: 0, groups: [f.group, { ...f.group, id: randomUUID() }] }
  if (problem === 'duplicate-group') body = { version: 0, groups: [{ ...f.group, cardIds: [f.a.id] }, { ...f.group, cardIds: [f.b.id] }] }
  if (problem === 'empty') body = { version: 0, groups: [{ ...f.group, cardIds: [] }] }
  if (problem === 'blank-name') body = { version: 0, groups: [{ ...f.group, name: ' ' }] }
  if (problem === 'long-name') body = { version: 0, groups: [{ ...f.group, name: 'a'.repeat(81) }] }
  if (problem === 'extra-field') body = { version: 0, groups: [f.group], owner: 'forged' }
  if (problem === 'bad-version') body = { version: -1, groups: [f.group] }
  expect((await f.request(body)).status).toBe(400)
  expect(await (await f.request()).json()).toEqual({ version: 0, groups: [] })
})
it.each(['closure', 'expiry', 'capability'])('rechecks %s during the atomic write', async change => {
  const f = await fixture(); await f.reveal(); const original = f.repo.replaceGroups.bind(f.repo)
  vi.spyOn(f.repo, 'replaceGroups').mockImplementationOnce(async (...args) => {
    if (change === 'closure') await f.repo.closeRoom(f.room.id, hashSecret(f.facilitator))
    if (change === 'expiry') f.expire()
    if (change === 'capability') await f.db.update(rooms).set({ facilitatorSecretHash: hashSecret('replacement') }).where(eq(rooms.id, f.room.id))
    return original(...args)
  })
  expect((await f.request({ version: 0, groups: [f.group] }, f.facilitator, true)).status).toBe(409)
  expect(await f.db.all(sql`SELECT * FROM room_grouping`)).toEqual([])
})
it('persists across connections and cascades with room deletion', async () => {
  const f = await fixture(); await f.reveal(); await f.request({ version: 0, groups: [f.group] })
  const second = await openDatabase(f.path)
  try { expect(await roomRepository(second.db).readGroups(f.room.id)).toEqual({ version: 1, groups: [f.group] }) } finally { second.close() }
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT * FROM room_grouping`)).toEqual([])
})
