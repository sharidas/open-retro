import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { openDatabase } from './database.js'
import { cards, rooms } from './schema.js'

type Database = Awaited<ReturnType<typeof openDatabase>>['db']
export type PrivateCard = { id: string; columnIndex: number; text: string }
const cardFields = { id: cards.id, columnIndex: cards.columnIndex, text: cards.text }

export function cardRepository(db: Database, clock: () => number = Date.now) {
  return {
    async submitCard(roomId: string, ownerHash: string, columnIndex: number, text: string): Promise<PrivateCard | undefined> {
      // Authorization and lifecycle conditions are part of the write itself,
      // closing the gap between the API's initial checks and the insertion.
      const result = await db.all<PrivateCard>(sql`
        INSERT INTO cards (id, room_id, owner_hash, column_index, text)
        SELECT ${randomUUID()}, id, ${ownerHash}, ${columnIndex}, ${text}
        FROM rooms
        WHERE id = ${roomId} AND state = 'writing' AND expires_at > ${clock()}
          AND json_array_length(columns) > ${columnIndex}
          AND EXISTS (SELECT 1 FROM participants WHERE room_id = ${roomId} AND token_hash = ${ownerHash})
        RETURNING id, column_index AS columnIndex, text
      `)
      return result[0]
    },
    async listOwnCards(roomId: string, ownerHash: string): Promise<PrivateCard[]> {
      // Filter in SQL and project only safe fields. Never load another
      // participant's private cards into an HTTP handler.
      return db.select(cardFields).from(cards).innerJoin(rooms, eq(cards.roomId, rooms.id))
        .where(and(eq(cards.roomId, roomId), eq(cards.ownerHash, ownerHash), gt(rooms.expiresAt, clock())))
        .orderBy(asc(cards.id))
    },
  }
}
