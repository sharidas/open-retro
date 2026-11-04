import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { isRoom, type Room } from './useRoom'
import styles from './App.module.css'

export function RevealControl({ session, disabled, onRevealed, onRefresh }: {
  session: RoomSession; disabled: boolean; onRevealed: (room: Room) => void; onRefresh: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  async function reveal() {
    if (busy.current || disabled) return
    busy.current = true; setPending(true); setError('')
    const abort = new AbortController()
    controller.current = abort
    const deadline = window.setTimeout(() => abort.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/reveal`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.credential}` }, signal: abort.signal,
      })
      if (!mounted.current) return
      if (!response.ok) {
        setError(response.status === 409 ? 'The room changed. Checking its current phase…' :
          response.status === 401 || response.status === 404 ? 'Facilitator access or the room is unavailable. Checking room status…' :
          'Reveal could not be confirmed. Check room status before trying again.')
        onRefresh()
        return
      }
      const data = await response.json()
      if (!isRoom(data?.room, session.id) || data.room.state !== 'revealed') throw new Error('Invalid reveal response')
      if (mounted.current) onRevealed(data.room)
    } catch {
      if (mounted.current) { setError('The connection was interrupted. Reveal may have succeeded. Check room status before trying again.'); onRefresh() }
    } finally {
      window.clearTimeout(deadline); busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return <section className={styles.panel} aria-label="Facilitator controls">
    <h2>Ready to share?</h2>
    <p>Check that everyone has finished writing before revealing the cards.</p>
    {!confirming ? <button className={styles.primary} disabled={disabled} onClick={() => setConfirming(true)}>Reveal cards</button> : <>
      <p>Reveal all cards? This ends writing for everyone. Unsent drafts are not included. This cannot be reversed.</p>
      <div className={styles.cardActions}>
        <button className={styles.primary} disabled={pending || disabled} onClick={() => void reveal()}>{pending ? 'Revealing…' : 'Confirm reveal'}</button>
        <button className={styles.secondary} disabled={pending} onClick={() => { setConfirming(false); setError('') }}>Keep writing</button>
      </div>
    </>}
    {pending && <p role="status">Revealing the room…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}
