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

  return <main className={`${styles.page} ${styles.workspace}`}>
    <header className={styles.roomHeader}>
      <div><a href="/" className={styles.eyebrow}>OPEN RETRO</a>
        <h1>A little reflection, together.</h1></div>
      <span className={styles.roleLabel}>{session.role === 'facilitator' ? 'Facilitator' : 'Anonymous participation'}</span>
    </header>
    {loading && <p role="status">Opening your room…</p>}
    {error && <div className={styles.roomAlert}><p role="alert" className={styles.error}>{error}</p>
      {!session.error && <button className={styles.secondary} onClick={refresh}>Check room status</button>}</div>}
    {session.storageWarning && <p className={styles.notice}>Session storage is unavailable. Facilitator access will be lost when you leave or reload; keep your original private link.</p>}
    {room && <>
      <section className={styles.roomToolbar} aria-label="Room toolbar">
        <p className={styles.phaseBadge} role="status"><span className={styles.phaseDot} />
          {room.state === 'writing' ? 'Private writing' : room.state === 'revealed' ? 'Vote & discuss' : 'Retro closed'}</p>
        <p className={styles.phaseHint}>{room.state === 'writing' ? 'Space for every perspective.' : room.state === 'revealed' ? 'Find the themes. Decide what comes next.' : 'Your final board, saved until expiry.'}</p>
        <details name="room-toolbar" className={styles.toolbarDetails}>
          <summary>Invite team</summary>
          <div className={styles.toolbarPopover}><CopyLink label="Participant link" value={participantLink} /></div>
        </details>
        <details name="room-toolbar" className={styles.toolbarDetails}>
          <summary>Room details</summary>
          <div className={styles.toolbarPopover}>
            <p className={styles.hint}>No names or accounts. Room expiry: {new Date(room.expiresAt).toLocaleString()} (your local time).</p>
            {session.role === 'participant' ? <p className={styles.hint}>This browser remembers your session for this room. Clearing site storage or changing browsers creates a separate participant.</p> :
              <p className={styles.hint}>Your private link was removed from the address bar. This tab remembers facilitator access; save the original link privately for future use. Use the participant link separately to contribute cards or votes.</p>}
          </div>
        </details>
      </section>
      {room.state === 'closed' && <p className={styles.notice}>This retrospective is closed. The final board is read-only.</p>}
    </>}
    {room?.state === 'revealed' && session.role === 'facilitator' &&
      <CloseControl session={session} disabled={!available} onClosed={acceptRoom} onRefresh={refresh} />}
    {room && room.state !== 'writing' && !terminal && <SharedBoard session={session} columns={room.columns}
      phase={room.state} available={available} onRoomRefresh={refresh} />}
    {room && session.role === 'participant' && (room.state === 'writing' || retainWriting) &&
      <div className={styles.writingRecovery} hidden={room.state !== 'writing' && !hasUnsentWriting}>
        <WritingBoard session={session} columns={room.columns} phase={room.state} available={available} onLocalWork={setHasUnsentWriting} />
      </div>}
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
