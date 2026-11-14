import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
const disposers: (() => unknown)[] = []
afterEach(async () => { for (const dispose of disposers.reverse()) await dispose(); disposers.length = 0 })
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'retro-capacity-')); disposers.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'db.sqlite'), connection = await openDatabase(path); disposers.push(connection.close)
  const repo = roomRepository(connection.db), app = createApp(repo)
  const token = randomBytes(32).toString('base64url'), room = await repo.create(['A'])
  await repo.joinParticipant(room.id, hashSecret(token))
  const request = (suffix: string, credential = token, method = 'POST') => app.request(`/api/rooms/${room.id}${suffix}`, {
    method, headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' && suffix === '/cards' ? { body: JSON.stringify({ columnIndex: 0, text: 'New card' }) } : {}),
  })
  return { ...connection, path, repo, app, room, token, request }
}
it('enforces participant capacity but allows existing sessions to rejoin', async () => {
  const f = await fixture()
  for (let i = 0; i < 99; i++) await f.repo.joinParticipant(f.room.id, hashSecret(`participant-${i}`))
  const response = await f.request('/join', randomBytes(32).toString('base64url'))
  expect(response.status).toBe(422); expect((await response.json()).error).toBe('RETRO_PARTICIPANT_LIMIT')
  expect((await f.request('/join')).status).toBe(200)
  expect((await f.request('/cards', 'x'.repeat(43))).status).toBe(401)
})
it('enforces the owner card cap across connections, allowing removal and replacement', async () => {
  const f = await fixture(), owner = hashSecret(f.token)
  for (let i = 0; i < 49; i++) await f.repo.submitCard(f.room.id, owner, 0, 'Card')
  const second = await openDatabase(f.path); disposers.push(second.close)
  const outcomes = await Promise.allSettled([f.repo.submitCard(f.room.id, owner, 0, 'Last'), roomRepository(second.db).submitCard(f.room.id, owner, 0, 'Racing')])
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  const response = await f.request('/cards')
  expect(response.status).toBe(422); expect((await response.json()).error).toBe('RETRO_CARD_LIMIT')
  const cards = await f.repo.listOwnCards(f.room.id, owner); expect(cards).toHaveLength(50)
  expect(await f.repo.updateOwnCard(f.room.id, owner, cards[0].id, 'Edited')).toBeDefined()
  await f.repo.deleteOwnCard(f.room.id, owner, cards[0].id)
  expect((await f.request('/cards')).status).toBe(201)
})
it('enforces the room card cap independently of owner capacity', async () => {
  const f = await fixture()
  for (let i = 0; i < 10; i++) {
    const owner = hashSecret(`owner-${i}`); await f.repo.joinParticipant(f.room.id, owner)
    for (let j = 0; j < 50; j++) await f.repo.submitCard(f.room.id, owner, 0, 'Card')
  }
  const response = await f.request('/cards')
  expect(response.status).toBe(422); expect((await response.json()).error).toBe('RETRO_CARD_LIMIT')
  expect((await f.request('/cards', f.token, 'GET')).status).toBe(200)
})
it('bounds stored rooms and permits creation after a room is removed', async () => {
  const f = await fixture()
  await f.db.$client.execute(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<999)
    INSERT INTO rooms (id, columns, state, created_at, expires_at) SELECT 'seed-'||x, '["A"]', 'writing', 1, 2 FROM n`)
  const create = () => f.app.request('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns: ['A'] }) })
  const response = await create(); expect(response.status).toBe(422)
  expect((await response.json()).error).toBe('RETRO_ROOM_LIMIT')
  await f.repo.cleanupExpired()
  expect((await create()).status).toBe(201)
})
