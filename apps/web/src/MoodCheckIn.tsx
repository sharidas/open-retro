import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { isRoom, type Room } from './useRoom'
import styles from './App.module.css'

export const moods = [
  { id: 'drained', emoji: '😴', label: 'Drained' },
  { id: 'low', emoji: '🙁', label: 'Low' },
  { id: 'steady', emoji: '😐', label: 'Steady' },
  { id: 'good', emoji: '🙂', label: 'Good' },
  { id: 'energised', emoji: '🤩', label: 'Energised' },
] as const
export type MoodSnapshot = { checkIn: string; selected?: string | null; totals: { mood: string; total: number }[] | null }
export function parseMood(data: unknown, participant: boolean): MoodSnapshot {
  const value = data as MoodSnapshot
  if (!value || !['off', 'open', 'complete'].includes(value.checkIn) ||
      (participant && value.selected !== null && !moods.some(m => m.id === value.selected)) ||
      (value.checkIn !== 'complete' ? value.totals !== null :
        !Array.isArray(value.totals) || value.totals.length !== moods.length ||
        moods.some(m => value.totals!.filter(t => t.mood === m.id && Number.isSafeInteger(t.total) && t.total >= 0).length !== 1))) {
    throw new Error('Invalid mood snapshot')
  }
  return value
}
export function MoodCheckIn({ session, checkIn, available, onRoom, onRefresh }: {
  session: RoomSession; checkIn: 'open' | 'complete'; available: boolean;
  onRoom: (room: Room) => void; onRefresh: () => void
}) {
  const [snapshot, setSnapshot] = useState<MoodSnapshot | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false)
  const version = useRef(0)
  const mounted = useRef(true)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort() } }, [])
  useEffect(() => {
    let disposed = false, active = false, stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let failures = 0
    async function read() {
      if (disposed || active || stopped || busy.current) return
      active = true
      const started = version.current
      controller = new AbortController()
      const deadline = setTimeout(() => controller?.abort(), 15_000)
      try {
        const prefix = session.role === 'facilitator' ? 'facilitator/' : ''
        const response = await fetch(`/api/rooms/${session.id}/${prefix}mood`, { headers: { Authorization: `Bearer ${session.credential}` }, cache: 'no-store', signal: controller.signal })
        if (disposed || started !== version.current) return
        if (!response.ok) {
          stopped = [401, 404, 409].includes(response.status)
          if (stopped) onRefresh()
          throw new Error('Read failed')
        }
        const data = parseMood(await response.json(), session.role === 'participant')
        if (disposed || started !== version.current) return
        setSnapshot(data); setReady(true); setError(''); failures = 0
        if (data.checkIn !== checkIn) onRefresh()
      } catch {
        if (!disposed && started === version.current) { setReady(false); setError('Could not refresh the check-in. Check your connection and retry.'); failures++ }
      } finally {
        clearTimeout(deadline); active = false
        if (!disposed && !stopped && !document.hidden && (checkIn === 'open' || failures)) timer = setTimeout(() => void read(), Math.min(10_000 * 2 ** Math.min(failures, 3), 60_000))
      }
    }
    function visible() { clearTimeout(timer); if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', visible)
    void read()
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [session, checkIn, attempt, onRefresh])
  async function change(mood: string | null, start = false) {
    if (busy.current || !ready || !available || checkIn !== 'open' || snapshot?.checkIn !== 'open') return
    if (start !== (session.role === 'facilitator')) return
    busy.current = true; version.current++; setPending(true); setReady(false); setMessage('')
    const controller = new AbortController(); mutation.current = controller
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/${start ? 'start-writing' : 'mood'}`, {
        method: start ? 'POST' : 'PUT', headers: { Authorization: `Bearer ${session.credential}`, 'Content-Type': 'application/json' },
        ...(start ? {} : { body: JSON.stringify({ mood }) }), signal: controller.signal,
      })
      if (!mounted.current) return
      if (!response.ok) { onRefresh(); throw new Error('Mutation failed') }
      if (start) {
        const data = await response.json()
        if (!isRoom(data?.room, session.id) || data.room.checkIn !== 'complete') throw new Error('Invalid room')
        if (mounted.current) onRoom(data.room)
      } else setMessage(mood === null ? 'No answer shared. You can join in before writing starts.' : 'Your mood is saved privately. You can change it before writing starts.')
    } catch {
      if (mounted.current) { setMessage('The result could not be confirmed. Checking the latest state before you try again.'); onRefresh() }
    } finally {
      clearTimeout(deadline); busy.current = false
      if (mounted.current) { setPending(false); setAttempt(value => value + 1) }
    }
  }
  const open = checkIn === 'open' && snapshot?.checkIn === 'open'
  const disabled = pending || !ready || !available || !open
  const total = snapshot?.totals?.reduce((sum, entry) => sum + entry.total, 0) ?? 0
  return <section className={styles.moodPanel} aria-label="Team mood check-in">
    <p className={styles.eyebrow}>{checkIn === 'open' ? 'A MOMENT TO ARRIVE' : 'TEAM CHECK-IN'}</p>
    <h2>{checkIn === 'open' ? 'How are you arriving today?' : 'How the team arrived'}</h2>
    <p className={styles.hint}>{checkIn === 'open' ? 'An optional pulse check before we begin. Individual answers stay private; totals appear when writing starts.' : snapshot?.totals ? `${total} ${total === 1 ? 'response' : 'responses'}. A snapshot of how the team felt at the start.` : 'Loading mood results…'}</p>
    {session.role === 'participant' && checkIn === 'open' && <>
      <div className={styles.moodChoices}>{moods.map(mood => <button key={mood.id} type="button" disabled={disabled}
        aria-pressed={snapshot?.selected === mood.id} onClick={() => void change(mood.id)}>
        <span aria-hidden="true">{mood.emoji}</span>{mood.label}</button>)}</div>
      <button className={styles.scratchButton} disabled={disabled} onClick={() => void change(null)}>Skip or withdraw my answer</button>
      <p className={styles.hint}>Waiting for the facilitator to start writing. You do not need to answer.</p>
    </>}
    {snapshot?.totals && <ul className={styles.moodResults}>{moods.map(mood => <li key={mood.id}>
      <span aria-hidden="true">{mood.emoji}</span> {mood.label} <strong>{snapshot.totals!.find(item => item.mood === mood.id)?.total ?? 0}</strong>
    </li>)}</ul>}
    {session.role === 'facilitator' && checkIn === 'open' && <>
      <p className={styles.hint}>Give everyone a moment. Use the participant link separately to share your own mood.</p>
      {!confirming ? <button className={styles.primary} disabled={disabled} onClick={() => setConfirming(true)}>Start writing</button> : <div className={styles.cardActions}>
        <p>Start writing and reveal mood totals? Answers will be frozen. People may skip the check-in.</p>
        <button className={styles.primary} disabled={disabled} onClick={() => void change(null, true)}>Confirm start writing</button>
        <button className={styles.secondary} disabled={pending} onClick={() => setConfirming(false)}>Keep checking in</button>
      </div>}
    </>}
    {pending && <p role="status">Saving…</p>}
    {message && checkIn === 'open' && <p role="status">{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button className={styles.secondary} onClick={() => setAttempt(value => value + 1)}>Refresh check-in</button>}
  </section>
}
