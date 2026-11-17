import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { createApp } from './app.js'

// Serve only public build assets and known client routes. API misses must stay
// 404s rather than receiving the application's HTML shell.
export async function productionApp(api: ReturnType<typeof createApp>, root: string) {
  await access(join(root, 'index.html'))
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'no-store')
    await next()
    if (c.req.path.startsWith('/assets/') && [200, 206].includes(c.res.status)) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
    }
  })
  app.route('/', api)
  app.get('/assets/*', serveStatic({ root }))
  const shell = serveStatic({ root, path: 'index.html' })
  app.get('/', shell)
  app.get('/rooms/:id', shell)
  app.get('/rooms/:id/facilitator', shell)
  app.onError((_error, c) => c.json({ error: 'INTERNAL_ERROR' }, 500))
  return app
}
