import { startCleanup } from './cleanup.js'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { openDatabase } from './storage/database.js'
import { roomRepository } from './storage/rooms.js'

// Fail startup if migrations fail; never serve against an unknown schema.
const database = await openDatabase(process.env.DATABASE_PATH ?? './data/open-retro.sqlite')
const repository = roomRepository(database.db)
const stopCleanup = startCleanup(() => repository.cleanupExpired())
const app = createApp(repository)

const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3000 }, () => {
  console.log('Open Retro API listening on port 3000')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async (error) => {
      await stopCleanup()
      database.close()
      process.exit(error ? 1 : 0)
    })
  })
}
