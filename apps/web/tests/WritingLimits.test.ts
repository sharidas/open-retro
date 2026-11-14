import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WritingBoard } from '../src/WritingBoard'
let root: Root | undefined
const session = { id: 'room', role: 'participant' as const, credential: 'x'.repeat(43), storageWarning: false }
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
it.each([422, 429])('retains unsent writing and allows recovery after HTTP %s', async status => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => options.method === 'POST' ? new Response('{}', { status }) : new Response('{"cards":[]}'))
  vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root!.render(createElement(WritingBoard, { session, columns: ['A'], phase: 'writing', available: true })))
  const draft = document.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft, 'Keep my draft')
    draft.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(draft.value).toBe('Keep my draft')
  expect(document.body.textContent).toContain(status === 422 ? 'Card limit reached' : 'Too many requests')
  expect(draft.disabled).toBe(false)
  expect(fetchMock.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(1)
})
