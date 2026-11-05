ALTER TABLE rooms ADD COLUMN check_in TEXT NOT NULL DEFAULT 'off' CHECK (check_in IN ('off', 'open', 'complete'));
CREATE TABLE moods (
  room_id TEXT NOT NULL,
  participant_hash TEXT NOT NULL,
  mood TEXT NOT NULL CHECK (mood IN ('drained', 'low', 'steady', 'good', 'energised')),
  PRIMARY KEY (room_id, participant_hash),
  FOREIGN KEY (room_id, participant_hash) REFERENCES participants(room_id, token_hash) ON DELETE CASCADE
);
