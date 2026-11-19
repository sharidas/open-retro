// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createServer as createNetServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, createServer } from 'vite'
import { privateProxyLogger } from '../vite.config'

it('redacts proxy failure URLs and exception metadata while preserving unrelated diagnostics', () => {
  const logger = createLogger(); logger.error = vi.fn()
  const wrapped = privateProxyLogger(logger)
  wrapped.error('http proxy error: /api/rooms/private-room?secret=private-token', { error: new Error('private detail') })
  wrapped.error('ws proxy socket error: private detail', { error: new Error('private detail') })
  expect(vi.mocked(logger.error).mock.calls).toEqual([
    ['API proxy connection failed. Check that the local API is running.', { timestamp: true }],
    ['API proxy connection failed. Check that the local API is running.', { timestamp: true }],
  ])
  wrapped.error('Build syntax error', { timestamp: true })
  expect(logger.error).toHaveBeenLastCalledWith('Build syntax error', { timestamp: true })
})

it('keeps synthetic secrets out of a real failed Vite proxy request log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retro-proxy-'))
  // Reserve and release an ephemeral loopback port as an unavailable API target.
  const probe = createNetServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const target = probe.address()
  if (!target || typeof target === 'string') throw new Error('Missing port')
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  const logger = createLogger(); logger.error = vi.fn()
  const server = await createServer({ configFile: false, root, customLogger: privateProxyLogger(logger),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${target.port}` } } })
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing proxy port')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/rooms/private-room?secret=private-query`, {
      method: 'POST', headers: { Authorization: 'Bearer private-header', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'private-card' }), signal: AbortSignal.timeout(5000),
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(logger.error).toHaveBeenCalled()
    const output = JSON.stringify(vi.mocked(logger.error).mock.calls)
    for (const secret of ['private-room', 'private-query', 'private-header', 'private-card']) expect(output).not.toContain(secret)
    expect(output).toContain('API proxy connection failed')
  } finally { await server.close(); await rm(root, { recursive: true, force: true }) }
})
