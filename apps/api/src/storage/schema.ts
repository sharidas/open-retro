import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { RoomState } from '../domain/room.js'

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  columns: text('columns', { mode: 'json' }).$type<readonly string[]>().notNull(),
  state: text('state').$type<RoomState>().notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  facilitatorSecretHash: text('facilitator_secret_hash'),
}, (table) => [index('rooms_expires_at_idx').on(table.expiresAt)])

export const participants = sqliteTable('participants', {
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
}, (table) => [primaryKey({ columns: [table.roomId, table.tokenHash] })])
