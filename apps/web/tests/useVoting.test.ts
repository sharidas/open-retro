import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useVoting } from '../src/useVoting'
import type { RoomSession } from '../src/session'
import { POLL_INTERVAL_MS } from '../src/useRoom'

const ids = ['a', 'b', 'c', 'd']
let root: Root
let latest: ReturnType<typeof useVoting>
let fetchMock: ReturnType<typeof vi.fn>
let hidden = false
let selected: Set<string>
let phase: 'revealed' | 'closed'
let session: RoomSession
const roomRefresh = vi.fn()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const vote = (cardId: string) => ({ cardId, total: selected.has(cardId) ? 1 : 0, selected: selected.has(cardId) })
const snapshot = () => session.role === 'facilitator' ? { votes: ids.map((cardId) => ({ cardId, total: vote(cardId).total })) } :
  { votes: ids.map(vote), voteLimit: 3, remainingVotes: 3 - selected.size }
function Probe() {
  latest = useVoting({ session, cardIds: ids, phase, enabled: true, available: true, onRoomRefresh: roomRefresh })
  return null
}
async function mount() { await act(async () => { root.render(createElement(Probe)) }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
async function server(url: string, options: RequestInit = {}) {
  if (!options.method || options.method === 'GET') return json(snapshot())
  const id = /cards\/([^/]+)\/vote/.exec(url)![1]
  if (options.method === 'PUT') selected.add(id)
  else selected.delete(id)
  return json({ vote: vote(id), voteLimit: 3, remainingVotes: 3 - selected.size })
}
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  hidden = false; selected = new Set(); phase = 'revealed'
  session = { id: 'room-test', role: 'participant', credential: 'x'.repeat(43), storageWarning: false }
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  fetchMock = vi.fn().mockImplementation(server); vi.stubGlobal('fetch', fetchMock); roomRefresh.mockClear()
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren()
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('adds and removes a vote and reconciles the full personal budget', async () => {
  await mount()
  await act(async () => { await latest.changeVote('a') })
  expect(latest.snapshot?.remainingVotes).toBe(2)
  expect(latest.snapshot?.votes[0].selected).toBe(true)
  expect(latest.awaitingSync).toBe(false)
  await act(async () => { await latest.changeVote('a') })
  expect(latest.snapshot?.remainingVotes).toBe(3)
  expect(fetchMock.mock.calls.filter((call) => call[1].method).map((call) => call[1].method)).toEqual(['PUT', 'DELETE'])
})

it('keeps removals available at zero budget but does not submit a fourth vote', async () => {
  selected = new Set(['a', 'b', 'c'])
  await mount()
  await act(async () => { await latest.changeVote('d') })
  expect(fetchMock.mock.calls.filter((call) => call[1].method)).toHaveLength(0)
  await act(async () => { await latest.changeVote('a') })
  expect(latest.snapshot?.remainingVotes).toBe(1)
})

it('never sends participant mutations from a facilitator view', async () => {
  session = { ...session, role: 'facilitator' }
  await mount()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/rooms/room-test/facilitator/votes')
  expect(latest.snapshot?.remainingVotes).toBeNull()
  await act(async () => { await latest.changeVote('a') })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('updates totals from other participants through bounded polling', async () => {
  await mount()
  selected.add('b')
  await advance(POLL_INTERVAL_MS)
  expect(latest.snapshot?.votes.find((entry) => entry.cardId === 'b')?.total).toBe(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('checks uncertain mutation results without replaying the vote request', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async (url: string, options: RequestInit) => { await server(url, options); throw new Error('response lost') })
  await act(async () => { await latest.changeVote('a') })
  expect(latest.actionError).toContain('may have changed')
  expect(latest.snapshot?.votes[0].selected).toBe(true)
  expect(latest.awaitingSync).toBe(false)
  expect(fetchMock.mock.calls.filter((call) => call[1].method === 'PUT')).toHaveLength(1)
})

it('blocks further mutations when post-vote reconciliation fails, then recovers', async () => {
  await mount()
  fetchMock.mockImplementationOnce(server).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await latest.changeVote('a') })
  expect(latest.error).toContain('voting is paused')
  expect(latest.awaitingSync).toBe(true)
  await act(async () => { await latest.changeVote('b') })
  expect(fetchMock.mock.calls.filter((call) => call[1].method === 'PUT')).toHaveLength(1)
  await advance(POLL_INTERVAL_MS * 2)
  expect(latest.error).toBe('')
  expect(latest.awaitingSync).toBe(false)
})

it('does not overwrite a confirmed change with an older poll response', async () => {
  await mount()
  let finish!: (response: Response) => void
  const older = snapshot()
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  await advance(POLL_INTERVAL_MS)
  await act(async () => { await latest.changeVote('a') })
  await act(async () => finish(json(older)))
  expect(latest.snapshot?.votes[0].selected).toBe(true)
  expect(latest.snapshot?.remainingVotes).toBe(2)
})

it('keeps a synchronous double click from issuing duplicate mutations', async () => {
  await mount()
  let finish!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  let pending!: Promise<void>
  await act(async () => { pending = latest.changeVote('a'); void latest.changeVote('a') })
  expect(fetchMock.mock.calls.filter((call) => call[1].method === 'PUT')).toHaveLength(1)
  selected.add('a')
  await act(async () => { finish(json({ vote: vote('a'), voteLimit: 3, remainingVotes: 2 })); await pending })
  expect(latest.snapshot?.remainingVotes).toBe(2)
})

it('refreshes budget after a server-side limit rejection instead of assuming a vote', async () => {
  await mount()
  fetchMock.mockImplementationOnce(async () => { selected = new Set(['b', 'c', 'd']); return json({ error: 'VOTE_BUDGET_EXCEEDED' }, 409) })
  await act(async () => { await latest.changeVote('a') })
  expect(latest.snapshot?.remainingVotes).toBe(0)
  expect(latest.snapshot?.votes[0].selected).toBe(false)
  expect(latest.actionError).toContain('Remove a vote first')
})

it('shows closed totals without allowing changes or recurring vote polls', async () => {
  phase = 'closed'; selected.add('a')
  await mount()
  await act(async () => { await latest.changeVote('a') })
  await advance(POLL_INTERVAL_MS * 6)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(latest.snapshot?.votes[0].selected).toBe(true)
})

it('pauses hidden-tab polling and refreshes on returning to visibility', async () => {
  await mount()
  await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
  await advance(POLL_INTERVAL_MS * 6)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('stops polling on terminal access errors and requests room status', async () => {
  await mount()
  fetchMock.mockResolvedValueOnce(json({}, 401))
  await advance(POLL_INTERVAL_MS)
  expect(latest.blocked).toBe(true)
  expect(roomRefresh).toHaveBeenCalledTimes(1)
  await advance(120_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
