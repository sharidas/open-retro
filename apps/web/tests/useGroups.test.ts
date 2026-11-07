import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useGroups } from '../src/useGroups'
import type { RoomSession } from '../src/session'
let root: Root, latest: ReturnType<typeof useGroups>, fetchMock: ReturnType<typeof vi.fn>
let phase: 'revealed' | 'closed', session: RoomSession, hidden = false
let snapshot = { version: 0, groups: [] as { id: string; name: string; cardIds: string[] }[] }
const refresh = vi.fn(), group = { id: 'group', name: 'Theme', cardIds: ['a', 'b'] }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function Probe() { latest = useGroups(session, ['a', 'b'], phase, true, refresh); return null }
async function mount() { await act(async () => root.render(createElement(Probe))) }
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  phase = 'revealed'; hidden = false; snapshot = { version: 0, groups: [] }; refresh.mockClear()
  session = { id: 'room', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'PUT') { const body = JSON.parse(options.body as string); snapshot = { version: body.version + 1, groups: body.groups }; return json({ saved: true }) }
    return json(snapshot)
  }); vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('saves with the displayed revision and reconciles the updated snapshot', async () => {
  await mount(); await act(async () => { await latest.save([group]) })
  expect(latest.snapshot).toEqual({ version: 1, groups: [group] }); expect(latest.disabled).toBe(false)
  const write = fetchMock.mock.calls.find(call => call[1].method === 'PUT')!
  expect(JSON.parse(write[1].body)).toEqual({ version: 0, groups: [group] })
})
it('uses the facilitator endpoint for facilitator edits', async () => {
  session = { ...session, role: 'facilitator' }; await mount()
  await act(async () => { await latest.save([group]) })
  expect(fetchMock.mock.calls.every(call => call[0] === '/api/rooms/room/facilitator/groups')).toBe(true)
})
it('refreshes on a conflict without replaying or overwriting the other edit', async () => {
  await mount(); snapshot = { version: 1, groups: [{ ...group, name: 'Peer edit' }] }
  fetchMock.mockResolvedValueOnce(json({ error: 'GROUPING_CHANGED' }, 409))
  await act(async () => { await latest.save([group]) })
  expect(latest.snapshot?.groups[0].name).toBe('Peer edit'); expect(latest.message).toContain('Review')
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('reconciles uncertain writes and keeps editing disabled while the read fails', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async () => { snapshot = { version: 1, groups: [group] }; throw new Error('lost response') }).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await latest.save([group]) })
  expect(latest.disabled).toBe(true)
  await act(async () => { latest.refresh() })
  expect(latest.snapshot?.version).toBe(1); expect(latest.disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('guards synchronous duplicate submissions', async () => {
  await mount(); await act(async () => { await Promise.all([latest.save([group]), latest.save([group])]) })
  expect(fetchMock.mock.calls.filter(call => call[1].method)).toHaveLength(1)
})
it('does not let an older poll replace a confirmed edit', async () => {
  await mount(); let resolve!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  await act(async () => { await latest.save([group]) })
  await act(async () => resolve(json({ version: 0, groups: [] })))
  expect(latest.snapshot?.version).toBe(1)
})
it('freezes changes and recurring polling after closure', async () => {
  phase = 'closed'; await mount(); await act(async () => { await latest.save([group]); await vi.advanceTimersByTimeAsync(60000) })
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(latest.disabled).toBe(true)
})
it('pauses hidden-tab polling and stops on terminal access failure', async () => {
  await mount(); hidden = true
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  hidden = false; fetchMock.mockResolvedValueOnce(json({}, 404))
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledOnce()
})
