import { useEffect, useState } from 'react'
import type { RoomSession } from './session'
import { CopyLink } from './CopyLink'
import styles from './App.module.css'
import { WritingBoard } from './WritingBoard'

type Room = { id: string; columns: string[]; state: 'writing' | 'revealed' | 'closed'; expiresAt: number }

export function RoomPage({ session }: { session: RoomSession }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState(session.error ?? '')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(!session.error)
  const participantLink = new URL(`/rooms/${session.id}`, location.origin).href

  useEffect(() => {
    if (session.error || !session.credential) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000)
    setLoading(true)
    setError('')
    async function load() {
      try {
        const headers = { Authorization: `Bearer ${session.credential}` }
        const base = `/api/rooms/${session.id}`
        let response = await fetch(session.role === 'facilitator' ? `${base}/facilitator` : base,
          { headers, signal: controller.signal, cache: 'no-store' })
        if (session.role === 'participant' && response.status === 401) {
          response = await fetch(`${base}/join`, { method: 'POST', headers, signal: controller.signal, cache: 'no-store' })
        }
        if (!response.ok) {
          setError(response.status === 404 ? 'This room is unavailable. It may have expired or been deleted.' :
            response.status === 409 ? 'This room is closed to new participants.' :
            response.status === 401 ? 'Access was not accepted. Check that you have the correct room link.' :
            'The server could not open this room. Please try again.')
          return
        }
        const data = await response.json()
        if (data?.room?.id !== session.id || !Array.isArray(data.room.columns) ||
            data.room.columns.length < 1 || data.room.columns.length > 5 ||
            !data.room.columns.every((name: unknown) => typeof name === 'string') ||
            !['writing', 'revealed', 'closed'].includes(data.room.state) ||
            typeof data.room.expiresAt !== 'number') throw new Error('Invalid room response')
        if (!controller.signal.aborted) setRoom(data.room)
      } catch {
        if (!controller.signal.aborted) setError('Could not connect to the room. Check your connection and try again.')
      } finally {
        if (!controller.signal.aborted) { window.clearTimeout(timeout); setLoading(false) }
      }
    }
    // Timeout reports failure, while effect cleanup silently aborts stale loads.
    controller.signal.addEventListener('abort', () => {
      if (controller.signal.reason === 'timeout') {
        setError('Opening the room timed out. Please try again.')
        setLoading(false)
      }
    })
    void load()
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [session, attempt])

  return <main className={styles.page}>
    <header><a href="/" className={styles.eyebrow}>OPEN RETRO</a>
      <h1>{session.role === 'facilitator' ? 'Guide the conversation.' : 'Your sprint, together.'}</h1></header>
    <section className={styles.panel} aria-label="Room access">
      <p className={styles.eyebrow}>{session.role === 'facilitator' ? 'FACILITATOR VIEW' : 'ANONYMOUS PARTICIPANT'}</p>
      {loading && <p role="status">Opening your room…</p>}
      {error && <><p role="alert" className={styles.error}>{error}</p>
        {!session.error && <button className={styles.secondary} onClick={() => setAttempt((value) => value + 1)}>Try again</button>}</>}
      {room && !loading && !error && <>
        <h2>{session.role === 'facilitator' ? 'Facilitator access confirmed' : 'You joined anonymously'}</h2>
        <p>No names or accounts. Phase: <strong>{room.state}</strong>.</p>
        <p className={styles.hint}>Room expiry: {new Date(room.expiresAt).toLocaleString()} (your local time).</p>
        {session.role === 'participant' ? <p className={styles.hint}>This browser remembers your session for this room. Clearing site storage or changing browsers creates a separate participant.</p> :
          <p className={styles.hint}>Your private link was removed from the address bar. This tab remembers facilitator access; save the original link privately for future use.</p>}
        {session.storageWarning && <p className={styles.notice}>Session storage is unavailable. Facilitator access will be lost when you leave or reload; keep your original private link.</p>}
        <CopyLink label="Participant link" value={participantLink} />
        {session.role === 'facilitator' ? <p className={styles.notice}>Cards stay private during writing, including from you. Open the participant link separately if you would like to contribute. Reveal controls and voting are coming next.</p> :
          <p className={styles.notice}>Save your thoughts privately below. Editing, reveal controls, and voting are coming next.</p>}
      </>}
    </section>
    {room && !loading && !error && session.role === 'participant' && <WritingBoard session={session} columns={room.columns} phase={room.state} />}
    {room && !loading && !error && session.role === 'facilitator' && <section className={styles.board} aria-label="Retrospective columns">
      {room.columns.map((name, index) => <section key={index} className={styles.boardColumn} aria-label={`Column ${index + 1}: ${name}`}>
        <h2>{name}</h2><p className={styles.hint}>Participant cards remain hidden until reveal is available.</p>
      </section>)}
    </section>}
  </main>
}
