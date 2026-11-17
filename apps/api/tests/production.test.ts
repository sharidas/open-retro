import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { productionApp } from '../src/production.js'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/storage/database.js'
import { roomRepository } from '../src/storage/rooms.js'
let folder: string
let connection: Awaited<ReturnType<typeof openDatabase>>
let app: Awaited<ReturnType<typeof productionApp>>
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'retro-production-'))
  await mkdir(join(folder, 'public/assets'), { recursive: true })
  await writeFile(join(folder, 'public/index.html'), '<!doctype html><title>Retro shell</title>')
  await writeFile(join(folder, 'public/assets/app-123.js'), 'console.log("fixture")')
  await writeFile(join(folder, 'private.txt'), 'private fixture')
  connection = await openDatabase(join(folder, 'retro.sqlite'))
  app = await productionApp(createApp(roomRepository(connection.db)), join(folder, 'public'))
})
afterEach(async () => { connection?.close(); await rm(folder, { recursive: true, force: true }) })
it.each(['/', '/rooms/test-room', '/rooms/test-room/facilitator'])('serves uncached HTML for direct navigation to %s', async path => {
  const response = await app.request(path)
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toContain('text/html')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(await response.text()).toContain('Retro shell')
})
it('serves immutable build assets and keeps API responses separate', async () => {
  const asset = await app.request('/assets/app-123.js')
  expect(asset.status).toBe(200)
  expect(asset.headers.get('Cache-Control')).toContain('immutable')
  expect(await asset.text()).toContain('fixture')
  const health = await app.request('/api/health')
  expect(await health.json()).toEqual({ status: 'ok' })
  expect(health.headers.get('Cache-Control')).toBe('no-store')
})
it.each(['/api/missing', '/assets/missing.js', '/private.txt', '/retro.sqlite', '/assets/%2e%2e/%2e%2e/private.txt', '/unknown'])('does not expose files or serve HTML fallback at %s', async path => {
  const response = await app.request(path)
  expect(response.status).toBe(404)
  const body = await response.text()
  expect(body).not.toContain('Retro shell')
  expect(body).not.toContain('private fixture')
})
it('refuses startup if the frontend build is missing', async () => {
  await expect(productionApp(createApp(roomRepository(connection.db)), join(folder, 'missing'))).rejects.toThrow()
})
