# Open Retro

Open Retro is a planned free and open-source retrospective tool for teams that
need anonymous feedback without accounts, tracking, or hidden paywalls.

The project is in early development. The first local development slice provides
a React page connected to an API health endpoint; retrospective features are
not implemented yet.

## Run Locally With Docker

Prerequisites: Docker Engine or Docker Desktop with Docker Compose, and Git.
Node.js and npm run inside the development container; no host installation is
required. Docker downloads the base image and packages on the first build.

```bash
docker compose up --build
```

Open [Open Retro locally](http://localhost:5173). The page should display
“Connected — the server is ready.” Only localhost can access the published port.
Stop with Ctrl+C, then use `docker compose down` to remove the container.

For background operation, use `docker compose up --build -d` and view output with
`docker compose logs -f dev`.

Source files are mounted from your checkout: edit `apps/web/src` or
`apps/api/src` and the development servers reload automatically. After changing
dependencies, TypeScript configuration, or Docker configuration, rebuild with
`docker compose up --build`. This container is for development, not production.

Run verification inside the running container:

```bash
docker compose exec dev npm run check
docker compose exec dev npm test
docker compose exec dev npm run build
```

`check` validates TypeScript, including the API tests; `test` runs the room-rule and database
tests once using Vitest; `build` compiles the API and bundles the frontend.
Neither installs anything on your machine. Container dependencies and build
outputs stay inside the container.

## How the Foundation Works

- `apps/web`: React and TypeScript UI, served by Vite on port 5173.
- `apps/api`: Hono API running on Node.js, internally on port 3000.
- The browser requests `/api/health`; Vite forwards `/api` requests to Hono,
  which returns JSON. The page displays the result and offers retry on failure.
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
The UI is unchanged; the creation screen comes in task 05.

The room model accepts one to five nonempty column names, trims surrounding
whitespace, preserves column order, and starts in the writing phase. The allowed
sequence is `writing → revealed → closed`; skipping, reopening, and repeating
transitions fail. Creation validates these column rules on the server; lifecycle
mutation endpoints will be added in later tasks. Column names/order are
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
