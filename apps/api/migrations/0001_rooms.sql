CREATE TABLE rooms (
  id TEXT PRIMARY KEY NOT NULL,
  columns TEXT NOT NULL CHECK (json_valid(columns) AND json_type(columns) = 'array' AND json_array_length(columns) BETWEEN 1 AND 5),
  state TEXT NOT NULL CHECK (state IN ('writing', 'revealed', 'closed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX rooms_expires_at_idx ON rooms (expires_at);
