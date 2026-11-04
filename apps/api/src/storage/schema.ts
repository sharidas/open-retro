import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { RoomState } from '../domain/room.js'

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  columns: text('columns', { mode: 'json' }).$type<readonly string[]>().notNull(),
  state: text('state').$type<RoomState>().notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  facilitatorSecretHash: text('facilitator_secret_hash'),
}, (table) => [index('rooms_expires_at_idx').on(table.expiresAt)])
