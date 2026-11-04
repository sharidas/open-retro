import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RoomState } from '../domain/room.js'

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  columns: text('columns', { mode: 'json' }).$type<readonly string[]>().notNull(),
  columnColors: text('column_colors', { mode: 'json' }).$type<readonly string[]>().notNull(),
  state: text('state').$type<RoomState>().notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  facilitatorSecretHash: text('facilitator_secret_hash'),
}, (table) => [index('rooms_expires_at_idx').on(table.expiresAt)])

export const participants = sqliteTable('participants', {
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
}, (table) => [primaryKey({ columns: [table.roomId, table.tokenHash] })])

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  ownerHash: text('owner_hash').notNull(),
  columnIndex: integer('column_index').notNull(),
  text: text('text').notNull(),
}, (table) => [
  foreignKey({ columns: [table.roomId, table.ownerHash], foreignColumns: [participants.roomId, participants.tokenHash] }).onDelete('cascade'),
  index('cards_room_owner_idx').on(table.roomId, table.ownerHash),
  uniqueIndex('cards_room_id_unique').on(table.roomId, table.id),
])

export const votes = sqliteTable('votes', {
  roomId: text('room_id').notNull(),
  voterHash: text('voter_hash').notNull(),
  cardId: text('card_id').notNull(),
  slot: integer('slot').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.voterHash, table.cardId] }),
  foreignKey({ columns: [table.roomId, table.voterHash], foreignColumns: [participants.roomId, participants.tokenHash] }).onDelete('cascade'),
  foreignKey({ columns: [table.roomId, table.cardId], foreignColumns: [cards.roomId, cards.id] }).onDelete('cascade'),
  uniqueIndex('votes_room_voter_slot_unique').on(table.roomId, table.voterHash, table.slot),
  index('votes_room_card_idx').on(table.roomId, table.cardId),
])
