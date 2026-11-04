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
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.reverse()) await dispose()
  cleanup.length = 0
})
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'open-retro-cards-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'rooms.sqlite')
  const connection = await openDatabase(path)
  cleanup.push(connection.close)
  let now = Date.now()
  const repo = roomRepository(connection.db, () => now)
  const app = createApp(repo, () => now)
  const owner = randomBytes(32).toString('base64url')
  const other = randomBytes(32).toString('base64url')
  const facilitator = randomBytes(32).toString('base64url')
  const room = await repo.create(['A', 'B', 'C'], hashSecret(facilitator))
  await repo.joinParticipant(room.id, hashSecret(owner))
  await repo.joinParticipant(room.id, hashSecret(other))
  const submit = (body: unknown = { columnIndex: 0, text: ' Private thought ' }, token: string | null = owner, id = room.id) =>
    app.request(`/api/rooms/${id}/cards`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  const read = (token = owner, id = room.id, admin = false) => app.request(`/api/rooms/${id}${admin ? '/facilitator' : ''}/cards`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { ...connection, path, app, repo, room, owner, other, facilitator, submit, read, expire: () => { now = room.expiresAt } }
}

it('creates a private card with safe fields and retrieves only the owner’s cards', async () => {
  const f = await fixture()
  const response = await f.submit()
  expect(response.status).toBe(201)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const { card } = await response.json()
  expect(card).toEqual({ id: expect.any(String), columnIndex: 0, text: 'Private thought' })
  const own = await f.read()
  expect(await own.json()).toEqual({ cards: [card] })
  expect(await (await f.read(f.other)).json()).toEqual({ cards: [] })
  expect(await (await f.read(f.facilitator, f.room.id, true)).json()).toEqual({ cards: [] })
  const stored = await f.db.all(sql`SELECT owner_hash FROM cards`)
  expect(stored).toEqual([{ owner_hash: hashSecret(f.owner) }])
  expect(JSON.stringify(stored)).not.toContain(f.owner)
})

it('keeps multiple owners and rooms separate, ignoring owner filters supplied by clients', async () => {
  const f = await fixture()
  const a = await (await f.submit()).json()
  const b = await (await f.submit({ columnIndex: 1, text: 'Other private thought' }, f.other)).json()
  const another = await f.repo.create(['Another'])
  await f.repo.joinParticipant(another.id, hashSecret(f.owner))
  const c = await (await f.submit({ columnIndex: 0, text: 'Another room' }, f.owner, another.id)).json()
  expect(await (await f.read()).json()).toEqual({ cards: [a.card] })
  expect(await (await f.read(f.other)).json()).toEqual({ cards: [b.card] })
  expect(await (await f.read(f.owner, another.id)).json()).toEqual({ cards: [c.card] })
  const forged = await f.app.request(`/api/rooms/${f.room.id}/cards?ownerHash=${hashSecret(f.other)}&cardId=${b.card.id}`, {
    headers: { Authorization: `Bearer ${f.owner}` },
  })
  expect(await forged.json()).toEqual({ cards: [a.card] })
  expect((await f.app.request(`/api/rooms/${f.room.id}/cards/${b.card.id}`, {
    headers: { Authorization: `Bearer ${f.owner}` },
  })).status).toBe(404)
})

it.each([
  { columnIndex: -1, text: 'A' }, { columnIndex: 3, text: 'A' },
  { columnIndex: 5, text: 'A' }, { columnIndex: 0.5, text: 'A' },
  { columnIndex: '0', text: 'A' }, { columnIndex: 0, text: ' \n\t' },
  { columnIndex: 0, text: 'A'.repeat(2001) }, { columnIndex: 0, text: 42 }, {}, null,
  { columnIndex: 0, text: 'A', ownerHash: 'forged' },
  { columnIndex: 0, text: 'A', roomId: 'forged' },
])('rejects invalid card input without a write: %#', async (body) => {
  const f = await fixture()
  expect((await f.submit(body)).status).toBe(400)
  expect(await f.db.all(sql`SELECT id FROM cards`)).toHaveLength(0)
})

it('accepts the fifth column and maximum text length; stores HTML and SQL-like text as data', async () => {
  const f = await fixture()
  const room = await f.repo.create(['A', 'B', 'C', 'D', 'E'])
  await f.repo.joinParticipant(room.id, hashSecret(f.owner))
  expect((await f.submit({ columnIndex: 4, text: 'A'.repeat(2000) }, f.owner, room.id)).status).toBe(201)
  const text = "<script>alert(1)</script> '); DROP TABLE cards; --"
  const response = await f.submit({ columnIndex: 1, text })
  expect(response.status).toBe(201)
  expect((await response.json()).card.text).toBe(text)
})

it('rejects missing, unregistered, malformed, and facilitator credentials on participant endpoints', async () => {
  const f = await fixture()
  for (const token of [null, 'invalid', randomBytes(32).toString('base64url'), f.facilitator]) {
    expect((await f.submit(undefined, token)).status).toBe(401)
  }
  expect((await f.read(f.facilitator)).status).toBe(401)
  expect((await f.read(f.owner, f.room.id, true)).status).toBe(401)
  const otherRoom = await f.repo.create(['Other'])
  expect((await f.submit(undefined, f.owner, otherRoom.id)).status).toBe(401)
})

it.each(['revealed', 'closed'] as const)('rejects submissions in %s phase', async (state) => {
  const f = await fixture()
  await f.db.update(rooms).set({ state }).where(eq(rooms.id, f.room.id))
  expect((await f.submit()).status).toBe(409)
  expect(await f.db.all(sql`SELECT id FROM cards`)).toHaveLength(0)
})

it('denies expired reads and writes, including facilitator reads', async () => {
  const f = await fixture()
  await f.submit()
  f.expire()
  expect((await f.submit()).status).toBe(404)
  expect((await f.read()).status).toBe(404)
  expect((await f.read(f.facilitator, f.room.id, true)).status).toBe(404)
})

it('rechecks phase atomically when it changes after initial API authorization', async () => {
  const f = await fixture()
  const find = f.repo.find.bind(f.repo)
  vi.spyOn(f.repo, 'find').mockImplementationOnce(async (id) => {
    const room = await find(id)
    await f.db.update(rooms).set({ state: 'revealed' }).where(eq(rooms.id, id))
    return room
  })
  expect((await f.submit()).status).toBe(409)
  expect(await f.db.all(sql`SELECT id FROM cards`)).toHaveLength(0)
})

it('rejects malformed JSON, wrong content types, and oversized bodies', async () => {
  const f = await fixture()
  const path = `/api/rooms/${f.room.id}/cards`
  const headers = { Authorization: `Bearer ${f.owner}` }
  expect((await f.app.request(path, { method: 'POST', headers, body: '{}' })).status).toBe(415)
  expect((await f.app.request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
  expect((await f.submit({ columnIndex: 0, text: 'A'.repeat(17000) })).status).toBe(413)
})

it('preserves cards on reopen and cascades room deletion without exposing ownership fields', async () => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  // A second independent connection proves this is persistent storage.
  const second = await openDatabase(f.path)
  try {
    const repo = roomRepository(second.db)
    expect(await repo.listOwnCards(f.room.id, hashSecret(f.owner))).toEqual([card])
  } finally { second.close() }
  await f.db.delete(rooms).where(eq(rooms.id, f.room.id))
  expect(await f.db.all(sql`SELECT id FROM cards`)).toHaveLength(0)
})

it('lets an owner update text without changing card ID, column, or privacy', async () => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: ' Updated privately ' }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const updated = { ...card, text: 'Updated privately' }
  expect(await response.json()).toEqual({ card: updated })
  expect(await (await f.read()).json()).toEqual({ cards: [updated] })
  expect(await (await f.read(f.other)).json()).toEqual({ cards: [] })
  expect(await (await f.read(f.facilitator, f.room.id, true)).json()).toEqual({ cards: [] })
})

it('deletes only the owner’s card and persists the removal', async () => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  const { card: other } = await (await f.submit({ columnIndex: 0, text: 'Other card' }, f.other)).json()
  const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${f.owner}` },
  })
  expect(response.status).toBe(204)
  expect(await response.text()).toBe('')
  expect(await (await f.read()).json()).toEqual({ cards: [] })
  expect(await (await f.read(f.other)).json()).toEqual({ cards: [other] })
  const connection = await openDatabase(f.path)
  try { expect(await roomRepository(connection.db).listOwnCards(f.room.id, hashSecret(f.owner))).toEqual([]) }
  finally { connection.close() }
})

it.each(['PATCH', 'DELETE'])('%s conceals foreign and nonexistent cards with the same response', async (method) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  for (const id of [card.id, 'missing']) {
    const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${id}`, {
      method, headers: { Authorization: `Bearer ${f.other}`, 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Stolen' }) } : {}),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'CARD_NOT_FOUND' })
  }
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it.each(['PATCH', 'DELETE'])('%s rejects missing, malformed, unregistered, and facilitator credentials', async (method) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  for (const token of [null, 'bad', randomBytes(32).toString('base64url'), f.facilitator]) {
    const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Not allowed' }) } : {}),
    })
    expect(response.status).toBe(401)
  }
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it.each(['PATCH', 'DELETE'])('%s rejects a card ID paired with another room, even for the same participant', async (method) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  const otherRoom = await f.repo.create(['Other room'])
  await f.repo.joinParticipant(otherRoom.id, hashSecret(f.owner))
  const response = await f.app.request(`/api/rooms/${otherRoom.id}/cards/${card.id}`, {
    method, headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Wrong room' }) } : {}),
  })
  expect(response.status).toBe(404)
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it.each(['revealed', 'closed'] as const)('rejects edits and deletion after %s', async (state) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  await f.db.update(rooms).set({ state }).where(eq(rooms.id, f.room.id))
  for (const method of ['PATCH', 'DELETE']) {
    const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
      method, headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Too late' }) } : {}),
    })
    expect(response.status).toBe(409)
  }
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it.each(['PATCH', 'DELETE'])('%s rechecks lifecycle inside the write after a stale API check', async (method) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  const find = f.repo.find.bind(f.repo)
  vi.spyOn(f.repo, 'find').mockImplementationOnce(async (id) => {
    const room = await find(id)
    await f.db.update(rooms).set({ state: 'revealed' }).where(eq(rooms.id, id))
    return room
  })
  const response = await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
    method, headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Too late' }) } : {}),
  })
  expect(response.status).toBe(404)
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it('rejects edits and deletion for expired rooms without changing stored text', async () => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  f.expire()
  for (const method of ['PATCH', 'DELETE']) {
    expect((await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
      method, headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ text: 'Expired' }) } : {}),
    })).status).toBe(404)
  }
  expect(await f.db.all(sql`SELECT text FROM cards`)).toEqual([{ text: card.text }])
})

it.each([{ text: ' ' }, { text: 'A'.repeat(2001) }, { text: 42 }, {},
  { text: 'A', ownerHash: 'forged' }, { text: 'A', columnIndex: 1 }, { text: 'A', roomId: 'forged' },
])('rejects invalid or forged edit data: %#', async (input) => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  expect((await f.app.request(`/api/rooms/${f.room.id}/cards/${card.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${f.owner}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })).status).toBe(400)
  expect((await (await f.read()).json()).cards).toEqual([card])
})

it('validates edit transport and request size', async () => {
  const f = await fixture()
  const { card } = await (await f.submit()).json()
  const path = `/api/rooms/${f.room.id}/cards/${card.id}`
  const headers = { Authorization: `Bearer ${f.owner}` }
  expect((await f.app.request(path, { method: 'PATCH', headers, body: '{}' })).status).toBe(415)
  expect((await f.app.request(path, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
  expect((await f.app.request(path, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({text:'A'.repeat(17000)}) })).status).toBe(413)
})
