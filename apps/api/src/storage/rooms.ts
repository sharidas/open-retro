import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createRoom } from '../domain/room.js'
import type { openDatabase } from './database.js'
import { participants, rooms } from './schema.js'
import { cardRepository } from './cards.js'

export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000
// Explicit projection prevents facilitator hashes from leaking through reads.
const publicFields = {
  id: rooms.id, columns: rooms.columns, state: rooms.state,
  createdAt: rooms.createdAt, expiresAt: rooms.expiresAt,
}
export type StoredRoom = Omit<typeof rooms.$inferSelect, 'facilitatorSecretHash'>
type Database = Awaited<ReturnType<typeof openDatabase>>['db']

export function roomRepository(db: Database, clock: () => number = Date.now) {
  return {
    ...cardRepository(db, clock),
    async joinParticipant(roomId: string, tokenHash: string): Promise<void> {
      await db.insert(participants).values({ roomId, tokenHash }).onConflictDoNothing()
    },
    async hasParticipant(roomId: string, tokenHash: string): Promise<boolean> {
      const records = await db.select({ roomId: participants.roomId }).from(participants)
        .where(and(eq(participants.roomId, roomId), eq(participants.tokenHash, tokenHash))).limit(1)
      return records.length === 1
    },
    async create(columns: unknown, facilitatorSecretHash: string | null = null): Promise<StoredRoom> {
      const room = createRoom(columns)
      const createdAt = clock()
      const saved: StoredRoom = {
        ...room,
        id: randomUUID(),
        createdAt,
        expiresAt: createdAt + ROOM_LIFETIME_MS,
      }
      await db.insert(rooms).values({ ...saved, facilitatorSecretHash })
      return saved
    },
    async find(id: string): Promise<StoredRoom | undefined> {
      const [room] = await db.select(publicFields).from(rooms).where(eq(rooms.id, id)).limit(1)
      return room
    },
    async findFacilitatorHash(id: string): Promise<string | null> {
      const [room] = await db.select({ hash: rooms.facilitatorSecretHash })
        .from(rooms).where(eq(rooms.id, id)).limit(1)
      return room?.hash ?? null
    },
  }
}
