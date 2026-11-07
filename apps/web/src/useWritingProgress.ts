import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { parseWritingProgress, type WritingProgress } from './writingProgress'
export type ProgressChange = { ready: boolean } | { action: 'start' | 'pause' | 'resume' | 'extend'; seconds?: number }
export function useWritingProgress(session: RoomSession, available: boolean, onRoomRefresh: () => void) {
  const [snapshot, setSnapshot] = useState<WritingProgress | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0)
  const mutation = useRef<AbortController | null>(null)
  const [receivedAt, setReceivedAt] = useState(0)
  const path = `/api/rooms/${session.id}/${session.role === 'facilitator' ? 'facilitator/' : ''}writing-progress`
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort() } }, [])
  useEffect(() => {
    let disposed = false, active = false, stopped = false, failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    async function read() {
      if (disposed || active || stopped || busy.current) return
      active = true
      const version = generation.current
      request = new AbortController()
      const controller = request
      const deadline = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(path, { headers: { Authorization: `Bearer ${session.credential}` }, cache: 'no-store', signal: controller.signal })
        if (disposed || version !== generation.current) return
        if (!response.ok) {
          stopped = [401, 404, 409].includes(response.status)
          if (stopped) onRoomRefresh()
          throw new Error('Read failed')
        }
        const data = parseWritingProgress(await response.json(), session.role === 'participant')
        if (disposed || version !== generation.current) return
        setSnapshot(data); setReceivedAt(performance.now()); setReady(true); setError(''); failures = 0
      } catch {
        if (!disposed && version === generation.current) { setReady(false); setError('Writing updates are interrupted. The displayed timer may be out of date; controls are paused until updates resume.'); failures++ }
      } finally {
        clearTimeout(deadline); active = false
        if (!disposed && !stopped && !document.hidden) timer = setTimeout(() => void read(), Math.min(10_000 * 2 ** Math.min(failures, 3), 60_000))
      }
    }
    function visible() { clearTimeout(timer); if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', visible); void read()
    return () => { disposed = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [path, session.credential, session.role, attempt, onRoomRefresh])
  async function save(change: ProgressChange) {
    if (!snapshot || !ready || busy.current || !available) return false
    if (('ready' in change) !== (session.role === 'participant')) return false
    busy.current = true; generation.current++; setPending(true); setReady(false); setMessage('')
    const controller = new AbortController(); mutation.current = controller
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/${session.role === 'facilitator' ? 'facilitator/timer' : 'ready'}`, { method: 'PUT', headers: { Authorization: `Bearer ${session.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify('ready' in change ? change : { ...change, version: snapshot.timer.version }), signal: controller.signal })
      if (!mounted.current) return false
      if (!response.ok) {
        if ([401, 404, 409].includes(response.status)) onRoomRefresh()
        setMessage(response.status === 409 ? 'The timer or room changed. Review the latest state before trying again.' : 'Could not confirm the change. Checking current writing status before you try again.')
        return false
      }
      setMessage('Writing status saved.'); return true
    } catch {
      if (mounted.current) setMessage('The connection was interrupted. Your change may have saved; checking current writing status. It will not be replayed automatically.')
      return false
    } finally {
      clearTimeout(deadline); busy.current = false
      if (mounted.current) { setPending(false); setAttempt(value => value + 1) }
    }
  }
  return { snapshot, receivedAt, error, message, pending, disabled: !ready || pending || !available, save, refresh: () => setAttempt(value => value + 1) }
}
