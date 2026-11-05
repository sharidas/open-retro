import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { hashSecret, verifyFacilitatorSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose()
  cleanup.length = 0
  vi.restoreAllMocks()
})

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'open-retro-api-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const connection = await openDatabase(join(folder, 'rooms.sqlite'))
  cleanup.push(connection.close)
  let now = 1_800_000_000_000
  const repo = roomRepository(connection.db, () => now)
  const app = createApp(repo, () => now)
  const create = (body: unknown = { columns: [' Went well ', 'Improve'] }) =>
    app.request('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  const access = (id: string, secret?: string) => app.request(`/api/rooms/${id}/facilitator`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
  return { ...connection, repo, app, create, access, advanceTo: (value: number) => { now = value } }
}

describe('room creation API', () => {
  it('returns 201, normalized room metadata, and a distinct secret; stores only its hash', async () => {
    const f = await fixture()
    const response = await f.create()
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['facilitatorSecret', 'room'])
    expect(Object.keys(body.room).sort()).toEqual(['checkIn', 'columnColors', 'columns', 'createdAt', 'expiresAt', 'id', 'state'])
    expect(body.room.columns).toEqual(['Went well', 'Improve'])
    expect(body.room.state).toBe('writing')
    expect(body.room.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.facilitatorSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.facilitatorSecret).not.toBe(body.room.id)
    const stored = await f.db.all<{ facilitator_secret_hash: string }>(sql`SELECT * FROM rooms`)
    expect(stored[0].facilitator_secret_hash).toBe(hashSecret(body.facilitatorSecret))
    expect(JSON.stringify(stored)).not.toContain(body.facilitatorSecret)
    expect(await f.repo.find(body.room.id)).toEqual(body.room)
  })

  it('accepts five columns and generates independent IDs and secrets', async () => {
    const f = await fixture()
    const first = await (await f.create({ columns: ['A', 'B', 'C', 'D', 'E'] })).json()
    const second = await (await f.create()).json()
    expect(first.room.columns).toHaveLength(5)
    expect(first.room.id).not.toBe(second.room.id)
    expect(first.facilitatorSecret).not.toBe(second.facilitatorSecret)
  })

  it.each([
    { columns: [] }, { columns: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { columns: [' '] }, { columns: [1] }, { columns: 'A' }, {}, null,
    { columns: ['A'], state: 'revealed' },
    { columns: ['A'], facilitatorSecret: 'chosen-by-client' },
  ])('rejects invalid or extra fields without saving: %j', async (input) => {
    const f = await fixture()
    expect((await f.create(input)).status).toBe(400)
    expect(await f.db.all(sql`SELECT id FROM rooms`)).toEqual([])
  })

  it('rejects malformed JSON and unsupported content types', async () => {
    const { app } = await fixture()
    expect((await app.request('/api/rooms', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{',
    })).status).toBe(400)
    expect((await app.request('/api/rooms', { method: 'POST', body: '{}' })).status).toBe(415)
  })

  it('bounds request size before storing a room', async () => {
    const f = await fixture()
    expect((await f.create({ columns: ['A'.repeat(9000)] })).status).toBe(413)
    expect(await f.db.all(sql`SELECT id FROM rooms`)).toEqual([])
  })

  it('does not disclose database errors or secrets on failure', async () => {
    const f = await fixture()
    vi.spyOn(f.repo, 'create').mockRejectedValue(new Error('sensitive database detail'))
    const response = await f.create()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' })
  })
})

describe('facilitator authorization', () => {
  it('accepts the correct secret without returning it or its hash again', async () => {
    const f = await fixture()
    const { room, facilitatorSecret } = await (await f.create()).json()
    const response = await f.access(room.id, facilitatorSecret)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ room })
  })

  it('rejects missing, malformed, wrong, room-ID, and cross-room credentials', async () => {
    const f = await fixture()
    const first = await (await f.create()).json()
    const second = await (await f.create()).json()
    for (const secret of [undefined, 'bad', 'x'.repeat(43), first.room.id, second.facilitatorSecret]) {
      const response = await f.access(first.room.id, secret)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' })
    }
    expect((await f.access('missing', first.facilitatorSecret)).status).toBe(401)
  })

  it('does not accept credentials in a query parameter', async () => {
    const f = await fixture()
    const { room, facilitatorSecret } = await (await f.create()).json()
    const response = await f.app.request(`/api/rooms/${room.id}/facilitator?secret=${facilitatorSecret}`)
    expect(response.status).toBe(401)
  })

  it('denies expired rooms even with valid credentials', async () => {
    const f = await fixture()
    const { room, facilitatorSecret } = await (await f.create()).json()
    f.advanceTo(room.expiresAt)
    expect((await f.access(room.id, facilitatorSecret)).status).toBe(404)
  })

  it('rejects legacy rooms without a facilitator hash', async () => {
    const f = await fixture()
    const room = await f.repo.create(['Legacy'])
    expect((await f.access(room.id, 'x'.repeat(43))).status).toBe(401)
  })

  it('fails safely for invalid stored hashes', () => {
    expect(verifyFacilitatorSecret('x'.repeat(43), null)).toBe(false)
    expect(verifyFacilitatorSecret('x'.repeat(43), 'not-a-hash')).toBe(false)
    expect(verifyFacilitatorSecret('short', 'a'.repeat(64))).toBe(false)
  })
})

 it('persists chosen colours through reads and lifecycle transitions', async () => {
  const f = await fixture()
  const response = await f.create({ columns: ['Start', 'Stop', 'Continue'], columnColors: ['blue', 'peach', 'sage'] })
  expect(response.status).toBe(201)
  const { room, facilitatorSecret } = await response.json()
  expect(room.columnColors).toEqual(['blue', 'peach', 'sage'])
  expect((await (await f.access(room.id, facilitatorSecret)).json()).room.columnColors).toEqual(room.columnColors)
  for (const action of ['reveal', 'close']) {
    const response = await f.app.request(`/api/rooms/${room.id}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${facilitatorSecret}` } })
    expect(response.status).toBe(200)
    expect((await response.json()).room.columnColors).toEqual(room.columnColors)
  }
})
it.each([[], ['sage', 'blue'], ['unknown'], ['#ffffff'], [null], 'sage', null])('rejects invalid colour configuration: %j', async columnColors => {
  const f = await fixture()
  expect((await f.create({ columns: ['A'], columnColors })).status).toBe(400)
  expect(await f.db.all(sql`SELECT id FROM rooms`)).toEqual([])
})
it('uses deterministic defaults for clients that omit colours', async () => {
  const f = await fixture()
  const { room } = await (await f.create()).json()
  expect(room.columnColors).toEqual(['sage', 'peach'])
})
