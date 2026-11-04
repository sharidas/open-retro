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
