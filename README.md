# Open Retro

Open Retro is a planned free and open-source retrospective tool for teams that
need anonymous feedback without accounts, tracking, or hidden paywalls.

The project is in early development. You can create a room with one to five
configured columns and receive separate participant and facilitator links.
Participants can join anonymously and facilitators can open their private room
view. Participants can write, edit, delete, and reload their own private cards.
Facilitators can reveal cards and open room views update automatically. Participants can vote after reveal, see their remaining votes and shared totals,
and switch to a most-voted discussion view. Facilitators can close the room to
freeze voting while keeping the final board readable.

## Run Locally With Docker

Prerequisites: Docker Engine or Docker Desktop with Docker Compose, and Git.
Node.js and npm run inside the development container; no host installation is
required. Docker downloads the base image and packages on the first build.

```bash
docker compose up --build
```

Open [Open Retro locally](http://localhost:5173). The page displays the room
creation form. Only localhost can access the published port.
Stop with Ctrl+C, then use `docker compose down` to remove the container.

For background operation, use `docker compose up --build -d` and view output with
`docker compose logs -f dev`.

Source files are mounted from your checkout: edit `apps/web/src` or
`apps/api/src` and the development servers reload automatically. After changing
dependencies, TypeScript configuration, or Docker configuration, rebuild with
`docker compose up --build`. This container is for development, not production.
Rerun that command after switching branches to refresh the container and mounts.

Run verification inside the running container:

```bash
docker compose exec dev npm run check
docker compose exec dev npm test
docker compose exec dev npm run build
```

`check` validates TypeScript, including API and frontend tests; `test` runs the
API/domain/storage and frontend polling tests once using Vitest. Frontend tests
use jsdom to check browser state without launching a browser. `build` compiles
the API and bundles the frontend.
Neither installs anything on your machine. Container dependencies and build
outputs stay inside the container.

## How the Foundation Works

- `apps/web`: React and TypeScript UI, served by Vite on port 5173.
- `apps/api`: Hono API running on Node.js, internally on port 3000.
- The form sends `POST /api/rooms`; Vite forwards `/api` requests to Hono,
  which validates the request and saves the room. `/api/health` remains available.
- npm workspaces manage both applications with one dependency lockfile.

React/Vite provide the interactive UI and fast feedback while editing. Hono
keeps the API small and supports a future Cloudflare adapter. CSS Modules scope
styles to components. Room rules live in `apps/api/src/domain/room.ts`, separate
from HTTP and storage. Vitest checks them in `apps/api/tests/room.test.ts` without
starting a server or database. Database tests use temporary SQLite files that
are removed afterward. API tests exercise HTTP requests against temporary databases.

## Local Room Storage

SQLite stores room IDs, configured columns, lifecycle phase, creation time, and
expiry time. Drizzle handles typed queries through the local libSQL SQLite
driver; it does not connect to a hosted database or require an account.

On API startup, numbered SQL files in `apps/api/migrations` run in order.
`schema_migrations` records which have succeeded, so restarting does not reapply
them. Each migration is transactional: its changes and completion record commit
together or roll back together. Add a new migration for future schema changes;
do not edit an applied one. A migration is a versioned change to database tables.

Compose sets `DATABASE_PATH=/app/data/open-retro.sqlite` and stores `/app/data`
in the `retro-data` Docker volume. This data survives restarts, rebuilds, and
`docker compose down`. Removing the volume (for example with `down -v`) deletes
the stored data. Database files and their sidecars are excluded from Git and
the Docker build context.

`apps/api/src/storage/rooms.ts` provides create/read operations, validating room
rules before saving. New rooms receive a random UUID and expire 24 hours after
creation; timestamps are Unix milliseconds. The creation API stores a separate
facilitator secret hash; ordinary storage reads exclude it. General expiry
enforcement and cleanup are task 15; the storage lookup currently returns expired
records too. The protected facilitator endpoint already denies expired rooms.
The creation form starts with the Classic retro template. Add/remove columns
within the one-to-five limit, then submit to save the room. Blank names show
inline errors; API failures preserve your input. While saving, controls are
disabled to prevent duplicate submissions. Failed requests are not retried
automatically because creation may already have succeeded on the server.

After success, copy the participant link for teammates and save the facilitator
link privately. The facilitator secret is in a URL fragment (`#secret=...`), not
the path or query string, so browsers do not send it in HTTP requests. Links are
kept in page memory on the creation screen; save them before refreshing or
creating another room. Clipboard failures select the text for manual copying.

Participant links now open the configured room. The browser generates a random
room-specific token and keeps it in local storage so reloads reuse the same
anonymous session. Joining sends the token in an authorization header; the server
stores only a hash. Tokens and participant identifiers are not exposed in room
responses, including facilitator responses. Another profile/incognito session
has its own token; clearing site storage loses the old session and its ownership.
If local storage is blocked, the page explains that it is needed to join.

Opening a facilitator link consumes its fragment and removes it from the address
bar before API calls. The secret is kept in room-specific session storage for
reloads in that tab. Keep the original private link for future sessions; copying
the stripped address does not grant access in a fresh tab. If session storage
is blocked, access lasts only for the current page and a warning is displayed.
Facilitator access does not create a participant session automatically. Both
views show configured columns, phase, expiry, and a safe participant share link.
Participants can write and view their own saved cards in the room. Facilitators
can reveal cards and close the retrospective; deletion remains a later task.

## Private Writing Board

Open a participant link to load your saved cards and write into any configured
column. Each card accepts 1–2000 characters. Saving disables submission while
the request is pending, clears the draft only after confirmed success, and shows
the saved card in its column. Cards render as plain text, preserving line breaks.
Only this participant's cards are requested; the facilitator page has no card
text or writing form.

Use “Refresh my cards” to reload saved cards without losing unsent drafts.
Connection failures keep drafts on the page. If a save is interrupted, check
saved cards before retrying because the server may have accepted the request.
Writing-phase, expiry, and authorization errors prevent further saves while
leaving drafts available to copy. Drafts are not stored in browser storage and
are lost on navigation/reload; saved cards persist in SQLite. The interface warns
against entering secrets or sensitive information and stacks columns on mobile.
Use “Edit card” to change a saved card's text, or “Cancel edit” to keep the saved
version. Deleting requires an inline confirmation and cannot be undone. The API
permits both operations only for the owner while the room is unexpired and in
the writing phase. Refresh is disabled while editing or confirming deletion so
unsaved edits are not discarded. Failed edits preserve the editor text; after
an interrupted request, cancel and refresh saved cards to check the result.
Facilitators can select “Reveal cards”, review the warning, and confirm or keep
writing. Confirmed reveal ends writing and opens the read-only shared board.
Visible participant views update automatically without reloading. Unsent drafts
and open edits stay on the page under “Your unsent writing — not shared”, with
saving disabled so you can copy them before leaving. Empty recovery sections
are hidden. These drafts are never submitted automatically.
Narrow-screen verification remains pending from task 08.

## Private Card API

Registered participants can submit cards with `POST /api/rooms/:id/cards` using
their bearer token and JSON `{ "columnIndex": 0, "text": "Sprint feedback" }`.
Column positions are zero-based. Text is trimmed and must contain 1–2000
characters. Only active writing-phase rooms accept cards.

`GET /api/rooms/:id/cards` returns only that participant's cards. Ownership is
filtered in the database and never included in response payloads. The protected
`GET /api/rooms/:id/facilitator/cards` returns an empty list during writing and
all anonymous cards after reveal. Participants use the separate authenticated
`GET /api/rooms/:id/revealed-cards` endpoint for shared cards; the private card
endpoint remains owner-only to keep stale writing screens safe.
See the [API notes](docs/api.md) for validation and privacy behavior.

## Reveal and Room Updates

`POST /api/rooms/:id/reveal` with `Authorization: Bearer <facilitator-secret>`
ends writing and reveals the room's cards together. It requires no request body.
Only the correct room's facilitator can reveal; repeated reveals return 409.
Expired rooms cannot be revealed. Card creation, editing, and deletion are
rejected after reveal, including requests from stale tabs.

The shared board shows cards without author labels, ownership hashes, or
submission timestamps, with manual card refresh and no mutation controls.
Room metadata refreshes every 10 seconds after a completed request while the
page is visible. Hidden tabs load once, pause recurring checks, and check again
when visible. Leaving the view cancels requests and timers.

Transient failures retain the last room and unsent text, pause saving, and retry
after 20, 40, then at most 60 seconds. “Check room status” retries immediately.
Authorization failures and unavailable rooms stop automatic checks. Requests
time out after 15 seconds and do not overlap. Reveal requests are not retried
automatically; an interrupted request triggers a status check instead. A stale
writing response cannot undo a confirmed revealed or closed phase.

## Anonymous Voting API

After reveal, registered participants can use `PUT /api/rooms/:id/cards/:cardId/vote`
to select a card and `DELETE` on the same path to remove their vote. Both use the
participant bearer token, take no voting data from the body, and are idempotent:
repeated requests do not add duplicates or affect anyone else's votes.

Each participant has three votes per room, at most one per card. Participants
may vote for their own cards. Removing a vote restores one available vote.
Writing, closed, and expired rooms reject vote changes. Participant snapshots
come from `GET /api/rooms/:id/votes`; facilitator totals come from the protected
`GET /api/rooms/:id/facilitator/votes`. Only the participant sees their own
selections and remaining budget; facilitators receive card totals without voter
identifiers.

The shared board provides Vote and Remove controls, a remaining-vote counter,
and By column / Most voted views. Most voted ranks cards across all columns,
with stable card-ID ordering for ties. Facilitators see totals without voting
controls; they can join through the participant link to cast their own votes.
Totals refresh every ten seconds while the revealed board is visible. Failed
or uncertain requests pause voting until a fresh snapshot confirms the state;
vote changes are not automatically replayed. Closed boards show read-only totals.

Migration 0005 adds room-scoped votes with participant/card foreign keys, one
vote per participant/card, and three unique vote slots per participant/room.
The slot constraints prevent overspending even under concurrent requests. Each
change and its returned snapshot run in a single local SQLite write transaction.

The room model accepts one to five nonempty column names, trims surrounding
whitespace, preserves column order, and starts in the writing phase. The allowed
sequence is `writing → revealed → closed`; skipping, reopening, and repeating
transitions fail. Creation validates these column rules on the server. Reveal and closure are
protected facilitator actions. Column names/order are
fixed at creation for the MVP. Duplicate names are currently allowed.

Development runs locally. The public deployment must stay within a $0 budget:
use free services only, accept quota-related unavailability, and do not enable
paid plans. No Cloudflare account is needed for this task.

## Goal

Build a privacy-focused retrospective application that supports:

- a free public hosted version;
- a self-hosted version for companies that cannot use external tools;
- anonymous participants with no names, emails, or accounts;
- private writing followed by facilitator-controlled reveal;
- anonymous voting and discussion.

## MVP Scope

The first version should stay intentionally small:

- create a room;
- join a room through a participant link;
- let the facilitator configure up to five retrospective columns;
- submit anonymous cards;
- keep cards hidden during the writing phase;
- reveal cards only when the facilitator chooses;
- vote anonymously;
- delete rooms immediately;
- expire rooms automatically;
- apply basic rate limiting;
- work well on mobile devices.

The first version will not include accounts, social login, integrations,
AI summaries, file uploads, paid plans, permanent history, or analytics.

## Privacy Principles

- Do not request or store participant names.
- Do not request or store participant email addresses.
- Do not expose participant session identifiers to facilitators.
- Store only hashes of participant tokens when tokens are needed.
- Use cryptographically unguessable room identifiers.
- Keep facilitator access separate from participant access.
- Provide immediate room deletion.
- Delete expired rooms automatically.
- Do not enable analytics or tracking by default.
- Do not store IP addresses in application data.

## Current Status

See:

- [Project brief](PROJECT_BRIEF.md)
- [MVP plan](docs/mvp.md)
- [Step-by-step implementation plan](docs/implementation-plan.md)
- [Architecture notes](docs/architecture.md)
- [Room API and facilitator access](docs/api.md)

## License

MIT. See [LICENSE](LICENSE).

## Closing a Retrospective

After reveal, the facilitator can choose **Close room**, then **Confirm close**.
**Keep discussing** cancels without changing the room. Closure cannot be undone:
voting stops, new participants cannot join, and existing participants and the
facilitator retain read access to cards and final totals until expiry or deletion.
Open participant views detect closure automatically; the server also rejects
writes from stale tabs immediately. Network failures trigger a room-status check
instead of automatically repeating the close request.

## Board Workspace

Room pages use a wide board with a compact phase toolbar. **Invite team** reveals
the participant share link; **Room details** contains expiry and session guidance.
Access failures and storage warnings remain visible outside these disclosures.
Pastel columns and light cards help separate topics. Choose from four template previews or start from scratch. Before creation, edit
column names and choose Sage, Peach, Blue, Lavender, or Sand for each column.
The room saves these choices for both participants and the facilitator.

### Retro Templates

| Template | Columns |
| --- | --- |
| Classic retro | Went well · Could improve · Next steps |
| Start, Stop, Continue | Start · Stop · Continue |
| Mad, Sad, Glad | Mad · Sad · Glad |
| 4Ls | Liked · Learned · Lacked · Longed for |

Selecting a template replaces the current draft configuration. Customise it
before creating the room, keeping between one and five columns. Existing rooms
receive the previous default pastel colours automatically during migration.

## Team Mood Check-in

New rooms offer **Begin with an optional team mood check-in**, enabled by default
in the form. Turn it off to go straight to writing. Existing rooms are unchanged.
Participants can choose Drained, Low, Steady, Good, or Energised, change their
choice, withdraw it, or simply wait without answering.

During check-in, only the participant can retrieve their own selection; other
participants and the facilitator cannot see individual answers or totals.
The facilitator confirms **Start writing** when the team is ready. This freezes
answers, reveals five aggregate counts, and enables private cards. No one must
answer before writing can start. Results stay readable until room expiry or
deletion. Facilitators use the participant link if they want to answer too.

## Collaborative Card Grouping

After reveal, open **Groups**. Participants and facilitators can select cards
from any column, enter a name, and create a group. Select cards and use **Move
selected** to move them into an existing group, or **Ungroup selected** to take
them out. **Rename group** changes its label; **Ungroup all cards** dissolves the
group without deleting anything. Empty groups disappear automatically.

Cards retain their original text, column, and votes. Group totals are explicitly
the sum of card votes, not unique people. The By column and Most voted views
continue to show individual cards. Group changes refresh while the Groups view
is open. Conflicting changes ask you to review the latest layout before retrying;
uncertain requests are never automatically replayed. Closure freezes grouping.

### Writing timer and readiness

After check-in, the facilitator can start a timer, pause/resume it, or add
minutes (up to 60 minutes remaining). The shared timer survives reloads.
Expiry is a prompt: writing stays open until the facilitator reveals the board.

Participants can choose **I’m finished writing** and undo with **I’m still
writing**. Save or clear unsent drafts first. Only the facilitator sees the
anonymous ready/total count. The total counts joined browser sessions, including
people who have left; it is not live attendance. Facilitators contributing cards
through the participant link use the same readiness controls.

Timer changes use revision checks to prevent competing facilitator tabs from
overwriting each other. Interrupted changes are reconciled without automatic
retries. Participants receive only their own readiness, never the team count.
