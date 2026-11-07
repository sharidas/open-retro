import { isColumnColor } from './templates'
import { useCallback, useEffect, useState } from 'react'
import type { RoomSession } from './session'

export type Room = { id: string; columns: string[]; columnColors?: string[]; checkIn?: 'off' | 'open' | 'complete'; state: 'writing' | 'revealed' | 'closed'; expiresAt: number }
export const POLL_INTERVAL_MS = 10_000
const ranks = { writing: 0, revealed: 1, closed: 2 }
export function isRoom(value: unknown, id: string): value is Room {
  if (typeof value !== 'object' || value === null) return false
  const room = value as Record<string, unknown>
  return room.id === id && Array.isArray(room.columns) && room.columns.length >= 1 && room.columns.length <= 5 &&
    room.columns.every((name: unknown) => typeof name === 'string') &&
    (room.columnColors === undefined || (Array.isArray(room.columnColors) && room.columnColors.length === room.columns.length && room.columnColors.every(isColumnColor))) &&
    (room.checkIn === undefined || ['off', 'open', 'complete'].includes(String(room.checkIn))) &&
    (room.state === 'writing' || room.state === 'revealed' || room.state === 'closed') &&
    typeof room.expiresAt === 'number' && Number.isFinite(room.expiresAt)
}

export function useRoom(session: RoomSession, enabled = true) {
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState(session.error ?? '')
  const [loading, setLoading] = useState(!session.error)
  const [terminal, setTerminal] = useState(!!session.error)
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((value) => value + 1), [])
  const acceptRoom = useCallback((incoming: Room) => {
    setRoom((previous) => {
      // An in-flight writing response must not undo a confirmed reveal.
      if (previous?.checkIn === 'complete' && incoming.checkIn === 'open') return previous
      if (previous && ranks[incoming.state] < ranks[previous.state]) return previous
      if (previous && JSON.stringify(previous) === JSON.stringify(incoming)) return previous
      return incoming
    })
  }, [])

  useEffect(() => {
    if (!enabled || session.error || !session.credential) return
    let disposed = false
    let stopped = false
    let active = false
    let failures = 0
    let mayJoin = true
    let resumePending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    setTerminal(false)

    function schedule(delay: number) {
      if (!disposed && !stopped && !document.hidden) timer = setTimeout(() => void poll(), delay)
    }
    async function poll(initial = false) {
      if (disposed || stopped || (document.hidden && !initial) || active) return
      active = true
      controller = new AbortController()
      const request = controller
      deadline = setTimeout(() => request.abort('timeout'), 15_000)
      try {
        const headers = { Authorization: `Bearer ${session.credential}` }
        const base = `/api/rooms/${session.id}`
        let response = await fetch(session.role === 'facilitator' ? `${base}/facilitator` : base,
          { headers, signal: request.signal, cache: 'no-store' })
        if (disposed) return
        if (session.role === 'participant' && response.status === 401 && mayJoin) {
          response = await fetch(`${base}/join`, { method: 'POST', headers, signal: request.signal, cache: 'no-store' })
        }
        mayJoin = false
        if (disposed) return
        if (!response.ok) {
          stopped = [401, 404, 409].includes(response.status)
          setTerminal(stopped)
          failures += 1
          setError(response.status === 401 ? 'Your room access was not accepted. Reopen the correct room link.' :
            response.status === 404 ? 'This room is unavailable. It may have expired or been deleted.' :
            response.status === 409 ? 'This room is closed to new participants.' :
            'Room updates are interrupted. Showing the last known state; saving is paused. We will retry automatically.')
          return
        }
        const data = await response.json()
        if (!isRoom(data?.room, session.id)) throw new Error('Invalid room response')
        if (disposed) return
        if (data.room.expiresAt <= Date.now()) {
          stopped = true; setTerminal(true); setError('This room has expired. Copy unsent text before leaving.')
          return
        }
        failures = 0
        acceptRoom(data.room)
        setError(''); setTerminal(false)
      } catch {
        if (!disposed) {
          failures += 1
          setError('Room updates are interrupted. Showing the last known state; saving is paused. We will retry automatically.')
        }
      } finally {
        clearTimeout(deadline)
        active = false
        if (!disposed) {
          setLoading(false)
          const delay = resumePending ? 0 : Math.min(POLL_INTERVAL_MS * 2 ** Math.min(failures, 3), 60_000)
          resumePending = false
          schedule(delay)
        }
      }
    }
    function visibilityChanged() {
      clearTimeout(timer)
      if (!document.hidden) {
        if (active) resumePending = true
        else void poll()
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    // Load a room opened in the background once, then pause recurring checks.
    void poll(true)
    return () => {
      disposed = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [session, attempt, acceptRoom, enabled])

  return { room, error, loading, terminal, refresh, acceptRoom }
}
