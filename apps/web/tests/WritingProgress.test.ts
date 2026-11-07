import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WritingProgress } from '../src/WritingProgress'
import type { RoomSession } from '../src/session'
let root: Root, fetchMock: ReturnType<typeof vi.fn>
const refresh = vi.fn()
let session: RoomSession, ownReady: boolean
const timer = { version: 1, status: 'running', endsAt: 1000, remainingMs: 0 }
async function mount(dirty = false) {
  await act(async () => root.render(createElement(WritingProgress, { session, available: true, hasUnsentWriting: dirty, onRoomRefresh: refresh })))
}
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); ownReady = false
  session = { id: 'room', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
  fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'PUT') { ownReady = JSON.parse(options.body as string).ready; return new Response('{}') }
    return new Response(JSON.stringify({ serverNow: 2000, timer, ...(session.role === 'participant' ? { ownReady } : { joinedCount: 6, readyCount: 4 }) }))
  }); vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('shows only own readiness and blocks marking finished with unsaved writing', async () => {
  await mount(true)
  expect(button('I’m finished writing').disabled).toBe(true)
  expect(document.body.textContent).not.toContain('joined participants ready')
  expect(button('Start timer')).toBeUndefined()
  await mount(false); await act(async () => button('I’m finished writing').click())
  expect(button('I’m still writing').disabled).toBe(false)
  await mount(true); await act(async () => button('I’m still writing').click())
  expect(ownReady).toBe(false)
})
it('shows the anonymous count only to the facilitator', async () => {
  session.role = 'facilitator'; await mount()
  expect(document.body.textContent).toContain('4 of 6 joined participants ready')
  expect(button('Restart timer')).toBeDefined()
  expect(button('I’m finished writing')).toBeUndefined()
})
it('expiry prompts but never sends a reveal or locks writing', async () => {
  await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(document.body.textContent).toContain('You can keep writing')
  expect(button('I’m finished writing').disabled).toBe(false)
  expect(fetchMock.mock.calls.every(call => !call[1].method)).toBe(true)
})
