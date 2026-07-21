# Open Retro

Open Retro is a planned free and open-source retrospective tool for teams that
need anonymous feedback without accounts, tracking, or hidden paywalls.

The project is currently in the planning and early development stage.

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
- configure three retrospective columns;
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

This repository is being prepared for initial development. See:

- [Project brief](PROJECT_BRIEF.md)
- [MVP plan](docs/mvp.md)
- [Architecture notes](docs/architecture.md)

## License

MIT. See [LICENSE](LICENSE).
