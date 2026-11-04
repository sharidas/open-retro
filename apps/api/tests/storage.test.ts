import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository, ROOM_LIFETIME_MS } from '../src/storage/rooms.js'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'open-retro-storage-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'nested', 'rooms.sqlite')
  const connection = await openDatabase(path)
  let closed = false
  const close = () => { if (!closed) { connection.close(); closed = true } }
  cleanup.push(close)
  return { ...connection, close, path }
}

describe('SQLite room persistence', () => {
  it('round-trips normalized columns, writing state, and expiry timestamps', async () => {
    const { db } = await fixture()
    const now = 1_800_000_000_000
    const repo = roomRepository(db, () => now)
    const room = await repo.create(['  Went well ', 'Improve', 'Ideas', 'Questions', 'Thanks'])
    expect(await repo.find(room.id)).toEqual({
      id: room.id,
      columns: ['Went well', 'Improve', 'Ideas', 'Questions', 'Thanks'],
      state: 'writing', createdAt: now, expiresAt: now + ROOM_LIFETIME_MS,
    })
  })

  it('preserves rooms across connection restarts and applies migrations once', async () => {
    const first = await fixture()
    const room = await roomRepository(first.db).create(['A'])
    first.close()
    const second = await openDatabase(first.path)
    cleanup.push(second.close)
    expect(await roomRepository(second.db).find(room.id)).toEqual(room)
    expect(await second.db.all(sql`SELECT name FROM schema_migrations`)).toEqual([
      { name: '0001_rooms.sql' },
    ])
  })

  it('returns undefined for missing rooms', async () => {
    const { db } = await fixture()
    expect(await roomRepository(db).find('missing')).toBeUndefined()
  })

  it('rejects invalid rooms without inserting any rows', async () => {
    const { db } = await fixture()
    await expect(roomRepository(db).create(['A', ' '])).rejects.toMatchObject({ code: 'INVALID_COLUMNS' })
    expect(await db.all(sql`SELECT id FROM rooms`)).toEqual([])
  })

  it('keeps rooms separate and safely stores SQL-like text', async () => {
    const { db } = await fixture()
    const repo = roomRepository(db)
    const first = await repo.create(["'); DROP TABLE rooms; --"])
    const second = await repo.create(['Another room'])
    expect(first.id).not.toBe(second.id)
    expect(await repo.find(first.id)).toEqual(first)
    expect(await repo.find(second.id)).toEqual(second)
  })

  it('enforces state, column-count, and expiry constraints in SQLite', async () => {
    const { db } = await fixture()
    for (const [columns, state, expiresAt] of [
      ['["A"]', 'invalid', 2], ['[]', 'writing', 2],
      ['["A"]', 'writing', 1],
    ] as const) {
      await expect(db.run(sql`INSERT INTO rooms (id, columns, state, created_at, expires_at)
        VALUES ('invalid', ${columns}, ${state}, 1, ${expiresAt})`)).rejects.toThrow()
    }
    expect(await db.all(sql`SELECT id FROM rooms`)).toEqual([])
  })
})
