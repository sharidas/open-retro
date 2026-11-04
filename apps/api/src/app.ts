import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { createFacilitatorSecret, verifyFacilitatorSecret } from './domain/facilitator.js'
import { RoomRuleError } from './domain/room.js'
import type { roomRepository } from './storage/rooms.js'

// Keep HTTP routes separate from the Node.js server for future hosting adapters.
type Rooms = ReturnType<typeof roomRepository>
const createRoomInput = z.strictObject({
  columns: z.array(z.string().trim().min(1)).min(1).max(5),
})

export function createApp(rooms: Rooms, clock: () => number = Date.now) {
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })
  // Never include request bodies, authorization headers, or database errors in logs/responses.
  app.onError((error, c) => {
    if (error instanceof RoomRuleError) return c.json({ error: error.code }, 400)
    return c.json({ error: 'INTERNAL_ERROR' }, 500)
  })
  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  app.post('/api/rooms', bodyLimit({ maxSize: 8192,
    onError: (c) => c.json({ error: 'BODY_TOO_LARGE' }, 413),
  }), async (c) => {
    const contentType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return c.json({ error: 'JSON_REQUIRED' }, 415)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'INVALID_JSON' }, 400) }
    const parsed = createRoomInput.safeParse(body)
    if (!parsed.success) return c.json({ error: 'INVALID_ROOM', message: 'Provide one to five nonempty column names.' }, 400)
    const { secret, hash } = createFacilitatorSecret()
    const room = await rooms.create(parsed.data.columns, hash)
    // The one and only response containing the raw facilitator capability.
    return c.json({ room, facilitatorSecret: secret }, 201)
  })

  // A protected metadata read proves the authorization boundary without
  // implementing reveal, close, or delete ahead of their planned tasks.
  app.get('/api/rooms/:id/facilitator', async (c) => {
    const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (!secret) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const id = c.req.param('id')
    const hash = await rooms.findFacilitatorHash(id)
    if (!verifyFacilitatorSecret(secret, hash)) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const room = await rooms.find(id)
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    return c.json({ room })
  })
  return app
}
