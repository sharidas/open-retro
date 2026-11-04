import type { CSSProperties } from 'react'

export const palette = {
  sage: { label: 'Sage', tint: '#eaf0e6', accent: '#66815b' },
  peach: { label: 'Peach', tint: '#f6ece5', accent: '#ad7353' },
  blue: { label: 'Blue', tint: '#e8edf6', accent: '#637ea9' },
  lavender: { label: 'Lavender', tint: '#f1eaf4', accent: '#9370a2' },
  sand: { label: 'Sand', tint: '#f5efd9', accent: '#a58b3d' },
} as const
export type ColumnColor = keyof typeof palette
export const colorNames = Object.keys(palette) as ColumnColor[]
export function isColumnColor(value: unknown): value is ColumnColor {
  return typeof value === 'string' && Object.hasOwn(palette, value)
}
export function columnStyle(color: unknown, index = 0): CSSProperties {
  const entry = palette[isColumnColor(color) ? color : colorNames[index % colorNames.length]]
  return { '--column-tint': entry.tint, '--column-accent': entry.accent } as CSSProperties
}
export const templates = [
  { id: 'classic', name: 'Classic retro', description: 'Reflect on the sprint and choose what comes next.', columns: ['Went well', 'Could improve', 'Next steps'], colors: ['sage', 'peach', 'blue'] },
  { id: 'start-stop-continue', name: 'Start, Stop, Continue', description: 'Find the habits to change and the ones to keep.', columns: ['Start', 'Stop', 'Continue'], colors: ['blue', 'peach', 'sage'] },
  { id: 'mad-sad-glad', name: 'Mad, Sad, Glad', description: 'Make space for how the sprint felt.', columns: ['Mad', 'Sad', 'Glad'], colors: ['peach', 'blue', 'sand'] },
  { id: '4ls', name: '4Ls', description: 'Explore learning, strengths, and unmet needs.', columns: ['Liked', 'Learned', 'Lacked', 'Longed for'], colors: ['sage', 'blue', 'peach', 'lavender'] },
] as const
