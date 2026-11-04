import { Hono } from 'hono'

// Keep HTTP routes separate from the Node.js server for future hosting adapters.
export const app = new Hono()
app.get('/api/health', (c) => c.json({ status: 'ok' }))
