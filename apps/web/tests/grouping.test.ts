import { expect, it } from 'vitest'
import { moveCards, parseGroups } from '../src/grouping'
const groups = [{ id: 'one', name: 'One', cardIds: ['a', 'b'] }, { id: 'two', name: 'Two', cardIds: ['c'] }]
it('moves cards exactly once and removes empty groups without mutating the snapshot', () => {
  expect(moveCards(groups, ['a', 'b'], 'two')).toEqual([{ id: 'two', name: 'Two', cardIds: ['c', 'a', 'b'] }])
  expect(groups[0].cardIds).toEqual(['a', 'b'])
  expect(moveCards(groups, ['a', 'c'], null)).toEqual([{ id: 'one', name: 'One', cardIds: ['b'] }])
})
it('creates a group from existing and ungrouped cards and rejects missing targets', () => {
  expect(moveCards(groups, ['a', 'd'], null, { id: 'new', name: 'New' })).toEqual([
    { id: 'one', name: 'One', cardIds: ['b'] }, groups[1], { id: 'new', name: 'New', cardIds: ['a', 'd'] },
  ])
  expect(() => moveCards(groups, ['a'], 'missing')).toThrow()
})
it('rejects duplicate, foreign, empty, and malformed memberships', () => {
  expect(parseGroups({ version: 1, groups }, ['a', 'b', 'c'])).toEqual({ version: 1, groups })
  for (const invalid of [null, { version: -1, groups }, { version: 1, groups: [...groups, groups[0]] },
    { version: 1, groups: [{ id: 'g', name: 'Group', cardIds: [] }] },
    { version: 1, groups: [{ id: 'g', name: 'Group', cardIds: ['unknown'] }] },
    { version: 1, groups: [{ id: 'g', name: 'Group', cardIds: ['a', 'a'] }] }]) expect(() => parseGroups(invalid, ['a', 'b', 'c'])).toThrow()
})
