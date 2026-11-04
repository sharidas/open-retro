import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import styles from './App.module.css'
import { CopyLink } from './CopyLink'
import { RoomPage } from './RoomPage'
import { roomSession } from './session'

type Column = { id: number; name: string }
type CreatedRoom = { participantLink: string; facilitatorLink: string; expiresAt: number }


function App() {
  const [columns, setColumns] = useState<Column[]>([
    { id: 1, name: 'Went well' }, { id: 2, name: 'Could improve' }, { id: 3, name: 'Ideas for next sprint' },
  ])
  const nextId = useRef(4)
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const [invalid, setInvalid] = useState<number[]>([])
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedRoom | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => { if (created) resultHeading.current?.focus() }, [created])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const blanks = columns.filter((column) => !column.name.trim()).map((column) => column.id)
    setInvalid(blanks)
    setError('')
    if (blanks.length) {
      document.getElementById(`column-${blanks[0]}`)?.focus()
      return
    }
    submitting.current = true
    setPending(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: columns.map((column) => column.name.trim()) }),
        signal: controller.signal,
      })
      if (!response.ok) {
        setError(response.status === 413 ? 'Column names are too long together. Shorten them and try again.' :
          response.status === 400 ? 'Check your column names: use one to five nonempty names.' :
          'The server could not create your room. Please try again in a moment.')
        return
      }
      const data = await response.json()
      if (typeof data?.room?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.room.id) ||
          typeof data.facilitatorSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.facilitatorSecret) ||
          typeof data.room.expiresAt !== 'number' || !Number.isFinite(data.room.expiresAt)) {
        throw new Error('Invalid creation response')
      }
      const participant = new URL(`/rooms/${data.room.id}`, window.location.origin)
      const facilitator = new URL(`/rooms/${data.room.id}/facilitator`, window.location.origin)
      // A fragment is not sent in HTTP requests. Never put the secret in a query string.
      facilitator.hash = new URLSearchParams({ secret: data.facilitatorSecret }).toString()
      setCreated({ participantLink: participant.href, facilitatorLink: facilitator.href, expiresAt: data.room.expiresAt })
    } catch {
      setError('The connection was interrupted or timed out. A room may have been created, but its links were not received. Trying again creates a new room.')
    } finally {
      window.clearTimeout(timeout)
      submitting.current = false
      setPending(false)
    }
  }

  if (roomSession) return <RoomPage session={roomSession} />
  return <main className={styles.page}>
    <header>
      <p className={styles.eyebrow}>OPEN RETRO</p>
      <h1>A little reflection.<br />A better next sprint.</h1>
      <p className={styles.intro}>A private space for your team to share what went well, what could improve, and what to try next.</p>
    </header>
    {created ? <section className={styles.panel} aria-labelledby="created-heading">
      <p className={styles.eyebrow}>ROOM CREATED</p>
      <h2 id="created-heading" ref={resultHeading} tabIndex={-1}>Your next conversation starts here.</h2>
      <p>Share the participant link with your team. Save the facilitator link privately before leaving this page.</p>
      <CopyLink label="Participant link" value={created.participantLink} />
      <div className={styles.private}>
        <p><strong>Keep the facilitator link private.</strong> Anyone with it has facilitator access to the room. We cannot recover it if you lose it.</p>
        <CopyLink label="Facilitator link" value={created.facilitatorLink} />
      </div>
      <p className={styles.hint}>Links are kept only on this page. Save them before refreshing. Room expiry: {new Date(created.expiresAt).toLocaleString()} (your local time).</p>
      <p className={styles.notice}>You can now open the room. Private cards, reveal controls, and voting are coming next.</p>
      <p><a href={created.participantLink}>Open participant room</a> · <a href={created.facilitatorLink}>Open facilitator room</a></p>
      <button type="button" className={styles.secondary} onClick={() => { setCreated(null); setError('') }}>Create another room</button>
    </section> : <section className={styles.panel} aria-labelledby="create-heading">
      <div className={styles.sectionHeader}><h2 id="create-heading">Make space for your sprint</h2><span className={styles.badge}>No accounts needed</span></div>
      <p>Choose the prompts your team will reflect on. Start with these suggestions or make them your own.</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <fieldset disabled={pending} className={styles.fieldset}>
          <legend>Retrospective columns</legend>
          <p id="columns-hint" className={styles.hint}>Choose 1–5 columns. Names and order are fixed after creation for this first version.</p>
          {columns.map((column, index) => <div key={column.id} className={styles.columnRow}>
            <div className={styles.field}>
              <label htmlFor={`column-${column.id}`}>Column {index + 1}</label>
              <input id={`column-${column.id}`} value={column.name} required
                aria-invalid={invalid.includes(column.id) || undefined}
                aria-describedby={invalid.includes(column.id) ? `error-${column.id}` : 'columns-hint'}
                onChange={(event) => {
                  setColumns((current) => current.map((item) => item.id === column.id ? { ...item, name: event.target.value } : item))
                  setInvalid((current) => current.filter((id) => id !== column.id))
                  setError('')
                }} />
              {invalid.includes(column.id) && <p id={`error-${column.id}`} className={styles.error} role="alert">Enter a column name.</p>}
            </div>
            <button type="button" className={styles.remove} disabled={columns.length === 1}
              aria-label={`Remove column ${index + 1}`} onClick={() => {
                setColumns((current) => current.filter((item) => item.id !== column.id))
                setInvalid((current) => current.filter((id) => id !== column.id))
                setError('')
              }}>Remove</button>
          </div>)}
          <div className={styles.columnActions}>
            <button type="button" className={styles.secondary} disabled={columns.length === 5} onClick={() => {
              const id = nextId.current++
              setColumns((current) => [...current, { id, name: '' }])
              window.requestAnimationFrame(() => document.getElementById(`column-${id}`)?.focus())
            }}>Add column</button>
            <span className={styles.hint} role="status">{columns.length} of 5 columns</span>
          </div>
          <p className={styles.hint}>Avoid passwords, secrets, personal data, or confidential company information.</p>
          <button type="submit" className={styles.primary}>{pending ? 'Creating room…' : 'Create retrospective'}</button>
        </fieldset>
        <div aria-live="polite">{pending && <p>Creating your room…</p>}</div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </form>
    </section>}
    <footer className={styles.footer}>Free and open source. Built for honest conversations.</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
