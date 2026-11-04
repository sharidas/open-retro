import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import styles from './App.module.css'

function App() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    async function checkHealth() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Health request failed')
        const health: unknown = await response.json()
        if (typeof health !== 'object' || health === null ||
            !('status' in health) || health.status !== 'ok') {
          throw new Error('Unexpected health response')
        }
        if (!controller.signal.aborted) setStatus('ready')
      } catch {
        if (!controller.signal.aborted) setStatus('error')
      }
    }
    void checkHealth()
    return () => controller.abort()
  }, [attempt])

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>OPEN RETRO · EARLY DEVELOPMENT</p>
      <h1>A little reflection.<br />A better next sprint.</h1>
      <p className={styles.intro}>
        A private space for your team to share what went well,
        what could improve, and what to try next.
      </p>
      <section className={styles.panel} aria-label="Development status">
        <h2>The foundation is taking shape</h2>
        <p>Room creation, private cards, and voting are coming in small steps.</p>
        <p role="status">
          {status === 'loading' && 'Connecting to the server…'}
          {status === 'ready' && 'Connected — the server is ready.'}
          {status === 'error' && 'Could not reach the server. Try again in a moment.'}
        </p>
        {status === 'error' && (
          <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        )}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
