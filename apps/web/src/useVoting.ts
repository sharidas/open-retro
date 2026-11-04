import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomSession } from './session'
import { POLL_INTERVAL_MS } from './useRoom'
import { parseVoteChange, parseVoting, type VotingSnapshot } from './voting'

export function useVoting({ session, cardIds, phase, enabled, available, onRoomRefresh }: {
  session: RoomSession; cardIds: readonly string[]; phase: 'revealed' | 'closed';
  enabled: boolean; available: boolean; onRoomRefresh: () => void;
}) {
  const [snapshot, setSnapshot] = useState<VotingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingCard, setPendingCard] = useState<string | null>(null)
  const [awaitingSync, setAwaitingSync] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const current = useRef<VotingSnapshot | null>(null)
  const busy = useRef(false)
  const awaiting = useRef(false)
  const stop = useRef(false)
  const version = useRef(0)
  const mounted = useRef(true)
  const pollController = useRef<AbortController | null>(null)
  const mutationController = useRef<AbortController | null>(null)
  const idsKey = [...cardIds].sort().join('|')
  const refresh = useCallback(() => {
    stop.current = false; setBlocked(false); setAttempt((value) => value + 1)
  }, [])
  const apply = useCallback((next: VotingSnapshot) => {
    if (JSON.stringify(current.current) !== JSON.stringify(next)) { current.current = next; setSnapshot(next) }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; mutationController.current?.abort() }
  }, [])
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let active = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    stop.current = false
    function schedule(delay: number) {
      if (!disposed && !stop.current && phase === 'revealed' && !document.hidden) timer = setTimeout(() => void poll(), delay)
    }
    async function poll(initial = false) {
      if (disposed || stop.current || active || (!initial && document.hidden)) return
      if (busy.current) { schedule(POLL_INTERVAL_MS); return }
      active = true
      const started = version.current
      controller = new AbortController(); pollController.current = controller
      const request = controller
      deadline = setTimeout(() => request.abort('timeout'), 15_000)
      try {
        const prefix = session.role === 'facilitator' ? 'facilitator/' : ''
        const response = await fetch(`/api/rooms/${session.id}/${prefix}votes`, {
          headers: { Authorization: `Bearer ${session.credential}` }, cache: 'no-store', signal: request.signal,
        })
        if (disposed || started !== version.current) return
        if (!response.ok) {
          stop.current = [401, 404, 409].includes(response.status)
          if (stop.current) { setBlocked(true); onRoomRefresh() }
          throw new Error('Voting read failed')
        }
        const next = parseVoting(await response.json(), session.role, cardIds)
        if (disposed || started !== version.current) return
        apply(next); setError(''); failures = 0
        awaiting.current = false; setAwaitingSync(false)
      } catch {
        if (!disposed && started === version.current) {
          failures += 1
          setError(stop.current ? 'Voting data is unavailable. Check room status or reopen the correct link.' :
            'Vote totals could not refresh. Showing the last known totals; voting is paused. Retrying automatically.')
        }
      } finally {
        clearTimeout(deadline); active = false
        if (!disposed) { setLoading(false); schedule(Math.min(POLL_INTERVAL_MS * 2 ** Math.min(failures, 3), 60_000)) }
      }
    }
    function visibilityChanged() {
      clearTimeout(timer)
      if (!document.hidden && !active) void poll()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    void poll(true)
    return () => {
      disposed = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [session, idsKey, phase, enabled, attempt, apply, onRoomRefresh])

  async function changeVote(cardId: string) {
    const known = current.current?.votes.find((vote) => vote.cardId === cardId)
    if (session.role !== 'participant' || phase !== 'revealed' || !enabled || !available || busy.current ||
        awaiting.current || blocked || error || !known || !current.current) return
    if (!known.selected && current.current.remainingVotes === 0) {
      setActionError('No votes remaining. Remove one of your votes first.'); return
    }
    const selected = !known.selected
    busy.current = true; version.current += 1; pollController.current?.abort()
    setPendingCard(cardId); setActionError(''); setMessage('')
    const controller = new AbortController(); mutationController.current = controller
    const deadline = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`/api/rooms/${session.id}/cards/${cardId}/vote`, {
        method: selected ? 'PUT' : 'DELETE', headers: { Authorization: `Bearer ${session.credential}` }, signal: controller.signal,
      })
      if (!mounted.current) return
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        if (response.status === 409 && data?.error === 'VOTE_BUDGET_EXCEEDED') {
          setActionError('Your votes are already used. Remove a vote first; checking your latest budget.')
        } else if ([401, 404, 409].includes(response.status)) {
          setBlocked(true); onRoomRefresh()
          setActionError('Voting or this card is no longer available. Checking room status.')
        } else setActionError('The vote could not be confirmed. Checking current votes before you try again.')
        return
      }
      const result = parseVoteChange(await response.json(), cardId, selected)
      if (!mounted.current) return
      const before = current.current!
      apply({ votes: before.votes.map((vote) => vote.cardId === cardId ? result.vote : vote),
        remainingVotes: result.remainingVotes, voteLimit: result.voteLimit })
      setMessage(selected ? 'Your vote was added.' : 'Your vote was removed.')
    } catch {
      if (mounted.current) setActionError('The connection was interrupted. Your vote may have changed. Checking current votes before you can vote again.')
    } finally {
      window.clearTimeout(deadline); busy.current = false
      if (mounted.current) {
        awaiting.current = true; setAwaitingSync(true); setPendingCard(null)
        // Always reconcile with a full snapshot, including changes from another tab.
        setAttempt((value) => value + 1)
      }
    }
  }

  return { snapshot, loading, error, actionError, message, pendingCard, awaitingSync, blocked, refresh, changeVote }
}
