import { afterEach, expect, it, vi } from 'vitest'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { hashSecret } from '../src/domain/facilitator.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'

afterEach(() => vi.restoreAllMocks())

it('runs a two-participant retro from creation through restart, closure, and deletion', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'retro-workflow-'))
  const path = join(folder, 'retro.sqlite')
  let connection = await openDatabase(path)
  let app = createApp(roomRepository(connection.db))
  const alice = randomBytes(32).toString('base64url'), bob = randomBytes(32).toString('base64url')
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method =>
    vi.spyOn(console, method).mockImplementation(() => {}))
  try {
    const created = await app.request('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: ['Went well', 'Improve', 'Next'], columnColors: ['sage', 'peach', 'blue'], moodCheckIn: true }) })
    expect(created.status).toBe(201)
    const { room, facilitatorSecret: facilitator } = await created.json()
    const sensitive = [alice, bob, facilitator, hashSecret(alice), hashSecret(bob), hashSecret(facilitator)]
    // Every subsequent response is checked, including error payloads. Creation
    // is the sole intentional disclosure of the facilitator's raw capability.
    async function request(token: string, suffix: string, method = 'GET', body?: unknown, status = 200) {
      const response = await app.request(`/api/rooms/${room.id}${suffix}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      expect(response.status, `${method} ${suffix}`).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const text = await response.text()
      for (const secret of sensitive) expect(text).not.toContain(secret)
      return text ? JSON.parse(text) : null
    }
    await request(alice, '/join', 'POST'); await request(bob, '/join', 'POST')
    await request(alice, '/mood', 'PUT', { mood: 'good' })
    await request(bob, '/mood', 'PUT', { mood: 'steady' })
    expect((await request(alice, '/mood')).totals).toBeNull()
    expect((await request(facilitator, '/facilitator/mood')).totals).toBeNull()
    await request(alice, '/cards', 'POST', { columnIndex: 0, text: 'Too early' }, 409)
    await request(facilitator, '/start-writing', 'POST')
    expect((await request(bob, '/mood')).totals.filter((value: { total: number }) => value.total > 0)).toEqual([
      { mood: 'steady', total: 1 }, { mood: 'good', total: 1 },
    ])
    await request(facilitator, '/facilitator/timer', 'PUT', { version: 0, action: 'start', seconds: 300 })
    const { card: first } = await request(alice, '/cards', 'POST', { columnIndex: 0, text: 'Clear sprint goals' }, 201)
    const { card: second } = await request(bob, '/cards', 'POST', { columnIndex: 1, text: 'Reduce interruptions' }, 201)
    expect((await request(alice, '/cards')).cards).toEqual([first])
    expect((await request(bob, '/cards')).cards).toEqual([second])
    expect((await request(facilitator, '/facilitator/cards')).cards).toEqual([])
    await request(bob, `/cards/${first.id}`, 'PATCH', { text: 'Not mine' }, 404)
    await request(alice, '/ready', 'PUT', { ready: true })
    const own = await request(bob, '/writing-progress')
    expect(Object.keys(own).sort()).toEqual(['ownReady', 'serverNow', 'timer'])
    expect(own.ownReady).toBe(false)
    const progress = await request(facilitator, '/facilitator/writing-progress')
    expect(progress).toMatchObject({ readyCount: 1, joinedCount: 2, timer: { status: 'running', version: 1 } })

    // Reopen the actual SQLite file and rebuild the app; sessions and state must
    // survive without re-creating participants, cards, or timer state.
    connection.close(); connection = await openDatabase(path)
    app = createApp(roomRepository(connection.db))
    expect((await request(alice, '/writing-progress')).ownReady).toBe(true)
    expect((await request(bob, '/writing-progress')).timer.endsAt).toBe(progress.timer.endsAt)
    await request(alice, '/join', 'POST')
    expect((await request(facilitator, '/facilitator/writing-progress')).joinedCount).toBe(2)
    await request(alice, '/reveal', 'POST', undefined, 401)
    await request(facilitator, '/reveal', 'POST')
    for (const token of [alice, bob]) {
      const shared = (await request(token, '/revealed-cards')).cards
      expect(shared).toHaveLength(2)
      for (const card of shared) expect(Object.keys(card).sort()).toEqual(['columnIndex', 'id', 'text'])
      expect(shared).toEqual(expect.arrayContaining([first, second]))
      await request(token, '/cards', 'POST', { columnIndex: 0, text: 'Late' }, 409)
    }
    await request(alice, `/cards/${second.id}/vote`, 'PUT')
    await request(bob, `/cards/${second.id}/vote`, 'PUT')
    await request(bob, `/cards/${second.id}/vote`, 'PUT') // idempotent retry
    expect((await request(facilitator, '/facilitator/votes')).votes).toContainEqual({ cardId: second.id, total: 2 })
    await request(bob, `/cards/${second.id}/vote`, 'DELETE')
    expect((await request(alice, '/votes')).remainingVotes).toBe(2)
    expect((await request(bob, '/votes')).remainingVotes).toBe(3)
    const group = { id: randomUUID(), name: 'Focus', cardIds: [first.id, second.id] }
    await request(alice, '/groups', 'PUT', { version: 0, groups: [group] })
    expect((await request(bob, '/groups')).groups).toEqual([group])
    const renamed = { ...group, name: 'Protect focus time' }
    await request(facilitator, '/facilitator/groups', 'PUT', { version: 1, groups: [renamed] })
    await request(bob, '/groups', 'PUT', { version: 1, groups: [] }, 409)
    expect((await request(alice, '/groups')).groups).toEqual([renamed])
    await request(facilitator, '/close', 'POST')
    await request(alice, `/cards/${second.id}/vote`, 'DELETE', undefined, 409)
    await request(bob, '/groups', 'PUT', { version: 2, groups: [] }, 409)
    expect((await request(bob, '/revealed-cards')).cards).toHaveLength(2)
    expect((await request(facilitator, '/facilitator/votes')).votes).toContainEqual({ cardId: second.id, total: 1 })
    await request(alice, '/facilitator', 'DELETE', undefined, 401)
    await request(facilitator, '/facilitator', 'DELETE', undefined, 204)
    await request(bob, '/join', 'POST', undefined, 404)
    await request(facilitator, '/facilitator', 'GET', undefined, 401)
    for (const table of ['rooms', 'participants', 'cards', 'votes', 'moods', 'room_grouping', 'writing_timers']) {
      expect((await connection.db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n).toBe(0)
    }
    // No request logging: even anonymous text and hashed credentials are private.
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  } finally {
    connection.close()
    await rm(folder, { recursive: true, force: true })
  }
})
