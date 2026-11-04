# MVP Plan

## Objective

Build the smallest useful version of Open Retro: a privacy-first room where a
facilitator can collect anonymous feedback, reveal it, let participants vote,
and then delete or let the room expire.

## First Development Slice

The first local development milestone should prove the core workflow end to
end:

1. Create a retrospective room.
2. Open a participant link.
3. Let the facilitator configure up to five columns and submit cards into them.
4. Keep submitted cards hidden during writing.
5. Reveal cards from the facilitator view.
6. Vote anonymously.
7. Delete the room.

## Suggested Local Stack

This is intentionally provisional. The implementation can change as the code
starts taking shape.

- Frontend: React with TypeScript.
- Backend: TypeScript API.
- Local database: SQLite.
- Realtime: polling or Server-Sent Events.
- Tests: unit tests for privacy-sensitive domain rules, plus end-to-end tests
  for the main room workflow.

## Non-Goals For MVP

- User accounts.
- Email or social login.
- Jira, Slack, or calendar integrations.
- AI-generated summaries.
- File uploads.
- Paid plans.
- Permanent team history.
- Product analytics.

## Acceptance Criteria

- Participants can use the app without accounts or personal identifiers.
- The facilitator can configure retrospective columns, with a maximum of five
  per room.
- Participants cannot see each other's cards during the writing phase.
- The facilitator can reveal all cards at once.
- Votes are anonymous and constrained to the intended room.
- A room can be deleted immediately.
- Expired rooms can be removed automatically.
- The interface is usable on mobile.
