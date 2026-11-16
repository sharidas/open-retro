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

## Remaining browser checkpoint

- [ ] Run creation through closure with facilitator and two isolated browser sessions.
- [ ] Verify vote budget, undo, peer totals, most-voted ordering, and reload (task 13).
- [ ] Verify timer pause/resume/extend and readiness changes across sessions.
- [ ] Navigate forms, dialogs, cards, and groups using only the keyboard.
- [ ] Verify focus visibility, understandable labels, and error announcements.
- [ ] Verify offline/reconnect and rejected requests preserve drafts without replay.
- [ ] Inspect application, server, and proxy logs for secret exposure.

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
