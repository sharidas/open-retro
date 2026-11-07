import { useState, type ReactNode } from 'react'
import type { Card } from './card'
import type { RoomSession } from './session'
import { useGroups } from './useGroups'
import { moveCards } from './grouping'
import styles from './App.module.css'

export function GroupingBoard({ session, cards, columns, phase, available, onRoomRefresh, totals, renderCard }: {
  session: RoomSession; cards: Card[]; columns: string[]; phase: 'revealed' | 'closed'; available: boolean;
  onRoomRefresh: () => void; totals: Map<string, number> | null; renderCard: (card: Card, controls: ReactNode) => ReactNode
}) {
  const grouping = useGroups(session, cards.map(card => card.id), phase, available, onRoomRefresh)
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const groups = grouping.snapshot?.groups ?? []
  const members = new Set(groups.flatMap(group => group.cardIds))
  async function move(destination: string | null, create = false) {
    if (!selected.length || (create && !name.trim()) || (destination && !groups.some(group => group.id === destination))) return
    const next = moveCards(groups, selected, destination, create ? { id: crypto.randomUUID(), name: name.trim() } : undefined)
    if (await grouping.save(next)) { setSelected([]); if (create) setName('') }
  }
  function cardList(items: Card[]) {
    return <ul className={styles.cardList}>{items.map(card => renderCard(card, <div className={styles.groupCardLabel}>
      <span>{columns[card.columnIndex]}</span>
      {phase === 'revealed' && <label><input type="checkbox" disabled={grouping.disabled} checked={selected.includes(card.id)}
        aria-label={`Select card: ${card.text}`} onChange={event => setSelected(current => event.target.checked ? [...current, card.id] : current.filter(id => id !== card.id))} /> Select</label>}
    </div>))}</ul>
  }
  return <section aria-label="Collaborative card groups" className={styles.grouping}>
    <h2>Find the themes</h2>
    <p className={styles.hint}>{phase === 'closed' ? 'Grouping is closed. Final groups are read-only.' : 'Everyone can organise revealed cards. Select related thoughts from any column, then create a group or move them together.'}</p>
    {phase === 'revealed' && <fieldset className={styles.groupEditor} disabled={grouping.disabled}>
      <legend>{selected.length} {selected.length === 1 ? 'card' : 'cards'} selected</legend>
      <label>New group name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <button className={styles.primary} disabled={!selected.length || !name.trim() || groups.length >= 100} onClick={() => void move(null, true)}>Create group</button>
      <label>Move to group<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a group</option>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <button className={styles.secondary} disabled={!selected.length || !groups.some(group => group.id === target)} onClick={() => void move(target)}>Move selected</button>
      <button className={styles.secondary} disabled={!selected.length} onClick={() => void move(null)}>Ungroup selected</button>
      <button className={styles.secondary} disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button>
    </fieldset>}
    {grouping.pending && <p role="status">Saving grouping…</p>}
    {grouping.message && <p role="status">{grouping.message}</p>}
    {grouping.error && <p role="alert" className={styles.error}>{grouping.error}</p>}
    <button className={styles.secondary} disabled={grouping.pending} onClick={grouping.refresh}>Refresh groups</button>
    {!grouping.snapshot && !grouping.error && <p role="status">Loading groups…</p>}
    {grouping.snapshot && <div className={styles.groupGrid}>
      {groups.map(group => <section key={group.id} className={styles.cardGroup} aria-label={`Group: ${group.name}`}>
        <h3>{group.name}</h3>
        <p className={styles.hint}>{group.cardIds.length} {group.cardIds.length === 1 ? 'card' : 'cards'} · {totals ? `${group.cardIds.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0)} total votes (sum of card votes)` : 'Vote totals unavailable'}</p>
        {phase === 'revealed' && <div className={styles.cardActions}>
          <button className={styles.secondary} disabled={grouping.disabled} onClick={() => { setRenaming(group.id); setRename(group.name) }}>Rename group</button>
          <button className={styles.secondary} disabled={grouping.disabled} onClick={() => void grouping.save(groups.filter(item => item.id !== group.id))}>Ungroup all cards</button>
        </div>}
        {renaming === group.id && phase === 'revealed' && <form className={styles.renameGroup} onSubmit={event => { event.preventDefault(); if (rename.trim()) void grouping.save(groups.map(item => item.id === group.id ? { ...item, name: rename.trim() } : item)).then(saved => { if (saved) setRenaming(null) }) }}>
          <label>Group name<input value={rename} maxLength={80} disabled={grouping.disabled} onChange={event => setRename(event.target.value)} /></label>
          <button className={styles.secondary} disabled={grouping.disabled || !rename.trim()}>Save name</button>
          <button type="button" className={styles.secondary} onClick={() => setRenaming(null)}>Cancel rename</button>
        </form>}
        {cardList(cards.filter(card => group.cardIds.includes(card.id)))}
      </section>)}
      <section className={styles.cardGroup} aria-label="Ungrouped cards"><h3>Ungrouped</h3>
        {!cards.some(card => !members.has(card.id)) && <p className={styles.hint}>No ungrouped cards.</p>}
        {cardList(cards.filter(card => !members.has(card.id)))}
      </section>
    </div>}
  </section>
}
