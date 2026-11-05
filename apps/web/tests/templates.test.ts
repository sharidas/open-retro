import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '../src/App'
import { templates, columnStyle } from '../src/templates'
import { isRoom } from '../src/useRoom'

vi.mock('../src/session', () => ({ roomSession: null }))
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ room: { id: '12345678-1234-1234-1234-123456789abc', expiresAt: Date.now() + 86400000 }, facilitatorSecret: 'x'.repeat(43) })))
  vi.stubGlobal('fetch', fetchMock)
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root.render(createElement(App)))
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.startsWith(text))!
  expect(button).toBeDefined(); await act(async () => button.click())
}
const names = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="column-"]')).map(input => input.value)
it.each(templates)('prefills and submits the $name template', async template => {
  await click(template.name)
  expect(names()).toEqual([...template.columns])
  await click('Create retrospective')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ columns: [...template.columns], columnColors: [...template.colors], moodCheckIn: true })
})
it('keeps changed colours with their column when another column is removed', async () => {
  const select = document.querySelector<HTMLSelectElement>('select')!
  await act(async () => { select.value = 'lavender'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove column 2"]')!
  await act(async () => remove.click())
  await click('Create retrospective')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ columns: ['Went well', 'Next steps'], columnColors: ['lavender', 'blue'], moodCheckIn: true })
})
it('starts with one blank column, rejects blank submission, and enforces the five-column limit', async () => {
  await click('Start from scratch'); expect(names()).toEqual([''])
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Remove column 1"]')?.disabled).toBe(true)
  await click('Create retrospective'); expect(fetchMock).not.toHaveBeenCalled()
  for (let index = 0; index < 5; index++) await click('Add column')
  expect(names()).toHaveLength(5)
  expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add column')?.disabled).toBe(true)
})
it('rejects malformed room colours and safely falls back for older responses', () => {
  const room = { id: 'room', columns: ['A'], state: 'writing', expiresAt: 100 }
  expect(isRoom(room, 'room')).toBe(true)
  expect(isRoom({ ...room, columnColors: ['sage'] }, 'room')).toBe(true)
  for (const columnColors of [[], ['sage', 'blue'], ['url(bad)'], null]) expect(isRoom({ ...room, columnColors }, 'room')).toBe(false)
  expect(columnStyle('url(bad)')).toEqual(columnStyle('sage'))
})
