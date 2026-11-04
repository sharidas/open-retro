CREATE TABLE cards (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  owner_hash TEXT NOT NULL,
  column_index INTEGER NOT NULL CHECK (typeof(column_index) = 'integer' AND column_index BETWEEN 0 AND 4),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 2000),
  FOREIGN KEY (room_id, owner_hash) REFERENCES participants(room_id, token_hash) ON DELETE CASCADE
);
CREATE INDEX cards_room_owner_idx ON cards (room_id, owner_hash);
