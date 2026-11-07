import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DeleteControl } from '../src/DeleteControl'
let root: Root, fetchMock: ReturnType<typeof vi.fn>
const deleted = vi.fn(), refresh = vi.fn()
const session = { id: 'room', role: 'facilitator' as const, credential: 'x'.repeat(43), storageWarning: false }
async function mount(disabled = false) { await act(async () => root.render(createElement(DeleteControl, { session, disabled, onDeleted: deleted, onRefresh: refresh }))) }
async function click(label: string) { await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!.click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  deleted.mockClear(); refresh.mockClear(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
it('requires explicit confirmation, supports cancellation, and reports successful deletion', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  await mount(); await click('Delete room'); expect(fetchMock).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('This cannot be undone')
  await click('Keep room'); expect(fetchMock).not.toHaveBeenCalled()
  await click('Delete room'); await click('Permanently delete room')
  expect(fetchMock).toHaveBeenCalledWith('/api/rooms/room/facilitator', expect.objectContaining({ method: 'DELETE', headers: { Authorization: `Bearer ${session.credential}` } }))
  expect(deleted).toHaveBeenCalledOnce()
})
it('disables deletion when room access is unavailable', async () => {
  await mount(true); await click('Delete room'); expect(fetchMock).not.toHaveBeenCalled()
})
it.each([401, 404, 409, 500])('reconciles HTTP %s without claiming deletion or retrying', async status => {
  fetchMock.mockResolvedValue(new Response('{}', { status }))
  await mount(); await click('Delete room'); await click('Permanently delete room')
  expect(deleted).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce()
  expect(document.body.textContent).toContain('could not be confirmed')
})
it('does not replay an uncertain deletion', async () => {
  fetchMock.mockRejectedValue(new Error('lost response'))
  await mount(); await click('Delete room'); await click('Permanently delete room')
  expect(deleted).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce()
})
