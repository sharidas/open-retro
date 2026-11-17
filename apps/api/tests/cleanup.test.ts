import { afterEach, expect, it, vi } from 'vitest'
import { startCleanup, CLEANUP_INTERVAL_MS } from '../src/cleanup.js'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('runs at startup and retries failures without logging database details', async () => {
  vi.useFakeTimers()
  const clean = vi.fn().mockRejectedValueOnce(new Error('sensitive database detail')).mockResolvedValue(1), report = vi.fn()
  const stop = startCleanup(clean, report)
  await vi.advanceTimersByTimeAsync(0)
  expect(report).toHaveBeenCalledWith()
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS)
  expect(clean).toHaveBeenCalledTimes(2)
  await stop(); await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 2)
  expect(clean).toHaveBeenCalledTimes(2)
})
it('never overlaps runs and waits for active cleanup before shutdown', async () => {
  vi.useFakeTimers(); let resolve!: (value: number) => void
  const clean = vi.fn(() => new Promise<number>(done => { resolve = done }))
  const stop = startCleanup(clean)
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 3)
  expect(clean).toHaveBeenCalledOnce()
  let stopped = false; const ending = stop().then(() => { stopped = true })
  await Promise.resolve(); expect(stopped).toBe(false)
  resolve(0); await ending
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS)
  expect(clean).toHaveBeenCalledOnce()
})

it('reports only the fixed warning when the real cleanup reporter handles a private error', async () => {
  vi.useFakeTimers()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stop = startCleanup(async () => { throw new Error('private card text and database credentials') })
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(log.mock.calls).toEqual([['Room cleanup failed; will retry.']])
  } finally { await stop() }
})
