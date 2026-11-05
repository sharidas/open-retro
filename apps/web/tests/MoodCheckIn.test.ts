import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MoodCheckIn, moods, parseMood } from '../src/MoodCheckIn'
import type { RoomSession } from '../src/session'
let root: Root, fetchMock: ReturnType<typeof vi.fn>
let session: RoomSession, selected: string | null, phase: 'open' | 'complete'
const onRoom = vi.fn(), onRefresh = vi.fn()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const snapshot = () => ({ checkIn: phase, ...(session.role === 'participant' ? { selected } : {}), totals: phase === 'open' ? null : moods.map(m => ({ mood: m.id, total: m.id === selected ? 1 : 0 })) })
async function mount() { await act(async () => root.render(createElement(MoodCheckIn, { session, checkIn: phase, available: true, onRoom, onRefresh }))) }
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))!
  expect(button).toBeDefined(); await act(async () => button.click())
}
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  selected = null; phase = 'open'; session = { id: 'mood-room', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
  onRoom.mockClear(); onRefresh.mockClear()
  fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'PUT') { selected = JSON.parse(options.body as string).mood; return json({ saved: true }) }
    return json(snapshot())
  })
  vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('saves, changes, and withdraws a private mood using confirmed snapshots', async () => {
  await mount(); await click('Good'); expect(selected).toBe('good')
  expect(document.querySelector('[aria-pressed="true"]')?.textContent).toContain('Good')
  await click('Steady'); expect(selected).toBe('steady')
  await click('Skip or withdraw'); expect(selected).toBeNull()
  expect(document.querySelector('[aria-pressed="true"]')).toBeNull()
})
it('reconciles a lost mutation response without replaying it', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async () => { selected = 'good'; throw new Error('lost response') })
  await click('Good')
  expect(document.querySelector('[aria-pressed="true"]')?.textContent).toContain('Good')
  expect(fetchMock.mock.calls.filter(call => call[1].method === 'PUT')).toHaveLength(1)
  expect(onRefresh).toHaveBeenCalledOnce()
})
it('blocks further answers when reconciliation fails', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async () => json({ saved: true })).mockRejectedValueOnce(new Error('offline'))
  await click('Good')
  expect(document.querySelector<HTMLButtonElement>('[aria-pressed]')?.disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
})
it('offers confirmation only to facilitators and accepts the started room', async () => {
  session = { ...session, role: 'facilitator' }; await mount()
  expect(document.querySelector('[aria-pressed]')).toBeNull()
  await click('Start writing'); expect(fetchMock).toHaveBeenCalledTimes(1)
  await click('Keep checking in'); expect(fetchMock).toHaveBeenCalledTimes(1)
  await click('Start writing')
  const room = { id: session.id, columns: ['A'], state: 'writing', checkIn: 'complete', expiresAt: Date.now() + 60000 }
  fetchMock.mockImplementationOnce(async () => { phase = 'complete'; return json({ room }) })
  await click('Confirm start writing'); expect(onRoom).toHaveBeenCalledWith(room)
})
it('shows frozen aggregate counts without answer controls after completion', async () => {
  phase = 'complete'; selected = 'steady'; await mount()
  expect(document.querySelector('[aria-pressed]')).toBeNull()
  expect(document.body.textContent).toContain('1 response.')
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('stops polling and requests room status on expired access', async () => {
  fetchMock.mockResolvedValue(json({}, 404)); await mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(onRefresh).toHaveBeenCalledOnce()
})
it('rejects malformed results and premature aggregate disclosure', () => {
  expect(() => parseMood({ checkIn: 'open', selected: null, totals: [] }, true)).toThrow()
  expect(() => parseMood({ checkIn: 'open', totals: null }, true)).toThrow()
  expect(() => parseMood({ checkIn: 'complete', selected: null, totals: [{ mood: 'good', total: -1 }] }, true)).toThrow()
})
