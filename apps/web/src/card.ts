export type Card = { id: string; columnIndex: number; text: string }
export function isCard(value: unknown, columnCount: number): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return typeof card.id === 'string' && /^[0-9a-f-]{36}$/.test(card.id) &&
    typeof card.columnIndex === 'number' && Number.isInteger(card.columnIndex) &&
    card.columnIndex >= 0 && card.columnIndex < columnCount && typeof card.text === 'string'
}

