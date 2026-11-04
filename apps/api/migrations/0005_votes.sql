CREATE UNIQUE INDEX cards_room_id_unique ON cards (room_id, id);
CREATE TABLE votes (
  room_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  card_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (typeof(slot) = 'integer' AND slot BETWEEN 1 AND 3),
  PRIMARY KEY (room_id, voter_hash, card_id),
  FOREIGN KEY (room_id, voter_hash) REFERENCES participants(room_id, token_hash) ON DELETE CASCADE,
  FOREIGN KEY (room_id, card_id) REFERENCES cards(room_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX votes_room_voter_slot_unique ON votes (room_id, voter_hash, slot);
CREATE INDEX votes_room_card_idx ON votes (room_id, card_id);
