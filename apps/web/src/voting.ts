import type { Card } from './card'

export type VoteView = { cardId: string; total: number; selected: boolean }
export type VotingSnapshot = { votes: VoteView[]; voteLimit: number | null; remainingVotes: number | null }
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function parseVoting(value: unknown, role: 'participant' | 'facilitator', cardIds: readonly string[]): VotingSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid voting response')
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.votes) || data.votes.length !== cardIds.length) throw new Error('Incomplete voting response')
  const known = new Set(cardIds)
  const seen = new Set<string>()
  const votes = data.votes.map((raw: unknown): VoteView => {
    if (typeof raw !== 'object' || raw === null) throw new Error('Invalid vote')
    const vote = raw as Record<string, unknown>
    if (typeof vote.cardId !== 'string' || !known.has(vote.cardId) || seen.has(vote.cardId) || !integer(vote.total) ||
        (role === 'participant' && (typeof vote.selected !== 'boolean' || (vote.selected && vote.total === 0)))) throw new Error('Invalid vote')
    seen.add(vote.cardId)
    return { cardId: vote.cardId, total: vote.total, selected: role === 'participant' && vote.selected === true }
  }).sort((a, b) => a.cardId.localeCompare(b.cardId))
  if (role === 'facilitator') return { votes, voteLimit: null, remainingVotes: null }
  if (!integer(data.voteLimit) || data.voteLimit < 1 || !integer(data.remainingVotes) ||
      data.remainingVotes !== data.voteLimit - votes.filter((vote) => vote.selected).length) throw new Error('Invalid vote budget')
  return { votes, voteLimit: data.voteLimit, remainingVotes: data.remainingVotes }
}

export function parseVoteChange(value: unknown, cardId: string, selected: boolean) {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid vote change')
  const data = value as Record<string, unknown>
  const vote = data.vote as Record<string, unknown> | undefined
  if (!vote || vote.cardId !== cardId || vote.selected !== selected || !integer(vote.total) ||
      !integer(data.voteLimit) || data.voteLimit < 1 || !integer(data.remainingVotes) || data.remainingVotes > data.voteLimit ||
      (selected && (vote.total === 0 || data.remainingVotes === data.voteLimit))) {
    throw new Error('Invalid vote change')
  }
  return { vote: { cardId, total: vote.total, selected }, voteLimit: data.voteLimit, remainingVotes: data.remainingVotes }
}

export function discussionOrder(cards: readonly Card[], votes: readonly VoteView[]): Card[] {
  const totals = new Map(votes.map((vote) => [vote.cardId, vote.total]))
  return [...cards].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.id.localeCompare(b.id))
}
