# Release verification

Task 17 is split into small checkpoints. Passing API integration tests does not
certify every OS, browser, or physical device.

## Completed automated workflow

- [x] Facilitator and two independent participant credentials.
- [x] Optional mood check-in and aggregate disclosure after writing starts.
- [x] Private card reads, ownership enforcement, and anonymous revealed cards.
- [x] Timer/readiness survive reopening the SQLite file; rejoin is idempotent.
- [x] Readiness counts are absent from participant responses.
- [x] Reveal permissions, voting totals, duplicate votes, and undo.
- [x] Collaborative grouping, facilitator rename, and stale revision rejection.
- [x] Closure freezes mutations while preserving final reads.
- [x] Facilitator deletion cascades all related records and invalidates access.
- [x] Responses after creation exclude raw credentials and stored hashes.

Run `docker compose exec -T dev npm test -w @open-retro/api -- tests/workflow.test.ts`.
The fixture uses temporary files and leaves the development database untouched.

## Keyboard confirmation checkpoint — 2026-11-16

- [x] Reproduced focus loss when Start writing replaced its focused trigger.
- [x] Focus inline warning text when opening confirmations, with a visible outline.
- [x] Restore focus on cancellation for check-in, reveal, closure, room deletion,
      and card deletion. Restore Edit card focus after cancelling an edit.
- [x] Preserve the user's focus during ordinary rerenders; do not auto-focus a
      destructive button. Automated checks run under React StrictMode.
- [x] Browser checks used Enter/Tab to open and cancel Start writing and Delete
      room, confirming focus restoration and visible focus outlines. No room
      deletion or lifecycle transition was performed in those checks.

All 99 frontend tests, TypeScript/portability checks, and production build passed.
Other confirmation paths have component coverage; screen-reader announcements,
full keyboard traversal, and physical-device behavior remain to be verified.

## Multi-session voting checkpoint — 2026-11-16

Verified in the in-app browser against the local Docker application. Participant
A used localhost and participant B used 127.0.0.1 to isolate browser storage.
A separate facilitator tab created the room and revealed the test cards.

| Check | Observed result |
| --- | --- |
| Private writing | Each participant saw only their own two cards before reveal. |
| Timer | Started at 5 minutes, paused at 4:56, extended to 9:56, and resumed. |
| Timer persistence | Participant B reloaded and saw the same paused 9:56 timer. |
| Readiness privacy | A marked ready; facilitator saw 1 of 2. Undo returned it to 0 of 2. Participant pages showed only their own choice. |
| Reveal | Both participant pages adopted the shared four-card board. |
| Vote limit | A used three votes; budget became 0 of 3 and the fourth unselected card was disabled. |
| Independent votes | B retained 3 of 3 votes and no selected cards despite A's votes. |
| Shared totals | B voted for Reduce interruptions; its total became 2 in both sessions. |
| Undo | A removed the Helpful reviews vote; its total became 0 and A regained one vote. |
| Ordering | Most voted ranked Reduce interruptions (2), Clear sprint goals (1), then the two zero-vote cards. |
| Persistence | After browser tabs were lost and the Docker service restarted, reopening A showed 1 of 3 remaining with two selected cards. B showed 2 of 3 with only Reduce interruptions selected. |

No application defect was found in these checks. No room closure or deletion was
performed during this checkpoint. Task 14 records the prior browser closure and
read-only checks; creation-through-closure in a single multi-session browser run
remains below. OS/device coverage is unchanged.

### Repeating the voting check

1. Create a room without mood check-in. Open its facilitator link separately.
2. Join the participant link on localhost and 127.0.0.1 as independent sessions.
3. Save two uniquely named cards from each participant and verify private reads.
4. Start/pause/extend/resume the timer; mark ready and undo, checking facilitator
   counts and participant privacy. Reload a participant while paused.
5. Reveal the cards. Cast three votes from A and confirm a fourth is disabled.
6. Vote on one of the same cards from B; verify the total reaches two while each
   participant's selections/budget remain independent.
7. Undo another A vote. Verify budget recovery and the lower shared total.
8. Select Most voted and verify descending totals across columns. Reopen both
   participant links and verify saved selections, budgets, and totals.

## Connection recovery automated checkpoint — 2026-11-17

- [x] Interrupted card creation, HTTP 5xx, invalid success responses, and timeout
      preserve the draft and block further creates until a successful card refresh.
- [x] Failed refreshes keep saving paused; editing a draft does not bypass the guard.
- [x] Successful refresh shows the saved card without replaying the POST or clearing
      unsent text. Participants compare their draft with saved cards before retrying.
- [x] Unsaved edits survive a failed PATCH and availability changes without replay.
- [x] A room revealed during an outage keeps unsent text visible and saving disabled.
- [x] Existing room-poll and voting tests verify recovery/backoff, reconciliation of
      lost vote responses, and no automatic replay of vote mutations.

These are simulated fetch failures in component/hook tests, not browser outage
checks. Drafts remain page-memory only: reload or navigation still discards them.
The refresh guard reduces accidental duplicates; it is not server-side idempotency
and cannot prevent a deliberate resubmission after refresh or a late server commit.
All 105 frontend tests, TypeScript/filename portability checks, and build passed.
The browser server-timeout check below supplements these simulated failures.

## Browser connection recovery checkpoint — 2026-11-17

Verified in the in-app browser against the local Docker application, using a new
room with synthetic text and mood check-in disabled. Paused/unpaused the dev
container to simulate an unresponsive server without restarting the page or
removing database data. The container was restored to running afterward.

| Check | Observed result |
| --- | --- |
| Create timeout | Saving timed out after the server was paused. Draft text remained editable; new card saves were disabled. |
| Room outage | Room and writing-status warnings appeared, and save controls were paused. |
| Reconnect | Check room status restored availability without a page reload. |
| Reconciliation | Refresh my cards showed exactly one card from the original timed-out request; the draft remained intact. No second save was submitted. |
| Edit timeout | A changed card retained its full editor text after timeout; Save changes was disabled during the outage. |
| Edit reconnect | Checking room status restored availability while preserving the editor text. |
| Saved edit | Cancel edit followed by Refresh my cards showed the revision committed by the original PATCH. No second PATCH was submitted through the UI. |

No new application defect was found. A timed-out request can still commit on the
server: compare saved cards before retrying, as the UI advises. This check observes
the UI and resulting cards; automated tests separately assert request counts.

This covers server unresponsiveness and manual recovery. It does not certify
physical mobile network switching, browser offline mode, or all OS/browser
combinations. HTTP rejection paths and failed refreshes have automated coverage.

### Repeating the recovery check

1. Create a test room, join as a participant, and type a draft without saving.
2. Run `docker compose pause dev`, then immediately save the draft.
3. After the 15-second timeout, verify the draft remains and saving is paused.
4. Always run `docker compose unpause dev` to restore the server, even if a check
   fails. Check room status, then Refresh my cards without resubmitting the draft.
5. Compare the saved cards with the retained draft; the original request may have
   committed despite its timeout.
6. Edit a saved card and repeat the pause/save/timeout/unpause sequence. Verify
   editor text survives. Check room status, then cancel and refresh to inspect the
   saved result. Copy any text you need before cancelling an edit.

## Application log privacy checkpoint — 2026-11-17

- [x] Full two-participant API workflow asserts no calls to console log/info/warn/
      error/debug, covering successful requests and rejected operations.
- [x] Injected database failure returns only INTERNAL_ERROR and emits no console
      output. The exception detail is neither returned nor logged.
- [x] The default cleanup reporter emits only its fixed retry warning, even when
      the thrown error contains private data.
- [x] Reviewed application logging sites and the recent local Docker log sample
      (up to 200 lines), including API and Vite development output. Observed
      startup, source-update, and process-exit messages; no card text or
      credentials were observed in that sample.

All 233 API tests and TypeScript/portable-filename checks passed. These assertions
cover application console output, not every dependency, direct stdout/stderr
write, browser console, or future infrastructure logger. The sampled logs did not
exercise a development proxy failure. Production reverse-proxy logging must be
reviewed when task 18 introduces that deployment configuration. Do not log request
bodies, Authorization headers, or private links; operators control log retention.

## Remaining browser checkpoint

- [ ] Run creation through closure with facilitator and two isolated browser sessions.
- [x] Verify vote budget, undo, peer totals, most-voted ordering, and reload (task 13).
- [x] Verify timer pause/resume/extend and readiness changes across sessions.
- [ ] Navigate forms, dialogs, cards, and groups using only the keyboard.
- [ ] Verify focus visibility, understandable labels, and error announcements.
- [x] Verify server timeout/reconnect preserves drafts without replay (browser);
      rejected requests and mutation counts covered by automated tests.
- [ ] Verify browser offline mode and physical mobile network switching.
- [x] Check application console privacy and inspect recent local server/dev logs.
- [ ] Inspect browser console, proxy failure logs, and production proxy logging.

## OS and mobile checkpoint

- [ ] Run documented setup/check commands on macOS, including Apple Silicon.
- [ ] Run documented setup/check commands on Windows with Linux containers.
- [ ] Check desktop Chrome/Edge, Firefox, and Safari with the core workflow.
- [ ] Check physical iOS/Safari and Android/Chrome, including on-screen keyboard,
      scrolling, touch interactions, copying links, and background/resume behavior.

Linux Docker checks and browser viewport checks at 320px/375px have passed.
Viewport checks verified private card entry and no horizontal overflow; they do
not replace full mobile workflow or physical-device verification. The default
Compose service is localhost-only and cannot be reached directly from a phone.
