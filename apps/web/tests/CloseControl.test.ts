import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CloseControl } from '../src/CloseControl'

let root: Root
let fetchMock: ReturnType<typeof vi.fn>
const closed = vi.fn(), refresh = vi.fn()
const session = { id: 'test-room', role: 'facilitator' as const, credential: 'x'.repeat(43), storageWarning: false }
const room = { id: session.id, state: 'closed', columns: ['A'], createdAt: Date.now(), expiresAt: Date.now() + 86400000 }
async function mount(disabled = false) {
  await act(async () => root.render(createElement(CloseControl, { session, disabled, onClosed: closed, onRefresh: refresh })))
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); closed.mockClear(); refresh.mockClear()
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals()
})
it('requires confirmation, allows cancellation, and accepts the confirmed closed room', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ room })))
  await mount(); await click('Close room')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('This cannot be reversed')
  await click('Keep discussing'); expect(fetchMock).not.toHaveBeenCalled()
  await click('Close room'); await click('Confirm close')
  expect(fetchMock).toHaveBeenCalledWith('/api/rooms/test-room/close', expect.objectContaining({ method: 'POST', headers: { Authorization: `Bearer ${session.credential}` } }))
  expect(closed).toHaveBeenCalledWith(room)
})
it('disables closure when room status is unavailable', async () => {
  await mount(true); await click('Close room'); expect(fetchMock).not.toHaveBeenCalled()
  expect(document.querySelector('button')?.disabled).toBe(true)
})
it.each([401, 404, 409, 500])('refreshes room status after HTTP %s without replaying closure', async status => {
  fetchMock.mockResolvedValue(new Response('{}', { status }))
  await mount(); await click('Close room'); await click('Confirm close')
  expect(refresh).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledOnce(); expect(document.querySelector('[role="alert"]')).not.toBeNull()
})
it('reconciles a lost response instead of claiming failure or replaying closure', async () => {
  fetchMock.mockRejectedValue(new Error('lost response'))
  await mount(); await click('Close room'); await click('Confirm close')
  expect(document.body.textContent).toContain('Closure may have succeeded')
  expect(refresh).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce()
})
