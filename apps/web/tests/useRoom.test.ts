import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { POLL_INTERVAL_MS, useRoom, type Room } from '../src/useRoom'
import type { RoomSession } from '../src/session'

const session: RoomSession = { id: 'room-test', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
let root: Root
let latest: ReturnType<typeof useRoom>
let hidden = false
let fetchMock: ReturnType<typeof vi.fn>
const room = (state: Room['state'] = 'writing'): Room => ({ id: session.id, columns: ['A'], state, expiresAt: Date.now() + 86_400_000 })
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function Probe() { latest = useRoom(session); return null }
async function mount(strict = false) {
  await act(async () => { root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)) })
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  fetchMock = vi.fn().mockImplementation(async () => response(200, { room: room() }))
  vi.stubGlobal('fetch', fetchMock)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('polls at a bounded interval and adopts revealed phase without a reload', async () => {
  await mount()
  expect(latest.room?.state).toBe('writing')
  await advance(POLL_INTERVAL_MS - 1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fetchMock.mockImplementation(async () => response(200, { room: room('revealed') }))
  await advance(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(latest.room?.state).toBe('revealed')
})

it('registers an anonymous token only when initial access needs joining', async () => {
  fetchMock.mockResolvedValueOnce(response(401, {})).mockResolvedValueOnce(response(200, { room: room() }))
  await mount()
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/rooms/${session.id}/join`)
  expect(fetchMock.mock.calls[1][1].method).toBe('POST')
  expect(latest.room?.state).toBe('writing')
})

it('does not overlap slow metadata requests', async () => {
  let finish!: (value: Response) => void
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve }))
  await mount()
  await advance(POLL_INTERVAL_MS)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => finish(response(200, { room: room() })))
  await advance(POLL_INTERVAL_MS)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('pauses hidden tabs and checks immediately on returning to visibility', async () => {
  await mount()
  await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
  await advance(POLL_INTERVAL_MS * 6)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('loads a background-opened room once without recurring hidden requests', async () => {
  hidden = true
  await mount()
  expect(latest.room?.state).toBe('writing')
  await advance(POLL_INTERVAL_MS * 6)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('keeps the last room on transient failure, backs off, then recovers', async () => {
  await mount()
  fetchMock.mockResolvedValueOnce(response(503, {}))
  await advance(POLL_INTERVAL_MS)
  expect(latest.room?.state).toBe('writing')
  expect(latest.error).toContain('saving is paused')
  expect(latest.terminal).toBe(false)
  await advance(POLL_INTERVAL_MS)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await advance(POLL_INTERVAL_MS)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(latest.error).toBe('')
})

it.each([401, 404])('stops on terminal status %i without automatically joining again', async (status) => {
  await mount()
  fetchMock.mockResolvedValueOnce(response(status, {}))
  await advance(POLL_INTERVAL_MS)
  expect(latest.terminal).toBe(true)
  await advance(120_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('does not regress a confirmed reveal when an older poll response arrives', async () => {
  await mount()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  await advance(POLL_INTERVAL_MS)
  await act(async () => latest.acceptRoom(room('revealed')))
  await act(async () => finish(response(200, { room: room('writing') })))
  expect(latest.room?.state).toBe('revealed')
})

it('aborts in-flight work and stops timers on leaving the view', async () => {
  fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}))
  await mount()
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
  await act(async () => root.unmount())
  expect(signal.aborted).toBe(true)
  await advance(120_000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  root = createRoot(document.createElement('div'))
})

it('aborts timed-out requests and reports a recoverable connection failure', async () => {
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  await mount()
  await advance(15_000)
  expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  expect(latest.loading).toBe(false)
  expect(latest.error).toContain('saving is paused')
  expect(latest.terminal).toBe(false)
})

it('cleans up the first StrictMode effect and leaves a single polling loop', async () => {
  await mount(true)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  await advance(POLL_INTERVAL_MS)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
