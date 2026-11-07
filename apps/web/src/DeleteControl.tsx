import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import styles from './App.module.css'

export function DeleteControl({ session, disabled, onDeleted, onRefresh }: {
  session: RoomSession; disabled: boolean; onDeleted: () => void; onRefresh: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false), mounted = useRef(true)
  const request = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort() } }, [])
  async function remove() {
    if (disabled || busy.current || session.role !== 'facilitator') return
    busy.current = true; setPending(true); setError('')
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/facilitator`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${session.credential}` }, signal: controller.signal,
      })
      if (!mounted.current) return
      if (response.status !== 204) throw new Error('Deletion not confirmed')
      onDeleted()
    } catch {
      if (mounted.current) {
        setError('Deletion could not be confirmed. It may have succeeded. Check room status before trying again; deletion will not be retried automatically.')
        setConfirming(false); onRefresh()
      }
    } finally {
      clearTimeout(timeout); busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return <div className={styles.deleteControl}>
    {!confirming ? <button className={styles.secondary} disabled={disabled || pending} onClick={() => setConfirming(true)}>Delete room</button> : <>
      <p>Permanently delete this room for everyone? All stored cards, votes, moods, groups, timer and participant sessions will be removed. This cannot be undone.</p>
      <div className={styles.cardActions}>
        <button className={styles.secondary} disabled={disabled || pending} onClick={() => void remove()}>{pending ? 'Deleting…' : 'Permanently delete room'}</button>
        <button className={styles.secondary} disabled={pending} onClick={() => setConfirming(false)}>Keep room</button>
      </div>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
