-- Existing local rooms have no recoverable facilitator capability.
ALTER TABLE rooms ADD COLUMN facilitator_secret_hash TEXT
  CHECK (facilitator_secret_hash IS NULL OR
    (length(facilitator_secret_hash) = 64 AND facilitator_secret_hash NOT GLOB '*[^0-9a-f]*'));
