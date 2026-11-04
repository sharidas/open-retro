# Implementation Plan

## Working Together

Build one small, reviewable task at a time. Each task should normally fit in
one coding session; split it further if it becomes difficult to explain or demo.

For every task:

1. Explain the intended behavior and the main concept involved before coding.
2. Implement only the agreed task and its necessary supporting changes.
3. Run focused checks appropriate to the change.
4. Give a short walkthrough: what changed, why, how to try it, and any limits.
5. Mark the task complete here only when its acceptance criteria pass.

Use plain language and explain new technical terms when they first appear.
Keep the application runnable after each implementation task. At each milestone,
pause for a demo and feedback before starting the next milestone.

## Commit and Push Checkpoints

- Use `feat/`, `fix/`, or `docs/` feature branch prefixes, without `codex/`.
  Create the branch before implementation and report its name with commit details.

- Commit after each completed task when its focused checks pass and the changes
  form one understandable unit. A planning-only update can be its own commit.
- Before recommending a commit, review the diff and working tree for unrelated
  changes, secrets, generated files, and local database data. Summarize the checks
  and suggest a commit message with a concise summary line, a blank line, and a
  descriptive body. The body should explain what changed and why, plus relevant
  verification results or limitations. Scale the detail to the change; avoid
  merely repeating the summary or listing filenames.
- Explain that a commit saves a local checkpoint; a push copies committed changes
  to the remote repository for backup and collaboration.
- Recommend pushing after each verified task commit, or a small related group of
  commits, and at milestone completion or the end of a working session.
- Explicitly tell the user when a commit or push checkpoint is reached. Do not
  commit or push automatically unless the user authorizes those actions.
- If a task is unfinished or checks fail, explain what remains before the normal
  checkpoint rather than calling it complete.

## Technical Starting Point

Use the direction already described in the MVP plan: React with TypeScript,
a TypeScript API, SQLite for local storage, and polling initially for room updates.
Choose specific libraries and record their rationale during setup. Keep domain
rules separate from HTTP handlers and database operations so later hosting changes
do not require rewriting the workflow.

Start with a local application. Public hosting and PostgreSQL support are later
milestones, not dependencies of the first working retrospective.

Use Docker Compose for development from task 01 so contributors do not need
Node.js or npm installed on their machine. The production self-hosting package
in task 18 remains separate from this development container. Public deployment
has a firm $0 budget; do not enable paid services or automatic paid upgrades.

## Proposed Product Defaults

These are planning assumptions to review before implementing the affected task:

- A room has between one and five columns. Start with three editable suggestions:
  “Went well”, “Could improve”, and “Ideas for next sprint”.
- Column names and order are chosen at creation and fixed once the room exists
  for the first version.
- Writing is private for everyone, including the facilitator. A participant sees
  only their own cards before reveal.
- Revealing ends writing. Cards cannot be added, edited, or deleted afterward.
- Each participant can toggle one vote per card, with a budget of three votes
  per room. The API enforces this transactionally.
- Closing freezes voting and leaves a read-only board until deletion or expiry.
- Rooms expire 24 hours after creation; access is denied as soon as they expire,
  even if physical cleanup has not run yet.
- Losing the facilitator link means losing control; no account-based recovery
  in the MVP.

Anonymous browser tokens enforce ownership and voting within a session. They
cannot guarantee one person equals one participant: another browser or cleared
storage can create another participant. Document this limitation clearly.

## Milestone 1: Runnable Local Foundation

- [x] **01 — Bootstrap the application.** Add the frontend, API, development
  commands, and a minimal page connected to an API health endpoint.
  Done when a fresh checkout can start using documented commands.
  Learn: browser versus server, TypeScript, and the development loop.
  Completed with a Docker Compose development container, React/Vite frontend,
  Hono API, and documented startup commands. Verified container image build,
  TypeScript checks, production compilation, proxied health response, and the
  connected state in a browser. Dependency installation reported no known
  vulnerabilities. No host Node.js installation is required.
- [x] **02 — Define the room rules.** Model columns and writing/revealed/closed
  states as domain rules. Validate one to five nonempty column names and allowed
  transitions. Add focused tests for invalid input and transitions.
  Done when rules can be exercised independently of the UI and database.
  Learn: domain models, validation, and unit tests.
  Completed with independent room creation/transition functions and typed rule
  errors. Names are trimmed; one to five nonempty names are required. Only
  writing-to-revealed and revealed-to-closed transitions are allowed. Vitest
  runs inside Docker; all 28 tests, TypeScript checks, and the production build
  passed. HTTP integration and facilitator authorization remain later tasks.
- [x] **03 — Add persistent rooms.** Introduce a SQLite schema and migration,
  create/read operations, and expiration timestamps.
  Done when a saved room survives an API restart.
  Learn: databases, migrations, and persistence boundaries.
  Completed with Drizzle/local libSQL SQLite storage, a transactional initial
  migration, validated create/read operations, random room IDs, and creation/
  expiry timestamps. Docker persists the database in a named volume. All 34
  tests (including six storage tests), TypeScript checks, and production builds
  passed. A temporary room survived a real container/API restart; the health
  endpoint remained reachable afterward. HTTP room access, facilitator secrets,
  and expiry enforcement remain assigned to later tasks.

Demo: open the app, reach the API, and verify that room data persists.

## Milestone 2: Create and Join a Room

- [x] **04 — Create rooms through the API.** Generate unguessable room IDs and
  a separate facilitator secret; store only its hash. Return the raw secret only
  on creation. Reject invalid column configurations on the server.
  Done when creation works and invalid or missing facilitator credentials cannot
  authorize privileged operations.
  Learn: API contracts and capability-based access.
  Completed with validated `POST /api/rooms`, a one-time 256-bit facilitator
  secret, stored SHA-256 hashes, and a protected facilitator metadata endpoint.
  Migration 0002 preserves legacy rooms without granting facilitator access.
  Missing, invalid, cross-room, and expired access are rejected; metadata reads
  omit secrets/hashes. All 55 tests, TypeScript checks, production build, and a
  live Vite-to-API creation/authorization check passed. Reveal, close, deletion,
  participant joining, and rate limiting remain their planned tasks.
- [x] **05 — Build the creation screen.** Add room creation with editable column
  names, adding/removing columns up to five, and clear validation messages.
  Done when the UI creates a room and displays separate participant and
  facilitator links, explaining that the facilitator link must stay private.
  Learn: forms, client validation, and server validation.
  Completed with editable default prompts, add/remove controls for one to five
  columns, inline blank-name errors, pending/error handling, and separate
  copyable links. Facilitator secrets use URL fragments; links remain in page
  memory only. Browser checks passed for column limits, validation, API rejection,
  five-column creation, link separation, copy feedback, and a narrow-screen
  layout. TypeScript checks, production build, and all 55 API/domain/storage
  tests passed. Link destinations show preview notices until task 06.
- [x] **06 — Join anonymously.** Add participant and facilitator routes and
  room-scoped participant tokens, storing only token hashes on the server.
  Keep secrets out of ordinary share links, response payloads, and application
  logs; choose and document browser storage and link handling.
  Done when two browser sessions join independently without names or accounts.
  Learn: browser sessions, authentication, and authorization.
  Completed with idempotent anonymous joining, room-scoped hash registration,
  participant/facilitator views, and configured column displays. Participant
  credentials use local storage; facilitator fragments are consumed and removed
  from the address bar, with tab session storage supporting reloads. All 65 tests,
  type checks, and production build passed. Browser checks used localhost and
  127.0.0.1 as storage-isolated sessions; the database confirmed two distinct
  hashes and no duplicate after reload. Facilitator reload and missing-secret
  denial also passed. Writing and lifecycle controls remain later tasks.

Demo: create a five-column room and join it from a separate browser session.

## Milestone 3: Private Writing

- [x] **07 — Submit and retrieve private cards.** Store cards with their room,
  column, and owner hash. Filter responses on the server during writing.
  Done when direct API requests prove other participants and the facilitator
  cannot retrieve someone else's card text or ownership identifiers.
  Learn: privacy boundaries and response shaping.
  Completed with a cards migration, validated submission endpoint, owner-only
  reads filtered in SQL, and an authenticated facilitator card endpoint that
  returns no cards until reveal is implemented. Card responses exclude ownership
  identifiers. Atomic insertion rechecks phase, expiry, membership, and column
  existence. All 87 tests, TypeScript checks, production build, and a live API
  privacy check passed. Text is capped at 2000 characters; the writing interface
  remains task 08, editing/deletion task 09, and reveal task 10.
- [ ] **08 — Build the writing board.** Render configured columns and allow
  participants to submit and see their own cards. Include loading/error states
  and the brief warning against entering secrets or sensitive information.
  Done when two participants can write privately, including on a narrow screen.
  Learn: UI state and accessible forms.
  Implementation is ready: participant-only writing forms, saved-card loading,
  refresh without draft loss, blank validation, 2000-character limits, pending
  states, and safe plain-text rendering. Two origin-isolated browser sessions
  confirmed private cards and reload persistence; facilitators saw no card text.
  A stale-phase rejection preserved the editable draft and disabled saving.
  All 87 existing tests, TypeScript checks, and production build passed.
  Narrow-screen verification remains outstanding: the browser viewport override
  kept reporting a 1280px viewport despite a requested 375px width. Responsive
  styles are implemented, but this task stays unchecked until that acceptance
  check is verified.
- [x] **09 — Edit and delete owned cards.** Add API authorization and UI controls.
  Done when owners can change their cards during writing, while another token,
  another room, or a later phase cannot authorize the same changes.
  Learn: ownership checks and negative tests.
  Completed with owner-only text edits, cancelable editors, and inline deletion
  confirmation. Atomic SQL mutations enforce room, owner, phase, and expiry;
  foreign and missing cards return the same 404. All 108 tests, TypeScript
  checks, and the production build passed. Browser checks verified edit/cancel,
  blank validation, reload persistence, delete confirmation/cancellation, and
  retained editable text after stale-phase rejection. A live API check verified
  successful edit/delete and subsequent empty reads. Task 08's narrow-screen
  acceptance check remains pending independently.

Demo: use two browser sessions to demonstrate private writing and ownership.

## Milestone 4: Reveal and Shared Updates

- [x] **10 — Reveal through the facilitator API.** Implement the writing-to-
  revealed transition and reject subsequent card mutations on the server.
  Done when only a valid facilitator can reveal and participants then receive
  anonymous cards without owner identifiers.
  Learn: state transitions and server-enforced rules.
  Completed with facilitator-only atomic reveal, shared anonymous card reads,
  and a read-only board after room reload. Private card reads remain owner-only
  to protect stale writing screens. All 123 tests, TypeScript checks, production
  build, and a live privacy/reveal check passed. Browser checks confirmed shared
  cards, no edit/write controls, manual refresh, and reload persistence. The
  reveal button and polling remain task 11; task 08's mobile check is still pending.
- [x] **11 — Add reveal controls and polling.** Show facilitator controls and
  refresh board state at a bounded interval. Handle stale tabs, failures, and
  stop polling after leaving the room.
  Done when all open sessions see reveal without manually reloading.
  Learn: synchronization and stale client state.
  Completed with cancelable reveal confirmation and visible-view metadata
  polling every 10 seconds. Hidden views pause, transient failures back off,
  terminal failures stop, and unmount cancels work. Phase acceptance is monotonic.
  Private draft/editor state survives reveal in a recovery section with saving
  disabled. Browser checks verified one facilitator and two origin-isolated
  participants updating without reload; unsent text remained private and intact.
  All 135 tests (123 API/domain and 12 frontend), TypeScript checks, production
  build, and diff checks passed. Task 08's narrow-screen check remains pending.

Demo: reveal once and watch both participant boards update.

## Milestone 5: Vote and Finish

- [x] **12 — Implement anonymous voting.** Enforce phase, room membership,
  per-card uniqueness, and the vote budget using database constraints and
  transactions. Test repeated and concurrent requests.
  Done when duplicate requests cannot inflate votes or exceed the budget.
  Learn: constraints, transactions, and concurrency.
  Completed with idempotent PUT/DELETE voting, three room-scoped vote slots,
  composite foreign keys, and transactional result snapshots. Participants see
  totals plus their own selections/budget; facilitators see only totals. All 156
  tests (including 21 voting tests), type checks, production build, and a live
  concurrency/privacy check passed. Independent database connections cannot
  overspend the budget. Task 08's narrow-screen check remains pending.
- [ ] **13 — Build voting and discussion views.** Show vote totals, remaining
  votes, and a way to prioritize most-voted cards without exposing voters.
  Done when participants can add/remove their own votes and see shared totals.
  Learn: shared state and interaction feedback.
  Implementation complete: participant add/remove controls, remaining budget,
  shared totals, facilitator totals-only view, and global most-voted ordering.
  All 180 tests (144 API/domain and 36 frontend), TypeScript checks, and production
  build passed. Browser verification reached the revealed five-column board;
  final budget/undo, peer totals, ordering, reload, and closed-view checks remain
  pending because the browser tool connection failed. Leave this task unchecked
  until those browser checks are completed.
- [x] **14 — Close the room.** Add facilitator-only closure and read-only UI.
  Done when closed rooms reject card mutations and votes, including from stale
  clients, while remaining readable until deletion or expiry.
  Learn: lifecycle completion.
  Completed with facilitator-only atomic closure, explicit confirmation/cancel,
  and final read-only cards and votes. All 197 tests (154 API/domain and 43 web),
  TypeScript compilation, and production build passed. Live browser checks
  covered writing, reveal, voting, closure, automatic participant updates, and
  reload persistence. Task 13's remaining budget/peer/order checks and task 08's
  narrow-screen check remain tracked separately.

Demo: run a complete short retro from creation through discussion and closure.

## Milestone 6: Retention and Release Readiness

- [ ] **15 — Delete and expire rooms.** Implement facilitator deletion, cascading
  removal of cards/votes/tokens, expiry access checks, and scheduled cleanup.
  Done when deleted and expired rooms are inaccessible and cleanup removes all
  associated database records. Document backup/log retention separately.
  Learn: data lifecycle and background jobs.
- [ ] **16 — Add abuse protection.** Choose documented limits for room creation,
  joining, card size/count, and request frequency. Avoid persistent IP storage
  in application data. Return useful errors when limits are reached.
  Done when limits are enforced at the API and cannot bypass room permissions.
  Learn: resource limits and operational privacy.
- [ ] **17 — Verify the full experience.** Add a multi-session end-to-end test
  covering the main flow; check keyboard use, mobile layout, errors, and secret
  exposure in responses/logs. Fix issues discovered by these checks.
  Done when the core flow passes and known limitations are documented.
  Learn: integration testing and usability verification.
- [ ] **18 — Package local self-hosting.** Add a Docker Compose setup, persistent
  storage configuration, cleanup scheduling, and setup/operation instructions.
  Done when a fresh installation runs a full retro and survives a restart.
  Learn: containers, configuration, and deployment.

Demo: start a fresh installation and run a retrospective with several people.

## After the Local MVP

Plan public hosting as a separate milestone after the workflow is validated.
Verify current provider limits, spending controls, storage/realtime compatibility,
cleanup scheduling, logging, and retention before choosing a deployment design.
The $0 budget is a requirement. Validate that the chosen services enforce free
quotas, accepting temporary unavailability rather than paid overages.

Add PostgreSQL support when implementing the company self-hosted edition.
Keep integrations, accounts, AI summaries, permanent history, and action-item
tracking outside the initial scope unless the product requirements change.

## Board Experience Improvements

These small delivery chunks precede the remaining retention work. Preserve the
existing anonymous access rules and maximum of five columns.

- [x] **Compact board layout.** Replace large access panels with a wide workspace,
  compact phase toolbar, and expandable Invite team / Room details. Keep access
  failures and storage warnings visible. Use pastel column backgrounds, light
  cards, compact facilitator controls, and a single-column narrow-screen layout.
  Colours are currently decorative defaults, not saved room settings.
- [ ] **Column colours and templates.** Offer Classic (Went well / Could improve /
  Next steps), Start–Stop–Continue, Mad–Sad–Glad, and 4Ls (Liked / Learned / Lacked /
  Longed for), plus Start from scratch. Preview templates and allow column names,
  accessible palette colours, and column count to be changed before creation.
- [ ] **Optional mood check-in.** Add a pre-writing check-in with five labelled
  emoji choices, one changeable answer per participant, and anonymous aggregate
  results revealed when writing starts. Do not link moods to cards.
- [ ] **Collaborative grouping.** After reveal, participants and facilitators can
  group, name, move, and ungroup similar cards. Preserve original cards and votes;
  label group totals as the sum of card votes. Start with accessible explicit
  controls, then consider drag-and-drop. Freeze grouping at closure.
