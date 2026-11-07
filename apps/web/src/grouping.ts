export type CardGroup = { id: string; name: string; cardIds: string[] }
export type GroupSnapshot = { version: number; groups: CardGroup[] }
export function parseGroups(value: unknown, cardIds: readonly string[]): GroupSnapshot {
  const data = value as GroupSnapshot
  if (!data || !Number.isSafeInteger(data.version) || data.version < 0 || !Array.isArray(data.groups) || data.groups.length > 100) throw new Error('Invalid grouping')
  const ids = new Set<string>(), members = new Set<string>(), allowed = new Set(cardIds)
  for (const group of data.groups) {
    if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 ||
        !Array.isArray(group.cardIds) || group.cardIds.length < 1 || group.cardIds.length > 200) throw new Error('Invalid group')
    ids.add(group.id)
    for (const cardId of group.cardIds) {
      if (!allowed.has(cardId) || members.has(cardId)) throw new Error('Invalid membership')
      members.add(cardId)
    }
  }
  return data
}
export function moveCards(groups: CardGroup[], cardIds: string[], target: string | null, newGroup?: { id: string; name: string }): CardGroup[] {
  const selected = new Set(cardIds)
  const next = groups.map(group => ({ ...group, cardIds: group.cardIds.filter(id => !selected.has(id)) }))
  if (newGroup) next.push({ ...newGroup, cardIds: [...cardIds] })
  else if (target) {
    const group = next.find(item => item.id === target)
    if (!group) throw new Error('Group no longer exists')
    group.cardIds.push(...cardIds)
  }
  return next.filter(group => group.cardIds.length > 0)
}
