import type { openDatabase } from './database.js'
type Database = Awaited<ReturnType<typeof openDatabase>>['db']
export type CardGroup = { id: string; name: string; cardIds: string[] }
export type GroupActor = { role: 'participant' | 'facilitator'; hash: string }
export function groupRepository(db: Database, clock: () => number = Date.now) {
  return {
    async readGroups(roomId: string) {
      const result = await db.$client.execute({ sql: `SELECT COALESCE(g.version, 0) AS version, COALESCE(g.groups, '[]') AS groups
        FROM rooms r LEFT JOIN room_grouping g ON g.room_id = r.id
        WHERE r.id = ? AND r.state IN ('revealed', 'closed') AND r.expires_at > ?`, args: [roomId, clock()] })
      const row = result.rows[0]
      return row ? { version: Number(row.version), groups: JSON.parse(String(row.groups)) as CardGroup[] } : undefined
    },
    async replaceGroups(roomId: string, actor: GroupActor, version: number, groups: CardGroup[]) {
      const args = { roomId, hash: actor.hash, facilitator: actor.role === 'facilitator' ? 1 : 0,
        version, groups: JSON.stringify(groups), now: clock() }
      const eligible = `SELECT 1 FROM rooms r WHERE r.id = :roomId AND r.state = 'revealed' AND r.expires_at > :now
        AND ((:facilitator = 1 AND r.facilitator_secret_hash = :hash) OR (:facilitator = 0 AND
          EXISTS (SELECT 1 FROM participants p WHERE p.room_id = r.id AND p.token_hash = :hash)))`
      // One write transaction guards the whole layout, including cross-room membership.
      const [, update] = await db.$client.batch([
        { sql: `INSERT INTO room_grouping (room_id, version, groups) SELECT :roomId, 0, '[]'
          WHERE EXISTS (${eligible}) ON CONFLICT(room_id) DO NOTHING`, args },
        { sql: `UPDATE room_grouping SET groups = :groups, version = version + 1
          WHERE room_id = :roomId AND version = :version AND EXISTS (${eligible})
          AND NOT EXISTS (SELECT 1 FROM json_each(:groups) g, json_each(g.value, '$.cardIds') member
            WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = member.value AND c.room_id = :roomId))
          RETURNING version`, args },
      ], 'write')
      return update.rows.length === 1
    },
  }
}
