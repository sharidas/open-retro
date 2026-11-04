import { useEffect, useState } from 'react'
import { isCard, type Card } from './card'
import type { RoomSession } from './session'
import styles from './App.module.css'

export function SharedBoard({ session, columns }: { session: RoomSession; columns: string[] }) {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
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
            response.status === 409 ? 'Cards have not been revealed yet. Reload the room to check its phase.' :
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

  return <section aria-label="Shared retrospective">
    <div className={styles.panel}>
      <h2>Everyone’s thoughts, together</h2>
      <p>Cards are revealed without author labels. Writing has ended; cards can no longer be added, edited, or deleted.</p>
      <button className={styles.secondary} disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Refresh shared cards</button>
      {loading && <p role="status">Loading shared cards…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
    {!loading && !error && <section className={styles.board} aria-label="Revealed retrospective columns">
      {columns.map((name, index) => <section key={index} className={styles.boardColumn} aria-labelledby={`shared-column-${index}`}>
        <h2 id={`shared-column-${index}`}>{name}</h2>
        {cards.filter((card) => card.columnIndex === index).length === 0 && <p className={styles.hint}>No cards in this column.</p>}
        <ul className={styles.cardList} aria-label={`Revealed cards in column ${index + 1}`}>
          {cards.filter((card) => card.columnIndex === index).map((card) => <li key={card.id} className={styles.card}>{card.text}</li>)}
        </ul>
      </section>)}
    </section>}
  </section>
}
