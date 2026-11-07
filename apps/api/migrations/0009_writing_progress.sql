ALTER TABLE participants ADD COLUMN ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1));
CREATE TABLE writing_timers (
  room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused')),
  ends_at INTEGER,
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms BETWEEN 0 AND 3600000),
  CHECK ((status = 'running' AND ends_at IS NOT NULL) OR (status <> 'running' AND ends_at IS NULL))
);
