# Architecture Notes

## Direction

Open Retro should keep a portable architecture so it can support both a public
hosted edition and a self-hosted edition later.

The first implementation should optimize for local development speed while
preserving clear boundaries between:

- browser UI;
- room workflow/domain rules;
- persistence;
- realtime room updates;
- rate limiting and abuse protection.

## Domain Concepts

- Room: a retrospective session with lifecycle state and configured columns.
  The facilitator configures the columns; each room supports at most five.
- Facilitator secret: private capability used to reveal, close, or delete a
  room.
- Participant token: private participant-side capability used for editing own
  cards and preventing duplicate votes.
- Card: anonymous text submitted into a room column.
- Vote: anonymous signal attached to a card after reveal.

## Room Lifecycle

1. Writing: participants submit and edit their own cards. Other cards are
   hidden.
2. Revealed: cards are visible and participants can vote.
3. Closed or deleted: the room is no longer active.
4. Expired: stale room data is removed automatically.

The phase sequence is strictly `writing → revealed → closed`. Repeated
transitions, skipping reveal, and reopening a room are rejected. Deletion and
expiration are separate retention operations to implement later, not alternate
phase transitions.

Domain rules live in `apps/api/src/domain/room.ts` without HTTP or database
dependencies. Creation validates one to five string column names, trims outer
whitespace, rejects blank names, preserves order, and starts in writing. Columns
are fixed after creation in the MVP; duplicate names are allowed. Domain
functions return a new room rather than modifying the input. A typed
`RoomRuleError` distinguishes column validation from invalid phase transitions.
Authorization belongs to later API work; knowing a valid transition does not
grant permission to perform it.

## Local Persistence

The SQLite adapter is in `apps/api/src/storage`. Drizzle queries use the local
libSQL driver, with no remote service. The room repository validates creation
through the domain model and stores random UUID IDs, columns as JSON, state,
and creation/expiry timestamps in Unix milliseconds. The initial lifetime is
24 hours. Reads return stored records, including expired ones; access denial
and physical cleanup belong to task 15 before public release.

Ordered SQL migrations run transactionally at startup and are recorded in
`schema_migrations`. The first migration creates `rooms` with state, JSON array
length, and timestamp constraints plus an expiry index. The TypeScript schema
describes queries; SQL migrations are the source of database constraints and
must be kept consistent with it. Never modify a migration already applied.

Docker Compose persists the database in a named volume. Connection/migration
failures prevent API startup. API shutdown closes the database connection.
Migration 0002 adds a nullable facilitator secret hash, preserving existing
local rooms without inventing recoverable credentials. New API-created rooms
store a SHA-256 hash of a random 256-bit capability. Repository metadata reads
explicitly project public fields to exclude hashes. See [API notes](api.md).

`createApp` receives the room repository as a dependency, allowing HTTP tests to
use temporary databases. Creation validates JSON with Zod and domain rules before
insertion. The creation response alone returns the raw facilitator secret.
A protected facilitator metadata endpoint validates bearer credentials and
denies expired rooms; lifecycle mutation endpoints remain later tasks. The API
does not expose storage-only or secret-recovery endpoints.

Migration 0003 adds participant token hashes keyed by room, with cascading room
deletion. Join requests register a hash idempotently; participant reads require
registration in that room. Both endpoints return only public room metadata.
No participant list, token hashes, counts, or identifiers reach facilitators.
New joins are denied after closure; existing participants retain read access.

The browser generates room-specific 256-bit participant tokens and saves them
in local storage. Facilitator fragments are consumed before requests and removed
with `history.replaceState`; the private credential is saved separately in
room-specific session storage. Storage failures receive explicit UI feedback.
Neither credential is sent in query strings, shareable participant links, or
ordinary response payloads. As with all browser bearer tokens, scripts running
on this origin can access browser storage; keep third-party scripts out of the
application and continue treating user text as text. Sessions are anonymous,
not proof of distinct people. Client credential cleanup remains retention work.

## Privacy Boundaries

Migration 0004 adds cards with room and composite participant foreign keys, plus
a room/owner index. The card repository is composed into the existing room
repository interface. Submission uses a parameterized `INSERT ... SELECT` that
atomically checks phase, expiry, membership, and column existence. The API
validates nonempty text up to 2000 characters and a valid zero-based column index.
Private reads filter by both room and owner hash in SQL and project only card
ID, column index, and text. They never retrieve another participant's card data.

Private participant card reads remain owner-only regardless of phase; shared
participant reads use a separate authenticated endpoint. Protected facilitator
card reads return an empty list during writing and shared cards after reveal. No
HTTP endpoint accepts a client-supplied owner hash or provides an individual
card lookup in this slice. Raw tokens, owner hashes, and writing timestamps are
not part of card responses. Cards currently store no writing timestamps.

Owned card mutations use PATCH (text only) and DELETE endpoints. A shared
participant middleware authenticates collection and single-card mutation paths.
SQL mutations constrain card ID, room ID, owner hash, writing phase, and expiry
in one statement; a stale initial check cannot authorize a late mutation. Card
foreign keys preserve participant membership. Missing and foreign cards share
the same 404 response. Successful updates return safe fields; deletion returns
204 with no content. No schema change was needed for this task.

The writing board keeps edit state local to the saved-card component and allows
one edit/confirmation at a time. It disables refresh until that state is closed,
preserves failed edits, and changes saved cards only after API confirmation.
There is no optimistic concurrency version; concurrent edits are last-write-wins.

Reveal authorization shares facilitator middleware with metadata/card reads.
The reveal operation checks the domain transition and uses an atomic conditional
update matching room ID, writing state, current facilitator hash, and expiry.
Exactly one concurrent request can reveal a room; later requests conflict.
Card writes already contain matching phase guards, so committed reveal freezes
further mutations without depending on UI state.

Shared card queries independently constrain room, expiry, and revealed/closed
state, projecting only card ID, column index, and text. Stable random card IDs
provide ordering without author grouping or writing timestamps. No migration
was needed. The room page selects a read-only shared board from room metadata;
stale writing views continue to use owner-only reads.

`useRoom` owns metadata loading, initial participant registration, and one
non-overlapping polling loop per visible view. It uses a 10-second interval,
15-second request timeout, and bounded exponential backoff (20/40/60 seconds).
Hidden pages load once but pause recurring requests; visibility return checks
immediately. Cleanup aborts in-flight work and clears timers/listeners. Terminal
authentication/availability errors stop polling, and transient errors retain
room state while disabling mutations. Monotonic phase acceptance prevents a
stale writing response from undoing a confirmed reveal.

`RevealControl` confirms the irreversible transition and sends one guarded POST.
Success updates local room state immediately; uncertain/conflicting results
request metadata instead of replaying the mutation. Polling carries that phase
to other visible views. The writing board remains mounted across a phase change
when it was already open, preserving draft/editor state for copying. Its recovery
section is private and hidden if empty; submissions and mutation controls stop.
Shared cards use their own endpoint and component, with no ownership metadata.

- Facilitator access and participant access must use separate secrets.
- Participant identifiers must not be exposed in facilitator responses.
- Stored participant tokens should be hashed rather than stored directly.
- Application data should not include participant names, emails, or IP
  addresses.
- Analytics and tracking should be off by default.

## Deployment Implications

The local stack can start simple, but the design should not assume a single
hosting provider. Later deployment targets may include:

- Cloudflare Workers, Durable Objects, D1, and Pages for a free public hosted
  edition.
- Docker Compose, a portable backend, and PostgreSQL for self-hosting.
