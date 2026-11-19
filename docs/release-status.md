# Local MVP release candidate — 2026-11-19

The local Docker MVP is implemented and its available Linux/browser checks pass.
This is a release candidate for local evaluation, not a claim of universal device
support or a public-hosting release. Nothing has been published automatically.

## Included

Anonymous rooms with up to five configured columns, four templates and colours,
optional mood check-in, private writing, shared timer and facilitator-only ready
counts, reveal, voting, collaborative grouping, closure, expiry and deletion.
The production container serves the built frontend/API, persists SQLite, runs as
non-root, and binds to localhost:18080 by default.

## Verified

- 361 automated tests (244 API, 117 frontend), TypeScript and filename portability.
- Production build/image, fresh-volume workflow and persistence across restart.
- Two-participant browser workflow and core keyboard traversal through closure.
- Production mobile-width creation, writing, reveal, vote, grouping and closure.
- Failed-request draft retention and no automatic replay of uncertain writes.
- Application logging, production browser console and development proxy failure
  privacy checks. Proxy failures now omit URL and exception details.

Detailed evidence and boundaries: [release-verification.md](release-verification.md).
Run instructions: [self-hosting.md](self-hosting.md).

## Still required before broad compatibility claims

| Check | How to complete |
| --- | --- |
| macOS/Apple Silicon and Windows | On each host with Linux containers, use the documented Docker setup; run check/test/build and create/reload a room. Record OS, architecture, Docker version and result. |
| Desktop browsers | Repeat create, join, write, reveal, group, vote and close in Chrome/Edge, Firefox and Safari. Check copying links and reload persistence. |
| Physical phones | On an approved HTTPS test deployment, run the core flow on iOS/Safari and Android/Chrome. Check on-screen keyboard, scrolling, touch targets and copying links. The default localhost-only package is not phone-accessible. |
| Offline/network switching | Leave a draft open, disconnect, try saving, reconnect and inspect saved cards before retrying. Verify draft retention and no automatic replay; do not reload with unsaved text. |
| Screen reader | With NVDA or VoiceOver, verify labels, blank-input errors, save status, phase changes, grouping and vote announcements without mouse input. Record browser/reader versions. |

The current tool environment cannot perform those physical/native checks. Keep
results pending until someone actually runs them. Any reproducible failure should
be fixed and retested before claiming support for that environment.

## Known limits

- One development dependency advisory affects picomatch and its parent tools.
  No compatible published fix was available at the last investigation. See
  [dependency-security.md](dependency-security.md); do not hide the audit finding.
- Drafts live in page memory and are lost on reload/navigation. Browser sessions
  cannot guarantee one participant per human. Facilitator-link recovery is absent.
- Public HTTPS hosting, backup restoration automation and PostgreSQL are outside
  this local MVP. Public deployment must retain the project's $0 budget constraint.

After review, commit and push the release-readiness branch, merge it, rebuild the
production image and run the remaining platform checks. Tagging or publishing a
release is a separate action; no tag or release was created by this verification.
