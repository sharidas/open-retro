import { describe, expect, it } from 'vitest'
import { createRoom, RoomRuleError, transitionRoom, type RoomState } from '../src/domain/room.js'

describe('room columns', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i named columns and starts in writing', (count) => {
    const columns = Array.from({ length: count }, (_, index) => `Column ${index + 1}`)
    expect(createRoom(columns)).toEqual({ columns, state: 'writing' })
  })

  it('trims names, preserves order, and does not retain the input array', () => {
    const input = ['  Went well ', 'Could improve', ' Ideas\n']
    const room = createRoom(input)
    input[0] = 'Changed'
    expect(room.columns).toEqual(['Went well', 'Could improve', 'Ideas'])
  })

  const invalidColumns: unknown[] = [
    undefined, null, 'Went well', {}, [],
    ['A', 'B', 'C', 'D', 'E', 'F'],
    [''], [' \t\n'], ['Valid', ' '], ['Valid', 42], [null],
    new Array(2),
  ]
  for (const [index, columns] of invalidColumns.entries()) {
    it(`rejects invalid column input ${index + 1}`, () => {
      expect(() => createRoom(columns)).toThrow(RoomRuleError)
      expect(() => createRoom(columns)).toThrow(expect.objectContaining({ code: 'INVALID_COLUMNS' }))
    })
  }
})

describe('room lifecycle', () => {
  const states: RoomState[] = ['writing', 'revealed', 'closed']
  for (const from of states) {
    for (const to of states) {
      const allowed = (from === 'writing' && to === 'revealed') ||
        (from === 'revealed' && to === 'closed')
      it(`${allowed ? 'allows' : 'rejects'} ${from} → ${to}`, () => {
        const room = { ...createRoom(['Went well']), state: from }
        if (allowed) {
          expect(transitionRoom(room, to)).toEqual({ columns: ['Went well'], state: to })
        } else {
          expect(() => transitionRoom(room, to)).toThrow(
            expect.objectContaining({ code: 'INVALID_TRANSITION' }),
          )
        }
        expect(room.state).toBe(from)
      })
    }
  }

  it('completes writing, reveal, and closure without changing columns', () => {
    const writing = createRoom(['Went well', 'Could improve'])
    const revealed = transitionRoom(writing, 'revealed')
    const closed = transitionRoom(revealed, 'closed')
    expect(closed).toEqual({ columns: writing.columns, state: 'closed' })
    expect(writing.state).toBe('writing')
    expect(revealed.state).toBe('revealed')
  })
})
