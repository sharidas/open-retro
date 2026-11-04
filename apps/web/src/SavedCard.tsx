import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isCard, type Card } from './card'
import type { RoomSession } from './session'
import styles from './App.module.css'

type Props = {
  card: Card; session: RoomSession; columnCount: number; disabled: boolean; ended?: boolean;
  onActive: (active: boolean) => void; onBusy: (busy: boolean) => void;
  onAccessLost: () => void; onUpdated: (card: Card) => void; onDeleted: () => void;
}
export function SavedCard({ card, session, columnCount, disabled, ended = false, onActive, onBusy, onAccessLost, onUpdated, onDeleted }: Props) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [text, setText] = useState(card.text)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const editor = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => { if (mode === 'edit') editor.current?.focus() }, [mode])

  function start(next: 'edit' | 'delete') {
    if (disabled) return
    setText(card.text)
    setError('')
    setMode(next)
    onActive(true)
  }
  function cancel() {
    if (busy.current) return
    setMode('view'); setText(card.text); setError(''); onActive(false)
  }
  async function change(event?: FormEvent) {
    event?.preventDefault()
    if (busy.current || disabled) return
    const updatedText = text.trim()
    if (mode === 'edit' && (!updatedText || updatedText.length > 2000)) {
      setError('Write 1–2000 characters before saving changes.')
      editor.current?.focus()
      return
    }
    busy.current = true
    setPending(true); setError(''); onBusy(true)
    const abort = new AbortController()
    controller.current = abort
    const timeout = window.setTimeout(() => abort.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/cards/${card.id}`, {
        method: mode === 'edit' ? 'PATCH' : 'DELETE',
        headers: { Authorization: `Bearer ${session.credential}`, ...(mode === 'edit' ? { 'Content-Type': 'application/json' } : {}) },
        ...(mode === 'edit' ? { body: JSON.stringify({ text: updatedText }) } : {}),
        signal: abort.signal,
      })
      if (!mounted.current) return
      if (!response.ok) {
        if (response.status === 401 || response.status === 409) onAccessLost()
        setError(response.status === 409 ? 'Writing has ended. Your unsaved changes remain here to copy.' :
          response.status === 401 ? 'Your session was not accepted. Copy unsaved changes before reopening the room.' :
          response.status === 404 ? 'This card is unavailable or the room changed. Cancel and refresh your cards before retrying.' :
          response.status === 400 || response.status === 413 ? 'Use 1–2000 characters for the card text.' :
          'The change could not be completed. Your unsaved changes are still here.')
        return
      }
      if (mode === 'edit') {
        const data = await response.json()
        if (!isCard(data?.card, columnCount) || data.card.id !== card.id || data.card.columnIndex !== card.columnIndex) {
          throw new Error('Invalid card response')
        }
        if (!mounted.current) return
        onUpdated(data.card)
      } else {
        if (response.status !== 204) throw new Error('Invalid delete response')
        onDeleted()
      }
      setMode('view'); onActive(false)
    } catch {
      if (mounted.current) setError('The connection was interrupted or timed out. The change may have succeeded. Copy unsaved edits, then cancel and refresh your cards to check before retrying.')
    } finally {
      window.clearTimeout(timeout)
      busy.current = false
      // Release board controls even when successful deletion unmounts this card.
      onBusy(false)
      if (mounted.current) setPending(false)
    }
  }

  if (ended && mode === 'view') return null
  return <>
    {mode === 'edit' ? <form onSubmit={(event) => void change(event)} noValidate>
      <label className={styles.draftLabel} htmlFor={`edit-${card.id}`}>Edit card text</label>
      <textarea ref={editor} id={`edit-${card.id}`} className={styles.draft} rows={4} maxLength={2000}
        value={text} disabled={pending} aria-invalid={!!error || undefined}
        aria-describedby={`edit-hint-${card.id}${error ? ` card-error-${card.id}` : ''}`}
        onChange={(event) => { setText(event.target.value); setError('') }} />
      <p id={`edit-hint-${card.id}`} className={styles.hint}>{text.length}/2000 characters · Unsaved edits stay only on this page.</p>
      <div className={styles.cardActions}>
        <button className={styles.secondary} disabled={disabled || pending}>{pending ? 'Saving changes…' : 'Save changes'}</button>
        <button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Cancel edit</button>
      </div>
    </form> : <p className={styles.cardText}>{card.text}</p>}
    {mode === 'view' && <div className={styles.cardActions}>
      <button type="button" className={styles.secondary} disabled={disabled} onClick={() => start('edit')}>Edit card</button>
      <button type="button" className={styles.secondary} disabled={disabled} onClick={() => start('delete')}>Delete card</button>
    </div>}
    {mode === 'delete' && <div>
      <p>Delete this card? This cannot be undone.</p>
      <div className={styles.cardActions}>
        <button type="button" className={styles.secondary} disabled={disabled || pending} onClick={() => void change()}>{pending ? 'Deleting…' : 'Confirm delete'}</button>
        <button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Keep card</button>
      </div>
    </div>}
    {pending && <p role="status">{mode === 'edit' ? 'Saving your changes…' : 'Deleting your card…'}</p>}
    {error && <p id={`card-error-${card.id}`} role="alert" className={styles.error}>{error}</p>}
  </>
}
