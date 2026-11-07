# Local Room API

The API is available through Vite at `http://localhost:5173/api`. The home page
contains a room creation form that uses this API.

## Create a Room

```bash
curl -i http://localhost:5173/api/rooms \
  -H 'Content-Type: application/json' \
  -d '{"columns":["Went well","Could improve","Ideas"]}'
```

`POST /api/rooms` accepts a JSON object containing `columns`: one to five
nonempty strings. Names are trimmed and order is preserved. Unknown fields are
rejected, including attempts to choose a room ID, phase, or facilitator secret.
The request body is limited to 8 KiB. Duplicate column names remain allowed.

Success returns HTTP 201:

```json
{
  "room": {
    "id": "generated-room-uuid",
    "columns": ["Went well", "Could improve", "Ideas"],
    "columnColors": ["sage", "peach", "blue"],
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

This protected metadata read establishes the access boundary. Reveal is now
supported below, as is closure; room deletion remains a later task. Participant
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
`{ "cards": [] }` during writing: no private text, counts, or ownership metadata.
After reveal it returns all cards using the same safe card fields.
The facilitator secret does not grant participant card access. Facilitators may
join through the participant link separately, receiving their own participant
session with the same privacy rules as everyone else.

The private participant card endpoint remains owner-only in every phase. Shared
visibility after reveal uses the separate endpoints below. Updating
and deleting owned cards is now supported below. The writing UI uses these endpoints, keeps
drafts in page memory, and does not automatically retry submissions. Manual card
refresh preserves drafts; interrupted-save feedback asks users to check saved
cards before resubmitting. React renders returned text without HTML interpretation.

### Edit and Delete Owned Cards

- `PATCH /api/rooms/:id/cards/:cardId` accepts only JSON `{ "text": "Updated feedback" }`.
  Text is trimmed and limited to 1–2000 characters; the column and ownership cannot
  be changed. Success returns HTTP 200 with the safe `{ "card": { ... } }` shape.
- `DELETE /api/rooms/:id/cards/:cardId` requires no body and returns HTTP 204 on
  success. Deletion is immediate and has no undo endpoint.

Both endpoints require a participant token registered in the room and matching
the card owner. Missing, malformed, unregistered, and facilitator credentials
return 401. A foreign card and a nonexistent card return the same 404 response,
without exposing text or ownership metadata. Using a card ID with another room
also fails, even if the same participant is registered in both rooms.

Expired rooms return 404; rooms outside writing return 409. Invalid edit JSON,
extra fields, or invalid text return 400; non-JSON edits return 415 and bodies
above 16 KiB return 413. The atomic database update/delete also checks owner,
room, phase, and expiry. If eligibility changes between initial API authorization
and the write, the mutation returns 404 without making a change.

The UI offers cancelable editing and inline deletion confirmation. It applies
changes only after server success, preserves failed edit drafts, blocks competing
actions while a mutation is pending, and disables refresh while an editor or
confirmation is open. Interrupted requests are not retried automatically. There
is no revision-based conflict detection yet: concurrent successful edits use
the last write, and a repeated delete returns 404 after the first succeeds.

Card errors: 401 for absent/unregistered/cross-room credentials; 404 for expired
registered rooms; 409 when writing has ended or room eligibility changes during
submission; 400 for invalid JSON, extra fields, invalid columns, or invalid text;
415 for non-JSON requests; 413 for bodies exceeding 16 KiB. There is no automatic
submission deduplication yet: a repeated successful POST creates another card.

## Reveal and Shared Cards

`POST /api/rooms/:id/reveal` requires `Authorization: Bearer <facilitator-secret>`
and no request body. It transitions writing to revealed and returns HTTP 200
with `{ "room": { ... } }`, excluding credentials. The transition validates the
domain rule and atomically rechecks writing phase, expiry, and facilitator hash
in SQLite. Concurrent reveals permit exactly one transition. Repeated reveals,
closed rooms, or eligibility changes during the write return 409. Already-expired
rooms return 404; missing, invalid, cross-room, participant, or query-string-only
credentials return 401.

After reveal, all card creation, editing, and deletion are rejected. Existing
atomic card-write guards also prevent an already-authorized request from writing
after the phase transition commits.

- `GET /api/rooms/:id/revealed-cards` requires a participant token registered in
  the room. Writing rooms return 409; revealed/closed rooms return all room cards.
- `GET /api/rooms/:id/facilitator/cards` requires the facilitator secret. Writing
  rooms return an empty list; revealed/closed rooms return all room cards.
- Both shared responses use `{ "cards": [{ "id": "...", "columnIndex": 0,
  "text": "..." }] }`. No owner hashes, participant identifiers, author grouping,
  or submission timestamps are included. SQL checks phase and expiry before
  returning shared text, independently of earlier API checks.
- The original `GET /api/rooms/:id/cards` always remains owner-only, including
  for stale writing screens. Expired rooms are inaccessible on every card route.

The room page displays a read-only shared board after it loads revealed/closed
metadata. Shared cards render as text with manual refresh and error/loading
states. The facilitator view now offers a cancelable confirmation before issuing
reveal. An interrupted or conflicting reveal triggers a metadata status check,
not an automatic POST retry. No reopening endpoint exists.

Visible room pages poll the existing authenticated metadata endpoint every 10
seconds after the previous request finishes. Participant registration is used
only when initially needed, not on background authentication failure. Requests
time out at 15 seconds. Hidden tabs perform their initial load, pause recurring
checks, and refresh on visibility return. Leaving the page aborts outstanding
requests and removes timers/listeners. Transient failures back off to 20, 40,
then 60 seconds, retaining the latest room while disabling writes. A successful
check clears the error; 401/404/409 terminal responses stop polling until an
explicit status check or reopening. Older responses cannot regress room phases.

On automatic reveal, a mounted writing board preserves unsent drafts and open
edits in a private recovery section instead of unmounting them. Saving stops
immediately and saved private cards are not duplicated in this section. Only
the submitted card contents appear on the shared board. Initial revealed-room
visits do not mount a writing board or load its private recovery state.

## Anonymous Voting

The voting API and shared-board voting controls are available after reveal.
Participants use their existing bearer token; only its room-scoped hash is
stored, with no voter profile, raw token, or voting timestamps. A facilitator
secret alone cannot cast votes; facilitators can join as participants separately.

- `PUT /api/rooms/:id/cards/:cardId/vote` ensures the caller has one vote on the
  card. There is no toggle POST: retries must not flip state or add votes.
- `DELETE /api/rooms/:id/cards/:cardId/vote` ensures the caller has no vote on
  the card, leaving everyone else's votes untouched. Removing an absent vote
  succeeds without changing totals.
- Both return HTTP 200 with `{ "vote": { "cardId": "...", "total": 1,
  "selected": true }, "remainingVotes": 2, "voteLimit": 3 }`. The `selected`
  flag and remaining budget describe only the caller. Request bodies are not
  used to select a voter, room, vote slot, or budget.

Each participant has three votes per room, at most one per card. Voting for your
own cards is allowed. Removing a vote frees a slot. Retrying a selected card at
the budget limit still succeeds; selecting a fourth distinct card returns 409
with `{ "error": "VOTE_BUDGET_EXCEEDED", "voteLimit": 3 }`.

`GET /api/rooms/:id/votes` returns `{ "votes": [{ "cardId": "...", "total": 1,
"selected": true }], "remainingVotes": 2, "voteLimit": 3 }`, including zero-count
cards. `GET /api/rooms/:id/facilitator/votes` requires the facilitator secret and
returns only `{ "votes": [{ "cardId": "...", "total": 1 }] }`. It does not
expose selections, voter hashes, per-participant budgets, or a participant list.
Both routes allow revealed/closed rooms and reject writing rooms with 409.

Mutations require an active, unexpired revealed room and a card in that room.
Writing/closed rooms return 409; expired registered rooms return 404. Missing,
malformed, unregistered, or wrong-role credentials return 401. A card from another
room and a nonexistent card return the same 404. The write transaction rechecks
phase, expiry, card membership, and voter membership; eligibility changes after
the API check also return 404 without a mutation.

Migration 0005 uses composite participant/card foreign keys, per-card uniqueness,
and three unique numbered slots per room/voter. Even direct writes cannot create
a fourth slot. The local driver executes the change and result queries in a
write-mode batch transaction, avoiding a read-count/write race and keeping the
returned budget/totals consistent. The budget constant and slot constraint must
be migrated together if the three-vote policy changes. Vote rows cascade away
with their card, participant, or room. Browser identity limitations remain the
same as anonymous joining: a token represents a browser session, not proof of
a distinct person.

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

## Close Room

`POST /api/rooms/:id/close` requires the room's facilitator bearer secret and no
request body. Only `revealed → closed` is allowed. HTTP 200 returns `{ room }`
with public fields only. Missing, incorrect, participant, or other-room secrets
return 401; an authenticated expired room returns 404. Writing/already-closed
rooms return 409 `INVALID_TRANSITION`. If phase, expiry, or capability changes
after authorization, the atomic update returns 409 `ROOM_CHANGED`.

Exactly one concurrent close succeeds. Closed rooms reject card mutations and
vote additions/removals, including requests from stale clients. Existing members
can still read cards and final votes; new joins are rejected. Closure preserves
the original expiry and does not delete data or permit reopening.

## Column Colours and Templates

Creation also accepts optional `columnColors`, an array with exactly one entry
per column. Allowed values: `sage`, `peach`, `blue`, `lavender`, `sand`. Unknown
colours, null, and mismatched lengths return 400 without creating a room. Omitting
colours assigns those defaults in column order. Room metadata includes
`columnColors` on creation, authenticated reads, reveal, and closure.

Templates are client-side presets for column names and colours. The API stores
only the final configuration, not a template ID. Names, order, and colours stay
fixed after creation. Arbitrary CSS values are not accepted.

## Optional Mood Check-in

Room creation accepts `moodCheckIn: boolean` (API default false for compatibility;
the web form sends true by default). Room metadata adds `checkIn`:
`off`, `open`, or `complete`. An open check-in is a pre-writing gate within the
existing `writing` lifecycle state; clients must inspect both fields. Existing
rooms migrate to `off`. Cards and reveal are blocked while check-in is open.

- `GET /api/rooms/:id/mood`: participant bearer token; returns `checkIn`, only
  that participant's `selected` mood (or null), and `totals`.
- `PUT /api/rooms/:id/mood`: participant token and JSON `{ "mood": "good" }`.
  Allowed values: drained, low, steady, good, energised. Null withdraws the
  answer. Idempotently replaces the participant's one answer; returns
  `{ "saved": true }`. Clients then read their current snapshot.
- `GET /api/rooms/:id/facilitator/mood`: facilitator secret; returns `checkIn`
  and `totals`, never a selection, participant hash, or response list.
- `POST /api/rooms/:id/start-writing`: facilitator secret, no body. Atomically
  changes an open check-in to complete and returns `{ room }`. No minimum
  response count is required. Repetition and competing starts return 409.

Totals are null until check-in completes, then contain five `{ mood, total }`
entries, including zero counts. Snapshot disclosure is gated in the SQL query.
Answers cannot change after completion. Room expiry/deletion blocks reads.

Invalid credentials return 401; authenticated expired rooms return 404. Invalid
mood JSON or extra fields return 400, non-JSON PUT returns 415, and a body larger
than 1 KiB returns 413. Ineligible mood writes return 409 `CHECK_IN_ENDED`;
ineligible start-writing returns 409 `ROOM_CHANGED`. Writes recheck membership,
state, and expiry atomically. Starting writing also rechecks facilitator access.

## Collaborative Grouping

Participants use `GET/PUT /api/rooms/:id/groups`; facilitators use
`GET/PUT /api/rooms/:id/facilitator/groups`, each with the corresponding bearer
credential. GET returns `{ "version": 0, "groups": [] }` initially. Each group
has a UUID `id`, a trimmed `name`, and `cardIds`. Reads require revealed or closed
state and exclude credentials, card authors, and individual voting selections.

PUT supplies the full `{ version, groups }` layout using the last read version.
Limits: 100 groups, 1–200 cards per group, 1–80 characters per name, and 64 KiB
JSON body. A card can occur only once across the layout; group IDs must be unique.
Every card must belong to this room. Empty groups are omitted when ungrouping.

Success returns `{ "saved": true }` and increments the revision atomically.
Clients read a fresh snapshot after every write, including uncertain failures.
A stale version or eligibility/membership change returns 409 `GROUPING_CHANGED`;
clients must review and explicitly retry, never replay stale layouts. Writing
and closed rooms reject PUT with 409 `GROUPING_NOT_OPEN`; writing GET returns
409 `CARDS_NOT_REVEALED`. Invalid credentials return 401, authenticated expired
rooms return 404, malformed payloads return 400, unsupported content types 415,
and oversized bodies 413. Group updates preserve cards and votes.
