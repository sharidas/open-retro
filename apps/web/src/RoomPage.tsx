import { useEffect, useState } from 'react'
import type { RoomSession } from './session'
import { CopyLink } from './CopyLink'
import styles from './App.module.css'
import { WritingBoard } from './WritingBoard'
import { SharedBoard } from './SharedBoard'
import { CloseControl } from './CloseControl'
import { RevealControl } from './RevealControl'
import { useRoom } from './useRoom'

export function RoomPage({ session }: { session: RoomSession }) {
  const { room, error, loading, terminal, refresh, acceptRoom } = useRoom(session)
  const [retainWriting, setRetainWriting] = useState(false)
  const [hasUnsentWriting, setHasUnsentWriting] = useState(false)
  useEffect(() => { if (room?.state === 'writing') setRetainWriting(true) }, [room?.state])
  const participantLink = new URL(`/rooms/${session.id}`, location.origin).href
  const available = !error && !terminal

  return <main className={styles.page}>
    <header><a href="/" className={styles.eyebrow}>OPEN RETRO</a>
      <h1>{session.role === 'facilitator' ? 'Guide the conversation.' : 'Your sprint, together.'}</h1></header>
    <section className={styles.panel} aria-label="Room access">
      <p className={styles.eyebrow}>{session.role === 'facilitator' ? 'FACILITATOR VIEW' : 'ANONYMOUS PARTICIPANT'}</p>
      {loading && <p role="status">Opening your room…</p>}
      {error && <><p role="alert" className={styles.error}>{error}</p>
        {!session.error && <button className={styles.secondary} onClick={refresh}>Check room status</button>}</>}
      {room && <>
        <h2>{session.role === 'facilitator' ? 'Facilitator access confirmed' : 'You joined anonymously'}</h2>
        <p role="status">No names or accounts. Phase: <strong>{room.state}</strong>.</p>
        <p className={styles.hint}>Room expiry: {new Date(room.expiresAt).toLocaleString()} (your local time).</p>
        {session.role === 'participant' ? <p className={styles.hint}>This browser remembers your session for this room. Clearing site storage or changing browsers creates a separate participant.</p> :
          <p className={styles.hint}>Your private link was removed from the address bar. This tab remembers facilitator access; save the original link privately for future use.</p>}
        {session.storageWarning && <p className={styles.notice}>Session storage is unavailable. Facilitator access will be lost when you leave or reload; keep your original private link.</p>}
        <CopyLink label="Participant link" value={participantLink} />
        {room.state !== 'writing' ? <p className={styles.notice}>{room.state === 'closed' ? 'This retrospective is closed. The final board is read-only.' : 'Writing has ended. Vote on the revealed cards and discuss the most-voted topics.'}</p> : session.role === 'facilitator' ? <p className={styles.notice}>Cards stay private during writing, including from you. Open the participant link separately if you would like to contribute.</p> :
          <p className={styles.notice}>Write, edit, or delete your own cards below. The room will update when your facilitator reveals it.</p>}
      </>}
    </section>
    {room?.state === 'revealed' && session.role === 'facilitator' &&
      <CloseControl session={session} disabled={!available} onClosed={acceptRoom} onRefresh={refresh} />}
    {room && room.state !== 'writing' && !terminal && <SharedBoard session={session} columns={room.columns}
      phase={room.state} available={available} onRoomRefresh={refresh} />}
    {room && session.role === 'participant' && (room.state === 'writing' || retainWriting) &&
      <details className={styles.writingRecovery} open hidden={room.state !== 'writing' && !hasUnsentWriting}>
        <summary>{room.state === 'writing' ? 'Your private writing' : 'Your unsent writing — not shared'}</summary>
        <WritingBoard session={session} columns={room.columns} phase={room.state} available={available} onLocalWork={setHasUnsentWriting} />
      </details>}
    {room && room.state === 'writing' && session.role === 'facilitator' && <>
      <RevealControl session={session} disabled={!available} onRevealed={acceptRoom} onRefresh={refresh} />
      <section className={styles.board} aria-label="Retrospective columns">
        {room.columns.map((name, index) => <section key={index} className={styles.boardColumn} aria-label={`Column ${index + 1}: ${name}`}>
          <h2>{name}</h2><p className={styles.hint}>Participant cards stay hidden during writing.</p>
        </section>)}
      </section>
    </>}
  </main>
}
