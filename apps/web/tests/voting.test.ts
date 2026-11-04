import { expect, it } from 'vitest'
import { discussionOrder, parseVoteChange, parseVoting } from '../src/voting'

const ids = ['a', 'b']
const valid = { votes: [{ cardId: 'a', total: 2, selected: true }, { cardId: 'b', total: 0, selected: false }], voteLimit: 3, remainingVotes: 2 }
it('validates a complete personal snapshot and removes unsupported fields', () => {
  expect(parseVoting({ ...valid, voterHash: 'never retain' }, 'participant', ids)).toEqual(valid)
})
it.each([
  null, { ...valid, remainingVotes: 3 }, { ...valid, remainingVotes: -1 },
  { ...valid, votes: [valid.votes[0]] },
  { ...valid, votes: [valid.votes[0], valid.votes[0]] },
  { ...valid, votes: [{ cardId: 'other-room', total: 1, selected: true }, valid.votes[1]] },
  { ...valid, votes: [{ cardId: 'a', total: -1, selected: true }, valid.votes[1]] },
  { ...valid, votes: [{ cardId: 'a', total: 0, selected: true }, valid.votes[1]] },
])('rejects invalid or inconsistent voting state: %#', (data) => {
  expect(() => parseVoting(data, 'participant', ids)).toThrow()
})
it('does not retain personal selections or budgets for facilitator state', () => {
  expect(parseVoting(valid, 'facilitator', ids)).toEqual({ votes: [
    { cardId: 'a', total: 2, selected: false }, { cardId: 'b', total: 0, selected: false },
  ], voteLimit: null, remainingVotes: null })
})
it('checks that a mutation response matches the requested card and state', () => {
  const value = { vote: { cardId: 'a', total: 1, selected: true }, voteLimit: 3, remainingVotes: 2 }
  expect(parseVoteChange(value, 'a', true)).toEqual(value)
  expect(() => parseVoteChange(value, 'b', true)).toThrow()
  expect(() => parseVoteChange(value, 'a', false)).toThrow()
})
it('prioritizes votes across columns with deterministic ties and no input mutation', () => {
  const cards = [{ id: 'b', columnIndex: 0, text: 'Second' }, { id: 'a', columnIndex: 1, text: 'First' }, { id: 'c', columnIndex: 0, text: 'Top' }]
  const votes = [{ cardId: 'a', total: 1, selected: true }, { cardId: 'b', total: 1, selected: false }, { cardId: 'c', total: 3, selected: false }]
  expect(discussionOrder(cards, votes).map((card) => card.id)).toEqual(['c', 'a', 'b'])
  expect(cards.map((card) => card.id)).toEqual(['b', 'a', 'c'])
})
