CREATE TABLE participants (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (room_id, token_hash)
);
