import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
import { cards, rooms } from '../src/storage/schema.js'
import type { PrivateCard } from '../src/storage/cards.js'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.reverse()) await dispose()
  cleanup.length = 0
})
async function fixture(revealed = true) {
  const folder = await mkdtemp(join(tmpdir(), 'open-retro-votes-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'rooms.sqlite')
  const connection = await openDatabase(path)
  cleanup.push(connection.close)
  let now = Date.now()
  const clock = () => now
  const repo = roomRepository(connection.db, clock)
  const app = createApp(repo, clock)
  const owner = randomBytes(32).toString('base64url')
  const other = randomBytes(32).toString('base64url')
  const facilitator = randomBytes(32).toString('base64url')
  const room = await repo.create(['A'], hashSecret(facilitator))
  await repo.joinParticipant(room.id, hashSecret(owner))
  await repo.joinParticipant(room.id, hashSecret(other))
  const saved: PrivateCard[] = []
  for (let index = 0; index < 5; index++) {
    saved.push((await repo.submitCard(room.id, hashSecret(owner), 0, `Card ${index + 1}`))!)
  }
  if (revealed) await repo.revealRoom(room.id, hashSecret(facilitator))
  const change = (cardId = saved[0].id, method = 'PUT', token: string | null = owner, id = room.id) =>
    app.request(`/api/rooms/${id}/cards/${cardId}/vote`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const read = (token = owner, admin = false, id = room.id) =>
    app.request(`/api/rooms/${id}/${admin ? 'facilitator/' : ''}votes`, { headers: { Authorization: `Bearer ${token}` } })
  return { ...connection, path, repo, app, room, owner, other, facilitator, saved, change, read, clock, expire: () => { now = room.expiresAt } }
}

it('adds one anonymous vote and returns only totals plus the caller’s own selection', async () => {
  const f = await fixture()
  const response = await f.change()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ vote: { cardId: f.saved[0].id, total: 1, selected: true }, voteLimit: 3, remainingVotes: 2 })
  const mine = await (await f.read()).json()
  const theirs = await (await f.read(f.other)).json()
  const admin = await (await f.read(f.facilitator, true)).json()
  expect(mine.remainingVotes).toBe(2)
  expect(theirs.remainingVotes).toBe(3)
  expect(mine.votes.find((vote: { cardId: string }) => vote.cardId === f.saved[0].id)).toEqual({ cardId: f.saved[0].id, total: 1, selected: true })
  expect(theirs.votes.find((vote: { cardId: string }) => vote.cardId === f.saved[0].id)).toEqual({ cardId: f.saved[0].id, total: 1, selected: false })
  expect(Object.keys(admin)).toEqual(['votes'])
  expect(admin.votes).toHaveLength(5)
  for (const vote of admin.votes) expect(Object.keys(vote).sort()).toEqual(['cardId', 'total'])
  const stored = await f.db.all(sql`SELECT voter_hash FROM votes`)
  expect(stored).toEqual([{ voter_hash: hashSecret(f.owner) }])
  expect(JSON.stringify(stored)).not.toContain(f.owner)
})

it('makes duplicate PUT and DELETE requests idempotent', async () => {
  const f = await fixture()
  for (let i = 0; i < 3; i++) expect((await f.change()).status).toBe(200)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(1)
  for (let i = 0; i < 3; i++) {
    const response = await f.change(f.saved[0].id, 'DELETE')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ vote: { cardId: f.saved[0].id, total: 0, selected: false }, remainingVotes: 3, voteLimit: 3 })
  }
})

it('enforces the budget, permits retries at the limit, and reuses a removed vote slot', async () => {
  const f = await fixture()
  for (const card of f.saved.slice(0, 3)) expect((await f.change(card.id)).status).toBe(200)
  const rejected = await f.change(f.saved[3].id)
  expect(rejected.status).toBe(409)
  expect(await rejected.json()).toEqual({ error: 'VOTE_BUDGET_EXCEEDED', voteLimit: 3 })
  expect((await f.change(f.saved[0].id)).status).toBe(200)
  await f.change(f.saved[1].id, 'DELETE')
  expect((await f.change(f.saved[3].id)).status).toBe(200)
  expect((await (await f.read()).json()).remainingVotes).toBe(0)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(3)
})

it('keeps budgets independent and never removes another participant’s vote', async () => {
  const f = await fixture()
  await f.change()
  const untouched = await f.change(f.saved[0].id, 'DELETE', f.other)
  expect((await untouched.json()).vote.total).toBe(1)
  await f.change(f.saved[0].id, 'PUT', f.other)
  const removed = await f.change(f.saved[0].id, 'DELETE')
  expect((await removed.json()).vote).toEqual({ cardId: f.saved[0].id, total: 1, selected: false })
  expect((await (await f.read(f.other)).json()).remainingVotes).toBe(2)
})

it('caps concurrent votes on different cards at three without server errors', async () => {
  const f = await fixture()
  const responses = await Promise.all(f.saved.map((card) => f.change(card.id)))
  expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 409, 409])
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(3)
  expect((await (await f.read()).json()).remainingVotes).toBe(0)
})

it('does not inflate totals from concurrent duplicate requests', async () => {
  const f = await fixture()
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.change()))
  expect(responses.every((response) => response.status === 200)).toBe(true)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(1)
  expect((await (await f.read()).json()).remainingVotes).toBe(2)
})

it('enforces the budget across independent SQLite connections', async () => {
  const f = await fixture()
  const second = await openDatabase(f.path)
  try {
    const otherRepo = roomRepository(second.db, f.clock)
    const results = await Promise.all(f.saved.map((card, index) =>
      (index % 2 ? otherRepo : f.repo).changeVote(f.room.id, hashSecret(f.owner), card.id, true)))
    expect(results.filter((result) => result.kind === 'ok')).toHaveLength(3)
    expect(results.filter((result) => result.kind === 'budget')).toHaveLength(2)
    expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(3)
  } finally { second.close() }
})

it('enforces per-card uniqueness and the three-slot budget even on direct database writes', async () => {
  const f = await fixture()
  for (const card of f.saved.slice(0, 3)) await f.change(card.id)
  const insert = (cardId: string, slot: number, voterHash = hashSecret(f.owner), roomId = f.room.id) => f.db.run(sql`
    INSERT INTO votes (room_id, voter_hash, card_id, slot) VALUES (${roomId}, ${voterHash}, ${cardId}, ${slot})`)
  await expect(insert(f.saved[3].id, 4)).rejects.toThrow()
  await expect(insert(f.saved[3].id, 1)).rejects.toThrow()
  await expect(insert(f.saved[0].id, 2)).rejects.toThrow()
  await expect(insert(f.saved[3].id, 1, hashSecret('unregistered'))).rejects.toThrow()
})

it.each(['writing', 'closed'] as const)('rejects vote changes in %s', async (state) => {
  const f = await fixture(state !== 'writing')
  if (state === 'closed') {
    await f.change()
    await f.db.update(rooms).set({ state }).where(eq(rooms.id, f.room.id))
  }
  for (const method of ['PUT', 'DELETE']) expect((await f.change(f.saved[0].id, method)).status).toBe(409)
  if (state === 'writing') {
    expect((await f.read()).status).toBe(409)
    expect((await f.read(f.facilitator, true)).status).toBe(409)
  } else {
    expect((await f.read()).status).toBe(200)
    expect((await f.read(f.facilitator, true)).status).toBe(200)
  }
})

it('rejects missing, malformed, unregistered, and facilitator credentials for participant voting', async () => {
  const f = await fixture()
  for (const token of [null, 'bad', randomBytes(32).toString('base64url'), f.facilitator]) {
    expect((await f.change(f.saved[0].id, 'PUT', token)).status).toBe(401)
    expect((await f.change(f.saved[0].id, 'DELETE', token)).status).toBe(401)
  }
  expect((await f.read(f.owner, true)).status).toBe(401)
  const query = await f.app.request(`/api/rooms/${f.room.id}/cards/${f.saved[0].id}/vote?token=${f.owner}`, { method: 'PUT' })
  expect(query.status).toBe(401)
})

it('prevents cross-room card voting and keeps budgets and totals room-scoped', async () => {
  const f = await fixture()
  const other = await f.repo.create(['Other room'])
  await f.repo.joinParticipant(other.id, hashSecret(f.owner))
  const card = (await f.repo.submitCard(other.id, hashSecret(f.owner), 0, 'Other room card'))!
  await f.db.update(rooms).set({ state: 'revealed' }).where(eq(rooms.id, other.id))
  for (const method of ['PUT', 'DELETE']) {
    expect((await f.change(card.id, method)).status).toBe(404)
    expect((await f.change(f.saved[0].id, method, f.owner, other.id)).status).toBe(404)
  }
  expect((await f.change('missing')).status).toBe(404)
  for (const own of f.saved.slice(0, 3)) await f.change(own.id)
  expect((await f.change(card.id, 'PUT', f.owner, other.id)).status).toBe(200)
  expect((await (await f.read(f.owner, false, other.id)).json()).remainingVotes).toBe(2)
})

it('denies expired vote mutations and reads without changing saved votes', async () => {
  const f = await fixture()
  await f.change()
  f.expire()
  expect((await f.change()).status).toBe(404)
  expect((await f.change(f.saved[0].id, 'DELETE')).status).toBe(404)
  expect((await f.read()).status).toBe(404)
  expect((await f.read(f.facilitator, true)).status).toBe(404)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(1)
})

it.each(['PUT', 'DELETE'])('%s rechecks phase inside the transaction after stale API authorization', async (method) => {
  const f = await fixture()
  if (method === 'DELETE') await f.change()
  const original = f.repo.changeVote.bind(f.repo)
  vi.spyOn(f.repo, 'changeVote').mockImplementationOnce(async (...args) => {
    await f.db.update(rooms).set({ state: 'closed' }).where(eq(rooms.id, f.room.id))
    return original(...args)
  })
  expect((await f.change(f.saved[0].id, method)).status).toBe(404)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(method === 'DELETE' ? 1 : 0)
})

it('rechecks expiry inside the vote operation', async () => {
  const f = await fixture()
  const original = f.repo.changeVote.bind(f.repo)
  vi.spyOn(f.repo, 'changeVote').mockImplementationOnce(async (...args) => { f.expire(); return original(...args) })
  expect((await f.change()).status).toBe(404)
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(0)
})

it('persists voting snapshots across reopen and cascades room deletion', async () => {
  const f = await fixture()
  await f.change()
  const second = await openDatabase(f.path)
  try {
    const snapshot = await roomRepository(second.db, f.clock).myVoting(f.room.id, hashSecret(f.owner))
    expect(snapshot.remainingVotes).toBe(2)
    expect(snapshot.votes.find((vote) => vote.cardId === f.saved[0].id)?.selected).toBe(true)
  } finally { second.close() }
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(0)
})

it('cascades votes when their card is removed', async () => {
  const f = await fixture()
  await f.change()
  await f.db.delete(cards).where(eq(cards.id, f.saved[0].id))
  expect(await f.db.all(sql`SELECT card_id FROM votes`)).toHaveLength(0)
})

it('derives the voter from authorization rather than a supplied body', async () => {
  const f = await fixture()
  const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${f.saved[0].id}/vote`, {
    method: 'PUT', headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterHash: hashSecret(f.other), slot: 100 }),
  })
  expect(response.status).toBe(200)
  expect((await (await f.read()).json()).remainingVotes).toBe(2)
  expect((await (await f.read(f.other)).json()).remainingVotes).toBe(3)
})

it('returns safe empty snapshots when a revealed board has no cards', async () => {
  const f = await fixture()
  await f.db.delete(cards).where(eq(cards.roomId, f.room.id))
  expect(await (await f.read()).json()).toEqual({ votes: [], voteLimit: 3, remainingVotes: 3 })
  expect(await (await f.read(f.facilitator, true)).json()).toEqual({ votes: [] })
})

it('enforces card room membership through a composite foreign key', async () => {
  const f = await fixture()
  const otherRoom = await f.repo.create(['Other'])
  await f.repo.joinParticipant(otherRoom.id, hashSecret(f.owner))
  const card = (await f.repo.submitCard(otherRoom.id, hashSecret(f.owner), 0, 'Other room'))!
  await expect(f.db.run(sql`INSERT INTO votes (room_id, voter_hash, card_id, slot)
    VALUES (${f.room.id}, ${hashSecret(f.owner)}, ${card.id}, 1)`)).rejects.toThrow()
})
