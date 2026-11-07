import { useEffect, useState } from 'react'
import type { RoomSession } from './session'
import { useWritingProgress } from './useWritingProgress'
import { formatTime, remainingTime } from './writingProgress'
import styles from './App.module.css'

export function WritingProgress({ session, available, hasUnsentWriting, onRoomRefresh }: {
  session: RoomSession; available: boolean; hasUnsentWriting: boolean; onRoomRefresh: () => void
}) {
  const progress = useWritingProgress(session, available, onRoomRefresh)
  const [minutes, setMinutes] = useState(5)
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (progress.snapshot?.timer.status !== 'running') return
    const interval = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(interval)
  }, [progress.snapshot?.timer.status])
  const data = progress.snapshot
  const remaining = data ? remainingTime(data, Math.max(0, now - progress.receivedAt)) : 0
  const expired = data?.timer.status === 'running' && remaining === 0
  const durationValid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 60
  return <section className={styles.writingProgress} aria-label="Writing timer and readiness">
    <div className={styles.timerSummary}>
      <span className={styles.eyebrow}>WRITING TIME</span>
      <span className={styles.clock} role="timer" aria-label="Time remaining">{!data ? '—' : data.timer.status === 'idle' ? 'Not started' : formatTime(remaining)}</span>
      <span className={styles.hint}>{data?.timer.status === 'paused' ? 'Paused' : expired ? 'Time is up' : data?.timer.status === 'running' ? 'Running' : 'Facilitator controls the timer'}</span>
    </div>
    {expired && <p role="status" className={styles.notice}>{session.role === 'facilitator' ? 'Time is up. Check readiness, extend the timer, or reveal when the team is ready.' : 'Time is up. You can keep writing until the facilitator reveals the board.'}</p>}
    {session.role === 'facilitator' ? <>
      <div className={styles.timerControls}>
        <label>Minutes<input type="number" min={1} max={60} step={1} value={Number.isNaN(minutes) ? '' : minutes} disabled={progress.disabled} onChange={event => setMinutes(event.target.valueAsNumber)} /></label>
        {(!data || data.timer.status === 'idle' || expired) && <button className={styles.primary} disabled={progress.disabled || !durationValid} onClick={() => void progress.save({ action: 'start', seconds: minutes * 60 })}>{expired ? 'Restart timer' : 'Start timer'}</button>}
        {data?.timer.status === 'running' && !expired && <button className={styles.secondary} disabled={progress.disabled} onClick={() => void progress.save({ action: 'pause' })}>Pause timer</button>}
        {data?.timer.status === 'paused' && <button className={styles.primary} disabled={progress.disabled} onClick={() => void progress.save({ action: 'resume' })}>Resume timer</button>}
        {data && data.timer.status !== 'idle' && <button className={styles.secondary} disabled={progress.disabled || !durationValid || remaining + minutes * 60000 > 3600000} onClick={() => void progress.save({ action: 'extend', seconds: minutes * 60 })}>Add minutes</button>}
      </div>
      <p className={styles.readiness} role="status">{data ? `${data.readyCount} of ${data.joinedCount} joined participants ready` : 'Loading readiness…'}</p>
      <p className={styles.hint}>Only you see this anonymous count. It counts joined browser sessions, including people who have left. Up to 60 minutes can remain on the timer.</p>
    </> : <>
      <button className={data?.ownReady ? styles.secondary : styles.primary} disabled={progress.disabled || (!data?.ownReady && hasUnsentWriting)}
        onClick={() => void progress.save({ ready: !data?.ownReady })}>{data?.ownReady ? 'I’m still writing' : 'I’m finished writing'}</button>
      <p className={styles.hint}>{data?.ownReady ? 'You are marked ready. You can still edit; choose “I’m still writing” if you need more time.' : hasUnsentWriting ? 'Save or clear your unsent writing before marking yourself finished.' : 'Your choice contributes only to the facilitator’s anonymous count. You can undo it.'}</p>
    </>}
    {progress.pending && <p role="status">Saving…</p>}
    {progress.message && <p role="status">{progress.message}</p>}
    {progress.error && <p role="alert" className={styles.error}>{progress.error}</p>}
    {progress.error && <button className={styles.secondary} disabled={progress.pending} onClick={progress.refresh}>Refresh writing status</button>}
  </section>
}
