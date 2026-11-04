# Local Room API

The API is available through Vite at `http://localhost:5173/api`. The home page
contains a room creation form that uses this API.

## Create a Room

```bash
curl -i http://localhost:5173/api/rooms \
  -H 'Content-Type: application/json' \
  -d '{"columns":["Went well","Could improve","Ideas"]}'
```

`POST /api/rooms` accepts only a JSON object containing `columns`: one to five
nonempty strings. Names are trimmed and order is preserved. Unknown fields are
rejected, including attempts to choose a room ID, phase, or facilitator secret.
The request body is limited to 8 KiB. Duplicate column names remain allowed.

Success returns HTTP 201:

```json
{
  "room": {
    "id": "generated-room-uuid",
    "columns": ["Went well", "Could improve", "Ideas"],
    "state": "writing",
    "createdAt": 1800000000000,
    "expiresAt": 1800086400000
  },
  "facilitatorSecret": "generated-private-secret"
}
```

The raw secret appears only in this creation response. Save it privately: there
is no recovery endpoint. It is independently generated from 32 cryptographically
random bytes and is separate from the random UUID used to identify the room.
Only its SHA-256 hash is stored in SQLite. A fast hash is appropriate here because
the input is a high-entropy generated capability, not a human-selected password.

## Verify Facilitator Access

`GET /api/rooms/:id/facilitator` accepts `Authorization: Bearer <secret>` and
returns `{ "room": { ... } }` for a valid, unexpired room. The response never
includes the secret or its hash. Hash verification uses a constant-time comparison.

Missing, malformed, incorrect, cross-room, and unknown-room credentials return
HTTP 401 with `{"error":"UNAUTHORIZED"}`. A room ID alone grants no facilitator
access. Secrets in query parameters are not accepted. A valid credential for an
expired room returns HTTP 404. Rooms created before migration 0002 have no
facilitator capability and cannot pass this check; create a new room instead.

This protected metadata read establishes the access boundary. Reveal, close,
and delete operations are deliberately left for their planned tasks. Participant
joining now has separate endpoints below. The form generates separate participant and
facilitator links. Only the latter contains a secret, encoded in its URL
fragment. The facilitator route consumes this fragment, removes it from the
address bar, and keeps the credential in session storage for that tab.

## Anonymous Participant Sessions

The browser generates a cryptographically random 32-byte token, encoded as
43 base64url characters, and stores it in local storage under a room-specific
key. It is not a name, email address, or account. Tokens travel only in
`Authorization: Bearer <token>` headers, never share links or query strings.

- `POST /api/rooms/:id/join`: registers the token hash for this room and returns
  HTTP 200 with `{ "room": { ... } }`. Repeating the same join is idempotent,
  including concurrent requests. There is no response token or participant ID.
- `GET /api/rooms/:id`: requires a token already registered in this room and
  returns the same public metadata. A token registered in another room does not
  authorize this read or any facilitator operation.
- Missing/malformed join credentials and unregistered read credentials return
  401. Valid join requests to missing/expired rooms return 404. Registered reads
  of expired rooms also return 404. Closed rooms reject new joins with 409;
  already registered participants can still read them until expiry/deletion.

Migration 0003 adds a `participants` table with a composite room/hash key and
cascading deletion when a room is removed. It stores no raw token or participant
profile. Facilitator reads do not expose the table contents or participant counts.

The room page attempts an authenticated read first and joins only if the token
is not registered. Participant sessions persist across reloads and tabs sharing
the same browser storage; separate profiles/incognito sessions are independent.
This does not enforce one person per participant: another browser or cleared
storage can create a new session. Old local storage entries are not automatically
cleared yet; retention cleanup remains task 15.

## Private Cards

Registered participants use `Authorization: Bearer <participant-token>` for:

- `POST /api/rooms/:id/cards`: accepts only JSON fields `columnIndex` (integer,
  zero-based position in this room) and `text` (trimmed, 1–2000 characters).
  Returns HTTP 201 with `{ "card": { "id": "generated-uuid", "columnIndex": 0,
  "text": "Sprint feedback" } }`.
- `GET /api/rooms/:id/cards`: returns `{ "cards": [...] }` containing only cards
  owned by that participant in this room. Query parameters cannot select another
  owner. There is no single-card lookup endpoint in this slice.

The server sets the ID, room, and owner hash; attempts to supply these as input
are rejected. Cards store no raw participant token or personal profile, and
responses include no ownership hash or participant identifier. Text is stored as
plain data, including HTML-like input; the future UI must render it as text.

Writing-phase rules are checked both at the API and within the atomic database
insertion. The write requires a registered owner, a current writing-phase room,
an unexpired timestamp, and a column that exists in that room. This prevents a
phase change between initial authorization and insertion from permitting a late
card. Migration 0004 adds cards with room/participant foreign keys and cascading
deletion. The room/owner index supports private reads that filter ownership in
SQL and project only safe fields.

`GET /api/rooms/:id/facilitator/cards` requires the facilitator secret and returns
`{ "cards": [] }` in this slice: no private text, counts, or ownership metadata.
The facilitator secret does not grant participant card access. Facilitators may
join through the participant link separately, receiving their own participant
session with the same privacy rules as everyone else.

For now, participant reads remain owner-only in every phase and facilitator
reads remain empty. Shared card visibility after reveal is task 10. Updating
and deleting owned cards is task 09. The writing UI uses these endpoints, keeps
drafts in page memory, and does not automatically retry submissions. Manual card
refresh preserves drafts; interrupted-save feedback asks users to check saved
cards before resubmitting. React renders returned text without HTML interpretation.

Card errors: 401 for absent/unregistered/cross-room credentials; 404 for expired
registered rooms; 409 when writing has ended or room eligibility changes during
submission; 400 for invalid JSON, extra fields, invalid columns, or invalid text;
415 for non-JSON requests; 413 for bodies exceeding 16 KiB. There is no automatic
submission deduplication yet: a repeated successful POST creates another card.

## Errors and Privacy

- 400: malformed JSON or invalid room input. Error responses do not echo input.
- 413: request body exceeds 8 KiB.
- 415: request does not use `application/json`.
- 500: generic internal failure, with database details suppressed.

API responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Application handlers do not log request bodies, authorization headers, raw
secrets, or database error details. Future hosting/proxy logging must follow the
same policy; transport HTTPS must be configured for a public deployment.

Rate limiting and broader abuse protection remain task 16. This API is currently
for local development, not a public deployment.
