import { RoomRuleError } from './room.js'

export const COLUMN_COLORS = ['sage', 'peach', 'blue', 'lavender', 'sand'] as const
export type ColumnColor = typeof COLUMN_COLORS[number]
export function columnColors(value: unknown, count: number): ColumnColor[] {
  if (value === undefined) return Array.from({ length: count }, (_, index) => COLUMN_COLORS[index % COLUMN_COLORS.length])
  if (!Array.isArray(value) || value.length !== count || !value.every(color => COLUMN_COLORS.includes(color))) {
    throw new RoomRuleError('INVALID_COLUMNS', 'Choose one supported colour for each column.')
  }
  return [...value] as ColumnColor[]
}
