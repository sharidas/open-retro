CREATE TABLE room_grouping (
  room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  groups TEXT NOT NULL CHECK (json_valid(groups) AND json_type(groups) = 'array')
);
