export type Timer = { version: number; status: 'idle' | 'running' | 'paused'; endsAt: number | null; remainingMs: number }
export type WritingProgress = { serverNow: number; timer: Timer; ownReady?: boolean; joinedCount?: number; readyCount?: number }
export function parseWritingProgress(value: unknown, participant: boolean): WritingProgress {
  const data = value as WritingProgress, timer = data?.timer
  if (!data || !Number.isSafeInteger(data.serverNow) || !timer || !Number.isSafeInteger(timer.version) || timer.version < 0 ||
      !['idle', 'running', 'paused'].includes(timer.status) || !Number.isSafeInteger(timer.remainingMs) || timer.remainingMs < 0 || timer.remainingMs > 3600000 ||
      (timer.status === 'running' ? !Number.isSafeInteger(timer.endsAt) || timer.remainingMs !== 0 : timer.endsAt !== null) ||
      (timer.status === 'idle' && timer.remainingMs !== 0)) throw new Error('Invalid timer')
  if (participant ? typeof data.ownReady !== 'boolean' || 'readyCount' in data || 'joinedCount' in data :
    !Number.isSafeInteger(data.readyCount) || !Number.isSafeInteger(data.joinedCount) || data.readyCount! < 0 || data.joinedCount! < data.readyCount! || 'ownReady' in data) throw new Error('Invalid readiness')
  return data
}
export function remainingTime(data: WritingProgress, elapsedMs: number): number {
  return data.timer.status === 'running' ? Math.max(0, data.timer.endsAt! - data.serverNow - Math.max(0, elapsedMs)) : data.timer.remainingMs
}
export function formatTime(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
