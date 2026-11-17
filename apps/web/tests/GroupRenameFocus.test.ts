import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GroupingBoard } from '../src/GroupingBoard'
import { useGroups } from '../src/useGroups'
vi.mock('../src/useGroups')
let root: Root
let disabled: boolean
const save = vi.fn()
const session = { id: 'room', role: 'participant' as const, credential: 'x'.repeat(43), storageWarning: false }
const groups = [
  { id: 'first', name: 'First theme', cardIds: [] },
  { id: 'second', name: 'Second theme', cardIds: [] },
]
const button = (text: string, index = 0) => [...document.querySelectorAll('button')].filter(b => b.textContent === text)[index]!
const editor = () => document.querySelector('form input') as HTMLInputElement | null
async function click(text: string, index = 0) {
  await act(async () => { const target = button(text, index); target.focus(); target.click() })
}
async function render() {
  await act(async () => root.render(createElement(StrictMode, null, createElement(GroupingBoard, {
    session, cards: [], columns: ['A'], phase: 'revealed', available: true,
    onRoomRefresh: () => {}, totals: null, renderCard: () => null,
  }))))
}
async function submit() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  disabled = false; save.mockReset().mockResolvedValue(true)
  vi.mocked(useGroups).mockImplementation(() => ({ snapshot: { version: 0, groups }, disabled,
    pending: false, error: '', message: '', save, refresh: () => {} }))
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren() })
it('focuses the name editor and restores the correct group trigger on cancellation', async () => {
  await render(); expect(document.activeElement).toBe(document.body)
  await click('Rename group', 1)
  expect(document.activeElement).toBe(editor()); expect(editor()?.value).toBe('Second theme')
  button('Cancel rename').focus(); await render()
  expect(document.activeElement).toBe(button('Cancel rename'))
  await click('Cancel rename')
  expect(document.activeElement).toBe(button('Rename group', 1))
  expect(save).not.toHaveBeenCalled()
})
it('restores focus after successful save and subsequent reconciliation enables controls', async () => {
  await render(); await click('Rename group')
  save.mockImplementationOnce(async () => { disabled = true; return true })
  await submit(); await render()
  expect(editor()).toBeNull()
  disabled = false; await render()
  expect(document.activeElement).toBe(button('Rename group'))
})
it('keeps the editor and current focus after a failed save', async () => {
  save.mockResolvedValue(false)
  await render(); await click('Rename group'); button('Save name').focus()
  await submit()
  expect(editor()?.value).toBe('First theme')
  expect(document.activeElement).toBe(button('Save name'))
})
it('does not close another group editor when an older save finishes', async () => {
  let finish!: (saved: boolean) => void
  save.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
  await render(); await click('Rename group'); await submit()
  await click('Cancel rename'); await click('Rename group', 1)
  await act(async () => finish(true))
  expect(editor()?.value).toBe('Second theme')
  expect(document.activeElement).toBe(editor())
})

it('does not steal focus if the user moves elsewhere while reconciliation is pending', async () => {
  await render(); await click('Rename group')
  save.mockImplementationOnce(async () => { disabled = true; return true })
  await submit(); await render()
  button('Refresh groups').focus()
  disabled = false; await render()
  expect(document.activeElement).toBe(button('Refresh groups'))
})
