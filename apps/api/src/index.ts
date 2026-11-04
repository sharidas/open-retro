import { serve } from '@hono/node-server'
import { app } from './app.js'

const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3000 }, () => {
  console.log('Open Retro API listening on port 3000')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => process.exit(error ? 1 : 0))
  })
}
