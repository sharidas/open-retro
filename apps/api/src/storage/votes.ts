import type { openDatabase } from './database.js'
import { VOTE_LIMIT } from '../domain/vote.js'

type Database = Awaited<ReturnType<typeof openDatabase>>['db']
export type VoteTotal = { cardId: string; total: number }
export type MyVote = VoteTotal & { selected: boolean }
export type VoteChange =
  | { kind: 'ok'; vote: MyVote; remainingVotes: number; voteLimit: number }
  | { kind: 'budget' }
  | { kind: 'unavailable' }

// Fixed SQL with bound named parameters; no participant-supplied SQL fragments.
const eligibleCard = `SELECT c.id FROM cards c JOIN rooms r ON r.id = c.room_id
  WHERE c.id = :cardId AND c.room_id = :roomId AND r.state = 'revealed' AND r.expires_at > :now
  AND EXISTS (SELECT 1 FROM participants p WHERE p.room_id = :roomId AND p.token_hash = :voterHash)`
const changeSnapshot = `SELECT c.id AS cardId,
  (SELECT COUNT(*) FROM votes WHERE room_id = :roomId AND card_id = :cardId) AS total,
  EXISTS (SELECT 1 FROM votes WHERE room_id = :roomId AND voter_hash = :voterHash AND card_id = :cardId) AS selected,
  (SELECT COUNT(*) FROM votes WHERE room_id = :roomId AND voter_hash = :voterHash) AS used
  FROM cards c WHERE c.id IN (${eligibleCard})`

export function voteRepository(db: Database, clock: () => number = Date.now) {
  return {
    async changeVote(roomId: string, voterHash: string, cardId: string, selected: boolean): Promise<VoteChange> {
      const args = { roomId, voterHash, cardId, now: clock() }
      const mutation = selected ? `INSERT INTO votes (room_id, voter_hash, card_id, slot)
        SELECT :roomId, :voterHash, :cardId, s.slot
        FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3) s
        WHERE EXISTS (${eligibleCard})
          AND NOT EXISTS (SELECT 1 FROM votes WHERE room_id = :roomId AND voter_hash = :voterHash AND card_id = :cardId)
          AND NOT EXISTS (SELECT 1 FROM votes WHERE room_id = :roomId AND voter_hash = :voterHash AND slot = s.slot)
        ORDER BY s.slot LIMIT 1 ON CONFLICT DO NOTHING` :
        `DELETE FROM votes WHERE room_id = :roomId AND voter_hash = :voterHash AND card_id = :cardId
          AND EXISTS (${eligibleCard})`
      // A write-mode batch runs mutation + snapshot in one SQLite transaction.
      // Slot constraints cap the budget even under competing connections.
      const [, snapshot] = await db.$client.batch([
        { sql: mutation, args }, { sql: changeSnapshot, args },
      ], 'write')
      const row = snapshot.rows[0]
      if (!row) return { kind: 'unavailable' }
      const voted = Number(row.selected) === 1
      if (selected && !voted) return { kind: 'budget' }
      return { kind: 'ok', vote: { cardId: String(row.cardId), total: Number(row.total), selected: voted },
        remainingVotes: VOTE_LIMIT - Number(row.used), voteLimit: VOTE_LIMIT }
    },
    async myVoting(roomId: string, voterHash: string) {
      const result = await db.$client.execute({
        sql: `SELECT c.id AS cardId, COUNT(v.card_id) AS total,
          MAX(CASE WHEN v.voter_hash = :voterHash THEN 1 ELSE 0 END) AS selected
          FROM cards c JOIN rooms r ON r.id = c.room_id
          LEFT JOIN votes v ON v.room_id = c.room_id AND v.card_id = c.id
          WHERE c.room_id = :roomId AND r.state IN ('revealed', 'closed') AND r.expires_at > :now
            AND EXISTS (SELECT 1 FROM participants p WHERE p.room_id = :roomId AND p.token_hash = :voterHash)
          GROUP BY c.id ORDER BY c.id`, args: { roomId, voterHash, now: clock() },
      })
      const votes: MyVote[] = result.rows.map((row) => ({ cardId: String(row.cardId), total: Number(row.total), selected: Number(row.selected) === 1 }))
      return { votes, voteLimit: VOTE_LIMIT, remainingVotes: VOTE_LIMIT - votes.filter((vote) => vote.selected).length }
    },
    async voteTotals(roomId: string): Promise<VoteTotal[]> {
      const result = await db.$client.execute({
        sql: `SELECT c.id AS cardId, COUNT(v.card_id) AS total FROM cards c
          JOIN rooms r ON r.id = c.room_id LEFT JOIN votes v ON v.room_id = c.room_id AND v.card_id = c.id
          WHERE c.room_id = :roomId AND r.state IN ('revealed', 'closed') AND r.expires_at > :now
          GROUP BY c.id ORDER BY c.id`, args: { roomId, now: clock() },
      })
      return result.rows.map((row) => ({ cardId: String(row.cardId), total: Number(row.total) }))
    },
  }
}
