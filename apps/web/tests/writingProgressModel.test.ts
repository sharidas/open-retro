import { expect, it } from 'vitest'
import { formatTime, parseWritingProgress, remainingTime } from '../src/writingProgress'
const data = { serverNow: 100000, timer: { version: 1, status: 'running' as const, endsAt: 160000, remainingMs: 0 }, ownReady: false }
it('uses server time and elapsed duration, clamping expiration to zero', () => {
  expect(remainingTime(data, 15000)).toBe(45000)
  expect(remainingTime(data, 90000)).toBe(0)
  expect(formatTime(59999)).toBe('01:00')
  expect(formatTime(0)).toBe('00:00')
})
it('keeps paused time fixed', () => {
  expect(remainingTime({ ...data, timer: { ...data.timer, status: 'paused', endsAt: null, remainingMs: 45000 } }, 90000)).toBe(45000)
})
it('rejects participant count leaks and inconsistent facilitator counts', () => {
  expect(parseWritingProgress(data, true)).toEqual(data)
  expect(() => parseWritingProgress({ ...data, readyCount: 1 }, true)).toThrow()
  expect(() => parseWritingProgress({ serverNow: data.serverNow, timer: data.timer, joinedCount: 1, readyCount: 2 }, false)).toThrow()
})
it('rejects malformed timer state', () => {
  for (const timer of [{ ...data.timer, endsAt: null }, { ...data.timer, version: -1 }, { ...data.timer, remainingMs: 1 }]) {
    expect(() => parseWritingProgress({ ...data, timer }, true)).toThrow()
  }
})
