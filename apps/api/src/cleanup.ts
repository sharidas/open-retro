export const CLEANUP_INTERVAL_MS = 60_000

// Run once at startup, then one bounded batch per minute. Never overlap runs.
export function startCleanup(cleanup: () => Promise<number>, reportFailure = () => console.error('Room cleanup failed; will retry.')) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void>
  async function run() {
    try { await cleanup() } catch { reportFailure() }
    if (!stopped) timer = setTimeout(() => { active = run() }, CLEANUP_INTERVAL_MS)
  }
  active = run()
  return async () => { stopped = true; clearTimeout(timer); await active }
}
