# Local Room API

The API is available through Vite at `http://localhost:5173/api`. The UI still
shows the foundation page; the room creation form is task 05.

## Create a Room

```bash
curl -i http://localhost:5173/api/rooms \
  -H 'Content-Type: application/json' \
  -d '{"columns":["Went well","Could improve","Ideas"]}'
```

`POST /api/rooms` accepts only a JSON object containing `columns`: one to five
nonempty strings. Names are trimmed and order is preserved. Unknown fields are
rejected, including attempts to choose a room ID, phase, or facilitator secret.
The request body is limited to 8 KiB. Duplicate column names remain allowed.

Success returns HTTP 201:

```json
{
  "room": {
    "id": "generated-room-uuid",
    "columns": ["Went well", "Could improve", "Ideas"],
    "state": "writing",
    "createdAt": 1800000000000,
    "expiresAt": 1800086400000
  },
  "facilitatorSecret": "generated-private-secret"
}
```

The raw secret appears only in this creation response. Save it privately: there
is no recovery endpoint. It is independently generated from 32 cryptographically
random bytes and is separate from the random UUID used to identify the room.
Only its SHA-256 hash is stored in SQLite. A fast hash is appropriate here because
the input is a high-entropy generated capability, not a human-selected password.

## Verify Facilitator Access

`GET /api/rooms/:id/facilitator` accepts `Authorization: Bearer <secret>` and
returns `{ "room": { ... } }` for a valid, unexpired room. The response never
includes the secret or its hash. Hash verification uses a constant-time comparison.

Missing, malformed, incorrect, cross-room, and unknown-room credentials return
HTTP 401 with `{"error":"UNAUTHORIZED"}`. A room ID alone grants no facilitator
access. Secrets in query parameters are not accepted. A valid credential for an
expired room returns HTTP 404. Rooms created before migration 0002 have no
facilitator capability and cannot pass this check; create a new room instead.

This protected metadata read establishes the access boundary. Reveal, close,
and delete operations are deliberately left for their planned tasks. Participant
joining and shareable UI links are also later work.

## Errors and Privacy

- 400: malformed JSON or invalid room input. Error responses do not echo input.
- 413: request body exceeds 8 KiB.
- 415: request does not use `application/json`.
- 500: generic internal failure, with database details suppressed.

API responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Application handlers do not log request bodies, authorization headers, raw
secrets, or database error details. Future hosting/proxy logging must follow the
same policy; transport HTTPS must be configured for a public deployment.

Rate limiting and broader abuse protection remain task 16. This API is currently
for local development, not a public deployment.
