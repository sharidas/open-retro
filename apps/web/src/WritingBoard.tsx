import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RoomSession } from './session'
import styles from './App.module.css'

type Card = { id: string; columnIndex: number; text: string }
function isCard(value: unknown, columnCount: number): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return typeof card.id === 'string' && /^[0-9a-f-]{36}$/.test(card.id) &&
    typeof card.columnIndex === 'number' && Number.isInteger(card.columnIndex) &&
    card.columnIndex >= 0 && card.columnIndex < columnCount && typeof card.text === 'string'
}

export function WritingBoard({ session, columns, phase }: {
  session: RoomSession; columns: string[]; phase: 'writing' | 'revealed' | 'closed'
}) {
  const [cards, setCards] = useState<Card[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState<number | null>(null)
  const [locked, setLocked] = useState(phase !== 'writing')
  const [notice, setNotice] = useState('')
  const busy = useRef(false)
  const submitController = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; submitController.current?.abort() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000)
    setLoading(true)
    setLoadError('')
    async function load() {
      try {
        const response = await fetch(`/api/rooms/${session.id}/cards`, {
          headers: { Authorization: `Bearer ${session.credential}` },
          cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) setLocked(true)
          setLoadError(response.status === 401 ? 'Your room session was not accepted. Reopen the participant link.' :
            response.status === 404 ? 'This room is unavailable. It may have expired or been deleted.' :
            'Could not load your saved cards. Try refreshing them.')
          return
        }
        const data = await response.json()
        if (!Array.isArray(data?.cards) || !data.cards.every((card: unknown) => isCard(card, columns.length))) {
          throw new Error('Invalid cards response')
        }
        if (!controller.signal.aborted) setCards(data.cards)
      } catch {
        if (!controller.signal.aborted) setLoadError('Could not connect to load your cards. Your drafts are still here; try refreshing your cards.')
      } finally {
        if (!controller.signal.aborted) { window.clearTimeout(timeout); setLoading(false) }
      }
    }
    controller.signal.addEventListener('abort', () => {
      if (controller.signal.reason === 'timeout') {
        setLoadError('Loading your cards timed out. Try refreshing them.')
        setLoading(false)
      }
    })
    void load()
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [session, columns.length, attempt])

  async function submit(event: FormEvent, columnIndex: number) {
    event.preventDefault()
    if (busy.current || loading || locked || loadError) return
    const text = (drafts[columnIndex] ?? '').trim()
    if (!text || text.length > 2000) {
      setErrors((current) => ({ ...current, [columnIndex]: 'Write 1–2000 characters before saving.' }))
      document.getElementById(`draft-${columnIndex}`)?.focus()
      return
    }
    busy.current = true
    setPending(columnIndex)
    setNotice('')
    setErrors((current) => ({ ...current, [columnIndex]: '' }))
    const controller = new AbortController()
    submitController.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/cards`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnIndex, text }), signal: controller.signal,
      })
      if (!mounted.current) return
      if (!response.ok) {
        const message = response.status === 409 ? 'Writing is no longer available. Copy any unsent text before reloading the room.' :
          response.status === 401 ? 'Your session was not accepted. Copy any unsent text before reopening the participant link.' :
          response.status === 404 ? 'The room is unavailable. Copy any unsent text before leaving.' :
          response.status === 400 || response.status === 413 ? 'Check your card: use 1–2000 characters and an existing column.' :
          'The card could not be saved. Your draft is still here; try again in a moment.'
        if ([401, 404, 409].includes(response.status)) setLocked(true)
        setErrors((current) => ({ ...current, [columnIndex]: message }))
        return
      }
      const data = await response.json()
      if (!isCard(data?.card, columns.length) || data.card.columnIndex !== columnIndex) throw new Error('Invalid card response')
      if (!mounted.current) return
      const saved: Card = data.card
      setCards((current) => [...current.filter((card) => card.id !== saved.id), saved].sort((a, b) => a.id.localeCompare(b.id)))
      setDrafts((current) => ({ ...current, [columnIndex]: '' }))
      setNotice(`Card saved privately in ${columns[columnIndex]}.`)
      document.getElementById(`draft-${columnIndex}`)?.focus()
    } catch {
      if (mounted.current) setErrors((current) => ({ ...current,
        [columnIndex]: 'The connection was interrupted or timed out. Your card may have been saved. Refresh your saved cards before submitting again to avoid a duplicate.',
      }))
    } finally {
      window.clearTimeout(timeout)
      busy.current = false
      if (mounted.current) setPending(null)
    }
  }

  return <section aria-label="Private writing">
    <div className={styles.panel}>
      <h2>Your private writing space</h2>
      <p>Only you can see your saved cards during writing. Other participants and the facilitator cannot read them yet.</p>
      <p className={styles.hint}>Avoid passwords, secrets, personal data, or confidential company information.</p>
      <p className={styles.hint}>Unsent drafts stay only on this page and are lost when you reload or leave.</p>
      <button type="button" className={styles.secondary} disabled={loading || pending !== null} onClick={() => {
        if (!busy.current) setAttempt((value) => value + 1)
      }}>Refresh my cards</button>
      <p role="status">{loading ? 'Loading your saved cards…' : notice}</p>
      {loadError && <p className={styles.error} role="alert">{loadError}</p>}
      {locked && <p className={styles.notice}>Writing is unavailable. Your drafts remain below so you can copy them before leaving or reloading.</p>}
    </div>
    <section className={styles.board} aria-label="Retrospective columns">
      {columns.map((name, index) => <section key={index} className={styles.boardColumn} aria-labelledby={`column-heading-${index}`}>
        <h2 id={`column-heading-${index}`}>{name}</h2>
        {!loading && !loadError && <>
          {cards.filter((card) => card.columnIndex === index).length === 0 && <p className={styles.hint}>No saved cards here yet.</p>}
          <ul className={styles.cardList} aria-label={`Your cards in column ${index + 1}`}>
            {cards.filter((card) => card.columnIndex === index).map((card) => <li key={card.id} className={styles.card}>{card.text}</li>)}
          </ul>
        </>}
        <form onSubmit={(event) => void submit(event, index)} noValidate>
          <label className={styles.draftLabel} htmlFor={`draft-${index}`}>Your thought for column {index + 1}</label>
          <textarea id={`draft-${index}`} className={styles.draft} rows={4} maxLength={2000}
            value={drafts[index] ?? ''} disabled={pending !== null}
            aria-invalid={!!errors[index] || undefined}
            aria-describedby={`draft-hint-${index}${errors[index] ? ` draft-error-${index}` : ''}`}
            onChange={(event) => { setDrafts((current) => ({ ...current, [index]: event.target.value }));
              setErrors((current) => ({ ...current, [index]: '' })); setNotice('') }} />
          <p id={`draft-hint-${index}`} className={styles.hint}>{(drafts[index] ?? '').length}/2000 characters</p>
          {errors[index] && <p id={`draft-error-${index}`} className={styles.error} role="alert">{errors[index]}</p>}
          <button type="submit" className={styles.primary} disabled={pending !== null || loading || locked || !!loadError}>
            {pending === index ? 'Saving…' : `Save card in column ${index + 1}`}
          </button>
        </form>
      </section>)}
    </section>
  </section>
}
