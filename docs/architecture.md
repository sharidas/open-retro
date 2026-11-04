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
denies expired rooms; lifecycle mutation endpoints and participant access remain
later tasks. The API does not expose storage-only or secret-recovery endpoints.

## Privacy Boundaries

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
