import { serve } from '@hono/node-server'
import { app } from './app.js'
import { openDatabase } from './storage/database.js'

// Fail startup if migrations fail; never serve against an unknown schema.
const database = await openDatabase(process.env.DATABASE_PATH ?? './data/open-retro.sqlite')

const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3000 }, () => {
  console.log('Open Retro API listening on port 3000')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      database.close()
      process.exit(error ? 1 : 0)
    })
  })
}
