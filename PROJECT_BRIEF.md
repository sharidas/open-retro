# Open Retro – Project Brief

## Problem

Most online sprint-retrospective tools advertise a free plan but restrict
important features such as anonymous feedback, private writing,
facilitator-controlled reveal, anonymous voting, team size, or number of
retrospectives.

The goal is to create a genuinely free and open-source retrospective tool.

## Product goal

Build a privacy-focused retrospective application that supports:

1. A free public hosted version.
2. A self-hosted version for companies that do not permit external tools.

## Core workflow

1. A facilitator creates a retrospective room.
   The facilitator can configure up to five retrospective columns.
2. The facilitator receives a private facilitator link or secret.
3. Participants join through a separate participant link.
4. Participants do not provide names, email addresses, or accounts.
5. During the writing phase:
   - participants can submit thoughts;
   - thoughts from other participants remain hidden;
   - each participant may edit or delete their own thoughts.
6. The facilitator ends the writing phase.
7. The facilitator reveals all submitted thoughts.
8. Thoughts become visible, but participant identities remain hidden.
9. Participants vote anonymously.
10. The team discusses the most-voted topics.
11. The facilitator may close or permanently delete the retrospective.

## Minimum viable product

The first release must include only:

- Create a room
- Join a room through a link
- Facilitator-configurable retrospective columns, with a maximum of five per room
- Anonymous card submission
- Private writing phase
- Facilitator-controlled reveal
- Anonymous voting
- Room deletion
- Automatic room expiration
- Basic rate limiting
- Mobile-friendly interface

Do not initially implement:

- User accounts
- Social login
- Jira integration
- Slack integration
- AI summaries
- File uploads
- Paid plans
- Permanent team history
- Complex analytics

## Privacy requirements

- Do not request or store participant names.
- Do not request or store participant email addresses.
- Do not expose participant session identifiers to the facilitator.
- Store only a hash of any participant token required for editing cards or
  preventing duplicate votes.
- Use cryptographically unguessable room identifiers.
- Keep the facilitator secret separate from the participant room URL.
- Provide immediate room deletion.
- Automatically delete expired rooms.
- Do not enable analytics or tracking by default.
- Do not store IP addresses in application data.
- Display a warning not to enter passwords, secrets, personal data, or
  confidential company information.

## Deployment modes

### Public hosted edition

Suggested infrastructure:

- Frontend: React with TypeScript
- API: Cloudflare Workers
- Coordination/realtime: Durable Objects or Server-Sent Events
- Database: Cloudflare D1
- Hosting: Cloudflare Pages or Workers static assets

The public edition should remain usable within genuinely free infrastructure
limits and should fail safely rather than create unexpected costs.

### Self-hosted edition

Suggested infrastructure:

- Same frontend
- Portable backend
- PostgreSQL database
- Docker Compose deployment
- Optional Kubernetes deployment later

A company should eventually be able to start the application using:

```bash
docker compose up -d
```

