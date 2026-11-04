import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createRoom } from '../domain/room.js'
import type { openDatabase } from './database.js'
import { rooms } from './schema.js'

export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000
export type StoredRoom = typeof rooms.$inferSelect
type Database = Awaited<ReturnType<typeof openDatabase>>['db']

export function roomRepository(db: Database, clock: () => number = Date.now) {
  return {
    async create(columns: unknown): Promise<StoredRoom> {
      const room = createRoom(columns)
      const createdAt = clock()
      const saved: StoredRoom = {
        ...room,
        id: randomUUID(),
        createdAt,
        expiresAt: createdAt + ROOM_LIFETIME_MS,
      }
      await db.insert(rooms).values(saved)
      return saved
    },
    async find(id: string): Promise<StoredRoom | undefined> {
      const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1)
      return room
    },
  }
}
