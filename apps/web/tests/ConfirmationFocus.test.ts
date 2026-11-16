import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RevealControl } from '../src/RevealControl'
import { CloseControl } from '../src/CloseControl'
import { DeleteControl } from '../src/DeleteControl'
import { MoodCheckIn } from '../src/MoodCheckIn'
import { SavedCard } from '../src/SavedCard'
let root: Root, fetchMock: ReturnType<typeof vi.fn>
const session = { id: 'room', role: 'facilitator' as const, credential: 'x'.repeat(43), storageWarning: false }
const noop = () => {}
const controls = [
  { label: 'reveal', trigger: 'Reveal cards', cancel: 'Keep writing', render: () => createElement(RevealControl, { session, disabled: false, onRevealed: noop, onRefresh: noop }) },
  { label: 'close', trigger: 'Close room', cancel: 'Keep discussing', render: () => createElement(CloseControl, { session, disabled: false, onClosed: noop, onRefresh: noop }) },
  { label: 'delete', trigger: 'Delete room', cancel: 'Keep room', render: () => createElement(DeleteControl, { session, disabled: false, onDeleted: noop, onRefresh: noop }) },
  { label: 'check-in', trigger: 'Start writing', cancel: 'Keep checking in', render: () => createElement(MoodCheckIn, { session, checkIn: 'open', available: true, onRoom: noop, onRefresh: noop }) },
]
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!
async function click(label: string) { await act(async () => { button(label).focus(); button(label).click() }) }
async function mount(node: ReactNode) { await act(async () => root.render(createElement(StrictMode, null, node))) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock = vi.fn().mockImplementation(async () => new Response('{"checkIn":"open","totals":null}'))
  vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
it.each(controls)('keeps focus through $label confirmation and cancellation', async control => {
  await mount(control.render())
  expect(document.activeElement).toBe(document.body)
  const calls = fetchMock.mock.calls.length
  await click(control.trigger)
  const warning = document.querySelector('p[tabindex="-1"]')!
  expect(document.activeElement).toBe(warning)
  expect(warning.textContent).not.toBe('')
  button(control.cancel).focus()
  await mount(control.render()) // ordinary rerenders must not take focus back
  expect(document.activeElement).toBe(button(control.cancel))
  await click(control.cancel)
  expect(document.activeElement).toBe(button(control.trigger))
  expect(fetchMock).toHaveBeenCalledTimes(calls)
})
const cardProps = { card: { id: 'card', columnIndex: 0, text: 'A thought' }, session: { ...session, role: 'participant' as const }, columnCount: 1, disabled: false,
  onActive: noop, onBusy: noop, onAccessLost: noop, onUpdated: noop, onDeleted: noop }
it('restores the correct card button after edit and delete cancellation', async () => {
  await mount(createElement(SavedCard, cardProps))
  await click('Edit card'); expect(document.activeElement).toBe(document.querySelector('textarea'))
  await click('Cancel edit'); expect(document.activeElement).toBe(button('Edit card'))
  await click('Delete card'); expect(document.activeElement).toBe(document.querySelector('p[tabindex="-1"]'))
  await click('Keep card'); expect(document.activeElement).toBe(button('Delete card'))
  expect(fetchMock).not.toHaveBeenCalled()
})
