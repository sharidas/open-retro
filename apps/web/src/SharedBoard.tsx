import { useEffect, useState } from 'react'
import { isCard, type Card } from './card'
import type { RoomSession } from './session'
import { useVoting } from './useVoting'
import { discussionOrder } from './voting'
import styles from './App.module.css'

export function SharedBoard({ session, columns, phase, available, onRoomRefresh }: {
  session: RoomSession; columns: string[]; phase: 'revealed' | 'closed'; available: boolean; onRoomRefresh: () => void
}) {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<'columns' | 'discussion'>('columns')
  const voting = useVoting({ session, cardIds: cards.map((card) => card.id), phase,
    enabled: !loading && !error, available, onRoomRefresh })
  const snapshot = voting.snapshot
  const voteMap = new Map(snapshot?.votes.map((vote) => [vote.cardId, vote]) ?? [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000)
    setLoading(true); setError('')
    async function load() {
      try {
        const suffix = session.role === 'facilitator' ? 'facilitator/cards' : 'revealed-cards'
        const response = await fetch(`/api/rooms/${session.id}/${suffix}`, {
          headers: { Authorization: `Bearer ${session.credential}` },
          signal: controller.signal, cache: 'no-store',
        })
        if (!response.ok) {
          setError(response.status === 401 ? 'Your room access was not accepted. Reopen the correct room link.' :
            response.status === 404 ? 'This room is unavailable. It may have expired or been deleted.' :
            response.status === 409 ? 'Cards have not been revealed yet. Check the room phase.' :
            'Could not load the shared cards. Please try again.')
          return
        }
        const data = await response.json()
        if (!Array.isArray(data?.cards) || !data.cards.every((card: unknown) => isCard(card, columns.length))) throw new Error('Invalid cards response')
        if (!controller.signal.aborted) setCards(data.cards)
      } catch {
        if (!controller.signal.aborted) setError('Could not connect to load the shared cards. Please try again.')
      } finally {
        if (!controller.signal.aborted) { window.clearTimeout(timeout); setLoading(false) }
      }
    }
    controller.signal.addEventListener('abort', () => {
      if (controller.signal.reason === 'timeout') { setError('Loading shared cards timed out. Please try again.'); setLoading(false) }
    })
    void load()
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [session, columns.length, attempt])

  function renderCard(card: Card, rank?: number) {
    const vote = voteMap.get(card.id)
    const selected = vote?.selected ?? false
    const atLimit = snapshot?.remainingVotes === 0 && !selected
    const disabled = phase !== 'revealed' || !available || !snapshot || !!voting.error || voting.blocked ||
      voting.pendingCard !== null || voting.awaitingSync || atLimit
    return <li key={card.id} className={styles.card}>
      {rank !== undefined && <p className={styles.topicLabel}>Topic {rank} · {columns[card.columnIndex]}</p>}
      <p id={`shared-card-${card.id}`} className={styles.cardText}>{card.text}</p>
      <div className={styles.voteActions}>
        <span className={styles.voteTotal}>{vote ? `${vote.total} ${vote.total === 1 ? 'vote' : 'votes'}` : 'Votes unavailable'}</span>
        {session.role === 'participant' && <button type="button" className={selected ? styles.selectedVote : styles.secondary}
          aria-label={phase === 'closed' ? (selected ? 'You voted for this card' : 'Voting closed for this card') : selected ? 'Remove your vote' : 'Vote for this card'} aria-pressed={selected}
          aria-describedby={`shared-card-${card.id}`} disabled={disabled}
          onClick={() => void voting.changeVote(card.id)}>
          {phase === 'closed' ? (selected ? 'Voted' : 'Voting closed') : voting.pendingCard === card.id ? 'Updating vote…' : selected ? 'Voted · Remove' : 'Vote'}
        </button>}
      </div>
    </li>
  }

  return <section aria-label="Shared retrospective">
    <div className={styles.boardIntro}>
      <h2>Everyone’s thoughts, together</h2>
      <p>Cards are revealed without author labels. Writing has ended; cards can no longer be added, edited, or deleted.</p>
      {phase === 'closed' ? <p className={styles.notice}>Voting is closed. Final totals are read-only.</p> :
        <p className={styles.hint}>Vote for the topics you want to discuss, then switch to “Most voted” to prioritize the conversation.</p>}
      {session.role === 'participant' && snapshot && <p role="status" className={styles.voteBudget}>
        {snapshot.remainingVotes} of {snapshot.voteLimit} votes {phase === 'closed' ? 'unused at closure' : 'remaining'}
      </p>}
      {session.role === 'participant' ? <p className={styles.hint}>{phase === 'closed' ? 'Your final selections are visible only to you and can no longer be changed.' : 'At most one vote per card. Remove one of your votes to use it elsewhere. Your selections are visible only to you.'}</p> :
        <p className={styles.hint}>You see totals only. Use the participant link separately if you would like to vote.</p>}
      <div className={styles.cardActions}>
        <button type="button" className={styles.secondary} disabled={loading || voting.pendingCard !== null}
          onClick={() => setAttempt((value) => value + 1)}>Refresh shared cards</button>
        <button type="button" className={styles.secondary} disabled={loading || voting.loading || voting.pendingCard !== null}
          onClick={voting.refresh}>Refresh votes</button>
      </div>
      {loading && <p role="status">Loading shared cards…</p>}
      {!loading && voting.loading && <p role="status">Loading vote totals…</p>}
      {voting.awaitingSync && <p role="status">Checking the latest votes…</p>}
      {voting.message && <p role="status">{voting.message}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {voting.error && <p role="alert" className={styles.error}>{voting.error}</p>}
      {voting.actionError && <p role="alert" className={styles.error}>{voting.actionError}</p>}
      {!loading && !error && <div className={styles.viewControls} role="group" aria-label="Board view">
        <button className={styles.secondary} aria-pressed={view === 'columns'} onClick={() => setView('columns')}>By column</button>
        <button className={styles.secondary} aria-pressed={view === 'discussion'} disabled={!snapshot}
          onClick={() => setView('discussion')}>Most voted</button>
      </div>}
    </div>
    {!loading && !error && (view === 'discussion' ? <section className={styles.discussion} aria-label="Prioritized discussion">
      <h2>Most-voted topics</h2>
      {cards.length === 0 && <p>No cards to discuss.</p>}
      <ol className={styles.discussionList} aria-label="Most-voted cards">
        {discussionOrder(cards, snapshot?.votes ?? []).map((card, index) => renderCard(card, index + 1))}
      </ol>
    </section> : <section className={styles.board} aria-label="Revealed retrospective columns">
      {columns.map((name, index) => <section key={index} className={styles.boardColumn} aria-labelledby={`shared-column-${index}`}>
        <h2 id={`shared-column-${index}`}>{name}</h2>
        {cards.filter((card) => card.columnIndex === index).length === 0 && <p className={styles.hint}>No cards in this column.</p>}
        <ul className={styles.cardList} aria-label={`Revealed cards in column ${index + 1}`}>
          {cards.filter((card) => card.columnIndex === index).map((card) => renderCard(card))}
        </ul>
      </section>)}
    </section>)}
  </section>
}
