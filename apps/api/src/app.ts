import { Hono, type Handler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { createFacilitatorSecret, hashSecret, verifyFacilitatorSecret } from './domain/facilitator.js'
import { RoomRuleError } from './domain/room.js'
import type { roomRepository } from './storage/rooms.js'
import type { StoredRoom } from './storage/rooms.js'

// Keep HTTP routes separate from the Node.js server for future hosting adapters.
type Rooms = ReturnType<typeof roomRepository>
type AppEnv = { Variables: { room: StoredRoom; ownerHash: string } }
const createRoomInput = z.strictObject({
  columns: z.array(z.string().trim().min(1)).min(1).max(5),
})
const createCardInput = z.strictObject({
  columnIndex: z.number().int().min(0).max(4),
  text: z.string().trim().min(1).max(2000),
})

export function createApp(rooms: Rooms, clock: () => number = Date.now) {
  const app = new Hono<AppEnv>()
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

  app.use('/api/rooms/:id/cards', async (c, next) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    const ownerHash = token ? hashSecret(token) : null
    if (!ownerHash || !await rooms.hasParticipant(c.req.param('id'), ownerHash)) {
      return c.json({ error: 'UNAUTHORIZED' }, 401)
    }
    const room = await rooms.find(c.req.param('id'))
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    c.set('room', room)
    c.set('ownerHash', ownerHash)
    await next()
  })
  app.get('/api/rooms/:id/cards', async (c) => {
    return c.json({ cards: await rooms.listOwnCards(c.get('room').id, c.get('ownerHash')) })
  })
  app.post('/api/rooms/:id/cards', bodyLimit({ maxSize: 16384,
    onError: (c) => c.json({ error: 'BODY_TOO_LARGE' }, 413),
  }), async (c) => {
    const room = c.get('room')
    if (room.state !== 'writing') return c.json({ error: 'WRITING_ENDED' }, 409)
    const contentType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return c.json({ error: 'JSON_REQUIRED' }, 415)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'INVALID_JSON' }, 400) }
    const parsed = createCardInput.safeParse(body)
    if (!parsed.success || parsed.data.columnIndex >= room.columns.length) {
      return c.json({ error: 'INVALID_CARD', message: 'Choose an existing column and provide 1–2000 characters of text.' }, 400)
    }
    const card = await rooms.submitCard(room.id, c.get('ownerHash'), parsed.data.columnIndex, parsed.data.text)
    if (!card) return c.json({ error: 'ROOM_CHANGED' }, 409)
    return c.json({ card }, 201)
  })

  app.post('/api/rooms/:id/join', async (c) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const room = await rooms.find(c.req.param('id'))
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    if (room.state === 'closed') return c.json({ error: 'ROOM_CLOSED' }, 409)
    await rooms.joinParticipant(room.id, hashSecret(token))
    return c.json({ room })
  })

  app.get('/api/rooms/:id', async (c) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (!token || !await rooms.hasParticipant(c.req.param('id'), hashSecret(token))) {
      return c.json({ error: 'UNAUTHORIZED' }, 401)
    }
    const room = await rooms.find(c.req.param('id'))
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    return c.json({ room })
  })

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
  const facilitatorRead: Handler<AppEnv> = async (c) => {
    const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (!secret) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const id = c.req.param('id') ?? ''
    const hash = await rooms.findFacilitatorHash(id)
    if (!verifyFacilitatorSecret(secret, hash)) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const room = await rooms.find(id)
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    // Until task 10 adds reveal, facilitator card reads fail closed: no text,
    // owner hashes, counts, or other participant correlation data.
    if (c.req.path.endsWith('/cards')) return c.json({ cards: [] })
    return c.json({ room })
  }
  app.get('/api/rooms/:id/facilitator', facilitatorRead)
  app.get('/api/rooms/:id/facilitator/cards', facilitatorRead)
  return app
}
