import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { isRoom, type Room } from './useRoom'
import styles from './App.module.css'

export function CloseControl({ session, disabled, onClosed, onRefresh }: {
  session: RoomSession; disabled: boolean; onClosed: (room: Room) => void; onRefresh: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  async function close() {
    if (busy.current || disabled) return
    busy.current = true; setPending(true); setError('')
    const abort = new AbortController()
    controller.current = abort
    const deadline = window.setTimeout(() => abort.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/close`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.credential}` }, signal: abort.signal,
      })
      if (!mounted.current) return
      if (!response.ok) {
        setError(response.status === 409 ? 'The room changed. Checking its current phase…' :
          response.status === 401 || response.status === 404 ? 'Facilitator access or the room is unavailable. Checking room status…' :
          'Closure could not be confirmed. Check room status before trying again.')
        onRefresh()
        return
      }
      const data = await response.json()
      if (!isRoom(data?.room, session.id) || data.room.state !== 'closed') throw new Error('Invalid close response')
      if (mounted.current) onClosed(data.room)
    } catch {
      if (mounted.current) { setError('The connection was interrupted. Closure may have succeeded. Check room status before trying again.'); onRefresh() }
    } finally {
      window.clearTimeout(deadline); busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return <section className={styles.facilitatorBar} aria-label="Facilitator controls">
    <h2>Finished discussing?</h2>
    <p>Close the retrospective when everyone has finished voting and discussing.</p>
    {!confirming ? <button className={styles.primary} disabled={disabled} onClick={() => setConfirming(true)}>Close room</button> : <>
      <p>Close this room? Voting will stop for everyone. Cards and final totals stay readable until expiry or deletion. This cannot be reversed.</p>
      <div className={styles.cardActions}>
        <button className={styles.primary} disabled={pending || disabled} onClick={() => void close()}>{pending ? 'Closing…' : 'Confirm close'}</button>
        <button className={styles.secondary} disabled={pending} onClick={() => { setConfirming(false); setError('') }}>Keep discussing</button>
      </div>
    </>}
    {pending && <p role="status">Closing the room…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}
