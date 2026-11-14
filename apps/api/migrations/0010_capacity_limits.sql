-- Keep existing data; limits reject new inserts without deleting older rooms.
CREATE TRIGGER rooms_capacity BEFORE INSERT ON rooms
WHEN (SELECT COUNT(*) FROM rooms) >= 1000
BEGIN SELECT RAISE(ABORT, 'RETRO_ROOM_LIMIT'); END;

CREATE TRIGGER participants_capacity BEFORE INSERT ON participants
WHEN NOT EXISTS (SELECT 1 FROM participants WHERE room_id = NEW.room_id AND token_hash = NEW.token_hash)
 AND (SELECT COUNT(*) FROM participants WHERE room_id = NEW.room_id) >= 100
BEGIN SELECT RAISE(ABORT, 'RETRO_PARTICIPANT_LIMIT'); END;

CREATE TRIGGER cards_room_capacity BEFORE INSERT ON cards
WHEN (SELECT COUNT(*) FROM cards WHERE room_id = NEW.room_id) >= 500
BEGIN SELECT RAISE(ABORT, 'RETRO_CARD_LIMIT'); END;

CREATE TRIGGER cards_owner_capacity BEFORE INSERT ON cards
WHEN (SELECT COUNT(*) FROM cards WHERE room_id = NEW.room_id AND owner_hash = NEW.owner_hash) >= 50
BEGIN SELECT RAISE(ABORT, 'RETRO_CARD_LIMIT'); END;
