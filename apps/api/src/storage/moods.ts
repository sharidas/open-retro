import type { openDatabase } from './database.js'
type Database = Awaited<ReturnType<typeof openDatabase>>['db']
export const MOODS = ['drained', 'low', 'steady', 'good', 'energised'] as const
export function moodRepository(db: Database, clock: () => number = Date.now) {
  return {
    async saveMood(roomId: string, participantHash: string, mood: string | null) {
      const args = { roomId, participantHash, mood, now: clock() }
      const eligible = `SELECT 1 FROM rooms r JOIN participants p ON p.room_id = r.id
        WHERE r.id = :roomId AND p.token_hash = :participantHash AND r.check_in = 'open'
        AND r.state = 'writing' AND r.expires_at > :now`
      const [, result] = await db.$client.batch([
        { sql: mood === null ? `DELETE FROM moods WHERE room_id = :roomId AND participant_hash = :participantHash AND EXISTS (${eligible})` :
          `INSERT INTO moods (room_id, participant_hash, mood) SELECT :roomId, :participantHash, :mood WHERE EXISTS (${eligible})
           ON CONFLICT(room_id, participant_hash) DO UPDATE SET mood = excluded.mood`, args },
        { sql: eligible, args },
      ], 'write')
      return result.rows.length === 1
    },
    async readMood(roomId: string, participantHash?: string) {
      // A single query gates aggregate disclosure on the persisted check-in state.
      const result = await db.$client.execute({ sql: `SELECT r.check_in AS checkIn,
        (SELECT mood FROM moods WHERE room_id = r.id AND participant_hash = :participantHash) AS selected,
        CASE WHEN r.check_in = 'complete' THEN
          (SELECT json_group_array(json_object('mood', mood, 'total', total)) FROM
            (SELECT mood, COUNT(*) AS total FROM moods WHERE room_id = r.id GROUP BY mood))
          ELSE NULL END AS totals
        FROM rooms r WHERE r.id = :roomId AND r.expires_at > :now`,
        args: { roomId, participantHash: participantHash ?? '', now: clock() } })
      const row = result.rows[0]
      if (!row) return undefined
      const counts = row.totals === null ? null : JSON.parse(String(row.totals)) as { mood: string; total: number }[]
      return { checkIn: String(row.checkIn), ...(participantHash ? { selected: row.selected ?? null } : {}),
        totals: counts === null ? null : MOODS.map(mood => ({ mood, total: counts.find(item => item.mood === mood)?.total ?? 0 })) }
    },
  }
}
