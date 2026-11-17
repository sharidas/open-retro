import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WritingBoard } from '../src/WritingBoard'

const session = { id: 'room', role: 'participant' as const, credential: 'x'.repeat(43), storageWarning: false }
const card = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', columnIndex: 0, text: 'Keep this thought' }
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent === label)!
async function render(available = true, phase: 'writing' | 'revealed' = 'writing') {
  await act(async () => root.render(createElement(WritingBoard, { session, columns: ['A'], available, phase })))
}
async function type(selector: string, text: string) {
  await act(async () => {
    const field = document.querySelector(selector)!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
async function click(label: string) { await act(async () => button(label).click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock = vi.fn().mockImplementation(async () => json({ cards: [] }))
  vi.stubGlobal('fetch', fetchMock)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it.each(['lost response', 'server error', 'invalid response'])('requires a successful refresh after %s without replaying a saved card', async failure => {
  await render(); await type('#draft-0', card.text)
  fetchMock.mockImplementationOnce(async () => {
    if (failure === 'lost response') throw new Error('response lost after commit')
    return failure === 'server error' ? json({}, 503) : json({ card: null })
  })
  await submit()
  expect(button('Save card in column 1').disabled).toBe(true)
  // Changing the draft must not bypass reconciliation, including form submission via Enter.
  await type('#draft-0', 'Keep this thought plus more'); await submit()
  fetchMock.mockRejectedValueOnce(new Error('still offline'))
  await click('Refresh my cards')
  expect(button('Save card in column 1').disabled).toBe(true)
  fetchMock.mockResolvedValueOnce(json({ cards: [card] }))
  await click('Refresh my cards')
  expect(button('Edit card')).toBeDefined()
  expect((document.querySelector('#draft-0') as HTMLTextAreaElement).value).toBe('Keep this thought plus more')
  expect(button('Save card in column 1').disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})

it('preserves drafts during an outage and keeps saving disabled if reconnect reveals the room', async () => {
  await render(); await type('#draft-0', 'Unsent thought')
  await render(false); await submit()
  expect(button('Save card in column 1').disabled).toBe(true)
  await render(true, 'revealed'); await submit()
  expect(button('Save card in column 1').disabled).toBe(true)
  expect((document.querySelector('#draft-0') as HTMLTextAreaElement).value).toBe('Unsent thought')
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0)
})

it('keeps unsaved edits through failed saves, outage and reconnect without replay', async () => {
  fetchMock.mockResolvedValueOnce(json({ cards: [card] }))
  await render(); await click('Edit card'); await type(`textarea[id="edit-${card.id}"]`, 'Unsaved revision')
  fetchMock.mockRejectedValueOnce(new Error('offline')); await submit()
  await render(false)
  expect(button('Save changes').disabled).toBe(true)
  await render(true)
  expect((document.querySelector(`textarea[id="edit-${card.id}"]`) as HTMLTextAreaElement).value).toBe('Unsaved revision')
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1)
})

it('retains a timed-out draft and does not retry it when the connection returns', async () => {
  vi.useFakeTimers()
  await render(); await type('#draft-0', 'Timed-out thought')
  fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new Error('timeout')))
  }))
  await submit()
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(button('Save card in column 1').disabled).toBe(true)
  expect((document.querySelector('#draft-0') as HTMLTextAreaElement).value).toBe('Timed-out thought')
  await render(false); await render(true)
  expect(button('Save card in column 1').disabled).toBe(true)
  await click('Refresh my cards')
  expect(button('Save card in column 1').disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})
