import { useRef, useState } from 'react'
import styles from './App.module.css'

export function CopyLink({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setMessage('Copied.')
    } catch {
      input.current?.focus()
      input.current?.select()
      setMessage('Copy unavailable. The link is selected; copy it manually.')
    }
  }
  return <div className={styles.linkGroup}>
    <label>{label}<input ref={input} readOnly value={value} spellCheck={false} onFocus={(event) => event.target.select()} /></label>
    <button type="button" className={styles.secondary} onClick={() => void copy()}>Copy {label.toLowerCase()}</button>
    <span className={styles.copyStatus} role="status">{message}</span>
  </div>
}

