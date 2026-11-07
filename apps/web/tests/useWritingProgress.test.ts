import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWritingProgress } from '../src/useWritingProgress'
import type { RoomSession } from '../src/session'
let root: Root, latest: ReturnType<typeof useWritingProgress>, fetchMock: ReturnType<typeof vi.fn>
let session: RoomSession
const refresh = vi.fn()
const initial = () => ({ serverNow: 100000, timer: { version: 0, status: 'idle', endsAt: null, remainingMs: 0 }, ownReady: false })
let snapshot: Record<string, unknown>
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function Probe() { latest = useWritingProgress(session, true, refresh); return null }
async function mount() { await act(async () => root.render(createElement(Probe))) }
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  snapshot = initial(); refresh.mockClear()
  session = { id: 'room', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
  fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'PUT') { const body = JSON.parse(options.body as string); if ('ready' in body) snapshot.ownReady = body.ready; return json({ saved: true }) }
    return json(snapshot)
  }); vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('saves and undoes only own readiness', async () => {
  await mount(); await act(async () => { await latest.save({ ready: true }) })
  expect(latest.snapshot?.ownReady).toBe(true)
  expect(fetchMock.mock.calls[1][0]).toBe('/api/rooms/room/ready')
  await act(async () => { await latest.save({ ready: false }); await latest.save({ action: 'start', seconds: 60 }) })
  expect(latest.snapshot?.ownReady).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(2)
})
it('sends the displayed timer version through facilitator endpoints', async () => {
  session.role = 'facilitator'; snapshot = { serverNow: 100000, timer: initial().timer, joinedCount: 2, readyCount: 1 }
  await mount(); await act(async () => { await latest.save({ action: 'start', seconds: 60 }) })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/rooms/room/facilitator/writing-progress')
  expect(fetchMock.mock.calls[1][0]).toBe('/api/rooms/room/facilitator/timer')
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'start', seconds: 60, version: 0 })
})
it('reconciles conflicts without replaying the mutation', async () => {
  await mount(); snapshot.ownReady = true; fetchMock.mockResolvedValueOnce(json({}, 409))
  await act(async () => { await latest.save({ ready: true }) })
  expect(latest.snapshot?.ownReady).toBe(true); expect(refresh).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('keeps controls disabled until uncertain writes can be reconciled', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async () => { snapshot.ownReady = true; throw new Error('lost response') }).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await latest.save({ ready: true }) })
  expect(latest.disabled).toBe(true)
  await act(async () => latest.refresh())
  expect(latest.snapshot?.ownReady).toBe(true); expect(latest.disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('guards duplicate submissions and discards an older poll', async () => {
  await mount(); let resolve!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  await act(async () => { await Promise.all([latest.save({ ready: true }), latest.save({ ready: true })]) })
  await act(async () => resolve(json(initial())))
  expect(latest.snapshot?.ownReady).toBe(true)
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('stops polling on terminal room state', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 409)); await mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce(); expect(latest.disabled).toBe(true)
})
