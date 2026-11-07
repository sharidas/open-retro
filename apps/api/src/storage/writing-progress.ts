import type { openDatabase } from './database.js'
type Database = Awaited<ReturnType<typeof openDatabase>>['db']
export type TimerCommand = { version: number; action: 'start' | 'pause' | 'resume' | 'extend'; seconds?: number }
export function writingProgressRepository(db: Database, clock: () => number = Date.now) {
  return {
    async readWritingProgress(roomId: string, participantHash?: string) {
      const now = clock()
      // Separate projections prevent participants receiving any readiness counts.
      const readiness = participantHash ? `(SELECT ready FROM participants WHERE room_id = r.id AND token_hash = :hash) AS ownReady` :
        `(SELECT COUNT(*) FROM participants WHERE room_id = r.id) AS joinedCount,
         (SELECT COUNT(*) FROM participants WHERE room_id = r.id AND ready = 1) AS readyCount`
      const result = await db.$client.execute({ sql: `SELECT COALESCE(t.version, 0) AS version,
        COALESCE(t.status, 'idle') AS status, t.ends_at AS endsAt, COALESCE(t.remaining_ms, 0) AS remainingMs, ${readiness}
        FROM rooms r LEFT JOIN writing_timers t ON t.room_id = r.id
        WHERE r.id = :roomId AND r.state = 'writing' AND r.check_in <> 'open' AND r.expires_at > :now`,
        args: { roomId, now, hash: participantHash ?? '' } })
      const row = result.rows[0]
      if (!row) return undefined
      return { serverNow: now, timer: { version: Number(row.version), status: String(row.status),
        endsAt: row.endsAt === null ? null : Number(row.endsAt), remainingMs: Number(row.remainingMs) },
        ...(participantHash ? { ownReady: Number(row.ownReady) === 1 } : { joinedCount: Number(row.joinedCount), readyCount: Number(row.readyCount) }) }
    },
    async setReady(roomId: string, participantHash: string, ready: boolean) {
      const result = await db.$client.execute({ sql: `UPDATE participants SET ready = :ready
        WHERE room_id = :roomId AND token_hash = :hash AND EXISTS
        (SELECT 1 FROM rooms WHERE id = :roomId AND state = 'writing' AND check_in <> 'open' AND expires_at > :now)
        RETURNING ready`, args: { roomId, hash: participantHash, ready: ready ? 1 : 0, now: clock() } })
      return result.rows.length === 1
    },
    async changeTimer(roomId: string, hash: string, command: TimerCommand) {
      const args = { roomId, hash, now: clock(), version: command.version, duration: (command.seconds ?? 0) * 1000 }
      const eligible = `SELECT 1 FROM rooms WHERE id = :roomId AND facilitator_secret_hash = :hash
        AND state = 'writing' AND check_in <> 'open' AND expires_at > :now`
      const updates = {
        start: { set: "status = 'running', ends_at = :now + :duration, remaining_ms = 0", condition: "(status = 'idle' OR (status = 'running' AND ends_at <= :now)) AND :duration BETWEEN 1000 AND 3600000" },
        pause: { set: "status = 'paused', remaining_ms = ends_at - :now, ends_at = NULL", condition: "status = 'running' AND ends_at > :now" },
        resume: { set: "status = 'running', ends_at = :now + remaining_ms, remaining_ms = 0", condition: "status = 'paused' AND remaining_ms > 0" },
        extend: { set: "ends_at = CASE WHEN status = 'running' THEN MAX(ends_at, :now) + :duration ELSE NULL END, remaining_ms = CASE WHEN status = 'paused' THEN remaining_ms + :duration ELSE 0 END",
          condition: "status IN ('running', 'paused') AND :duration BETWEEN 1000 AND 3600000 AND CASE WHEN status = 'running' THEN MAX(0, ends_at - :now) ELSE remaining_ms END + :duration <= 3600000" },
      }[command.action]
      const [, result] = await db.$client.batch([
        { sql: `INSERT INTO writing_timers (room_id, version, status, ends_at, remaining_ms) SELECT :roomId, 0, 'idle', NULL, 0
          WHERE EXISTS (${eligible}) ON CONFLICT(room_id) DO NOTHING`, args },
        { sql: `UPDATE writing_timers SET ${updates.set}, version = version + 1
          WHERE room_id = :roomId AND version = :version AND (${updates.condition}) AND EXISTS (${eligible}) RETURNING version`, args },
      ], 'write')
      return result.rows.length === 1
    },
  }
}
