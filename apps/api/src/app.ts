import { Hono, type Handler, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { createFacilitatorSecret, hashSecret, verifyFacilitatorSecret } from './domain/facilitator.js'
import { RoomRuleError, transitionRoom } from './domain/room.js'
import type { roomRepository } from './storage/rooms.js'
import type { StoredRoom } from './storage/rooms.js'
import { VOTE_LIMIT } from './domain/vote.js'

// Keep HTTP routes separate from the Node.js server for future hosting adapters.
type Rooms = ReturnType<typeof roomRepository>
type AppEnv = { Variables: { room: StoredRoom; ownerHash: string; facilitatorHash: string } }
const createRoomInput = z.strictObject({
  columns: z.array(z.string().trim().min(1)).min(1).max(5),
})
const createCardInput = z.strictObject({
  columnIndex: z.number().int().min(0).max(4),
  text: z.string().trim().min(1).max(2000),
})
const updateCardInput = z.strictObject({ text: z.string().trim().min(1).max(2000) })

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

  const authorizeCardAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
    const id = c.req.param('id') ?? ''
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    const ownerHash = token ? hashSecret(token) : null
    if (!ownerHash || !await rooms.hasParticipant(id, ownerHash)) {
      return c.json({ error: 'UNAUTHORIZED' }, 401)
    }
    const room = await rooms.find(id)
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    c.set('room', room)
    c.set('ownerHash', ownerHash)
    await next()
  }
  app.use('/api/rooms/:id/cards', authorizeCardAccess)
  app.use('/api/rooms/:id/cards/:cardId', authorizeCardAccess)
  app.use('/api/rooms/:id/revealed-cards', authorizeCardAccess)
  app.use('/api/rooms/:id/votes', authorizeCardAccess)
  app.use('/api/rooms/:id/cards/:cardId/vote', authorizeCardAccess)
  app.get('/api/rooms/:id/votes', async (c) => {
    const room = c.get('room')
    if (room.state === 'writing') return c.json({ error: 'VOTING_NOT_OPEN' }, 409)
    return c.json(await rooms.myVoting(room.id, c.get('ownerHash')))
  })
  const changeVote = (selected: boolean): Handler<AppEnv> => async (c) => {
    const room = c.get('room')
    if (room.state !== 'revealed') return c.json({ error: 'VOTING_NOT_OPEN' }, 409)
    const result = await rooms.changeVote(room.id, c.get('ownerHash'), c.req.param('cardId') ?? '', selected)
    if (result.kind === 'unavailable') return c.json({ error: 'CARD_NOT_FOUND' }, 404)
    if (result.kind === 'budget') return c.json({ error: 'VOTE_BUDGET_EXCEEDED', voteLimit: VOTE_LIMIT }, 409)
    return c.json({ vote: result.vote, remainingVotes: result.remainingVotes, voteLimit: result.voteLimit })
  }
  app.put('/api/rooms/:id/cards/:cardId/vote', changeVote(true))
  app.delete('/api/rooms/:id/cards/:cardId/vote', changeVote(false))
  app.get('/api/rooms/:id/revealed-cards', async (c) => {
    const room = c.get('room')
    if (room.state === 'writing') return c.json({ error: 'CARDS_NOT_REVEALED' }, 409)
    return c.json({ cards: await rooms.listRevealedCards(room.id) })
  })

  app.patch('/api/rooms/:id/cards/:cardId', bodyLimit({ maxSize: 16384,
    onError: (c) => c.json({ error: 'BODY_TOO_LARGE' }, 413),
  }), async (c) => {
    const room = c.get('room')
    if (room.state !== 'writing') return c.json({ error: 'WRITING_ENDED' }, 409)
    if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return c.json({ error: 'JSON_REQUIRED' }, 415)
    }
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'INVALID_JSON' }, 400) }
    const parsed = updateCardInput.safeParse(body)
    if (!parsed.success) return c.json({ error: 'INVALID_CARD', message: 'Provide only text with 1–2000 characters.' }, 400)
    const card = await rooms.updateOwnCard(room.id, c.get('ownerHash'), c.req.param('cardId'), parsed.data.text)
    if (!card) return c.json({ error: 'CARD_NOT_FOUND' }, 404)
    return c.json({ card })
  })
  app.delete('/api/rooms/:id/cards/:cardId', async (c) => {
    const room = c.get('room')
    if (room.state !== 'writing') return c.json({ error: 'WRITING_ENDED' }, 409)
    const removed = await rooms.deleteOwnCard(room.id, c.get('ownerHash'), c.req.param('cardId'))
    if (!removed) return c.json({ error: 'CARD_NOT_FOUND' }, 404)
    return c.body(null, 204)
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

  const authorizeFacilitator: MiddlewareHandler<AppEnv> = async (c, next) => {
    const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1]
    if (!secret) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const id = c.req.param('id') ?? ''
    const hash = await rooms.findFacilitatorHash(id)
    if (!hash || !verifyFacilitatorSecret(secret, hash)) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const room = await rooms.find(id)
    if (!room || room.expiresAt <= clock()) return c.json({ error: 'ROOM_NOT_FOUND' }, 404)
    c.set('room', room)
    c.set('facilitatorHash', hash)
    await next()
  }
  app.use('/api/rooms/:id/facilitator', authorizeFacilitator)
  app.use('/api/rooms/:id/facilitator/cards', authorizeFacilitator)
  app.use('/api/rooms/:id/facilitator/votes', authorizeFacilitator)
  app.use('/api/rooms/:id/reveal', authorizeFacilitator)
  app.get('/api/rooms/:id/facilitator', (c) => c.json({ room: c.get('room') }))
  app.get('/api/rooms/:id/facilitator/votes', async (c) => {
    const room = c.get('room')
    if (room.state === 'writing') return c.json({ error: 'VOTING_NOT_OPEN' }, 409)
    return c.json({ votes: await rooms.voteTotals(room.id) })
  })
  app.get('/api/rooms/:id/facilitator/cards', async (c) => {
    return c.json({ cards: await rooms.listRevealedCards(c.get('room').id) })
  })
  app.post('/api/rooms/:id/reveal', async (c) => {
    const room = c.get('room')
    if (room.state !== 'writing') return c.json({ error: 'INVALID_TRANSITION' }, 409)
    transitionRoom(room, 'revealed')
    const revealed = await rooms.revealRoom(room.id, c.get('facilitatorHash'))
    if (!revealed) return c.json({ error: 'ROOM_CHANGED' }, 409)
    return c.json({ room: revealed })
  })
  return app
}
