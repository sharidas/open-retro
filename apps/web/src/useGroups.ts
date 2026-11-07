import { useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { parseGroups, type CardGroup, type GroupSnapshot } from './grouping'
export function useGroups(session: RoomSession, cardIds: string[], phase: 'revealed' | 'closed', available: boolean, onRoomRefresh: () => void) {
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0)
  const mutation = useRef<AbortController | null>(null)
  const cardKey = [...cardIds].sort().join('|')
  const path = `/api/rooms/${session.id}/${session.role === 'facilitator' ? 'facilitator/' : ''}groups`
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
        const data = parseGroups(await response.json(), cardIds)
        if (disposed || version !== generation.current) return
        setSnapshot(data); setReady(true); setError(''); failures = 0
      } catch {
        if (!disposed && version === generation.current) { setReady(false); setError('Grouping could not refresh. Changes are paused until the latest groups load.'); failures++ }
      } finally {
        clearTimeout(deadline); active = false
        if (!disposed && !stopped && !document.hidden && (phase === 'revealed' || failures)) timer = setTimeout(() => void read(), Math.min(10_000 * 2 ** Math.min(failures, 3), 60_000))
      }
    }
    function visible() { clearTimeout(timer); if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', visible); void read()
    return () => { disposed = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [path, session.credential, cardKey, phase, attempt, onRoomRefresh])
  async function save(groups: CardGroup[]) {
    if (!snapshot || !ready || busy.current || !available || phase !== 'revealed') return false
    try { parseGroups({ version: snapshot.version, groups }, cardIds) } catch { setMessage('Use groups of 1–200 cards, with names of 1–80 characters (maximum 100 groups).'); return false }
    busy.current = true; generation.current++; setPending(true); setReady(false); setMessage('')
    const controller = new AbortController(); mutation.current = controller
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(path, { method: 'PUT', headers: { Authorization: `Bearer ${session.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: snapshot.version, groups }), signal: controller.signal })
      if (!mounted.current) return false
      if (!response.ok) {
        if ([401, 404, 409].includes(response.status)) onRoomRefresh()
        setMessage(response.status === 409 ? 'The grouping or room changed. Review the latest board before trying again.' : 'Could not confirm the change. Checking current groups before you try again.')
        return false
      }
      setMessage('Grouping saved. Original cards and votes are unchanged.'); return true
    } catch {
      if (mounted.current) setMessage('The connection was interrupted. Your change may have saved; checking current groups. It will not be replayed automatically.')
      return false
    } finally {
      clearTimeout(deadline); busy.current = false
      if (mounted.current) { setPending(false); setAttempt(value => value + 1) }
    }
  }
  return { snapshot, error, message, pending, disabled: !ready || pending || !available || phase !== 'revealed', save, refresh: () => setAttempt(value => value + 1) }
}
