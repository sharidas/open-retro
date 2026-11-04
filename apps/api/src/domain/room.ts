export type RoomState = 'writing' | 'revealed' | 'closed'

// IDs, secrets, and timestamps belong to later persistence/access tasks.
export interface Room {
  readonly columns: readonly string[]
  readonly state: RoomState
}

export class RoomRuleError extends Error {
  constructor(public readonly code: 'INVALID_COLUMNS' | 'INVALID_TRANSITION', message: string) {
    super(message)
    this.name = 'RoomRuleError'
  }
}

export function createRoom(columns: unknown): Room {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 5) {
    throw new RoomRuleError('INVALID_COLUMNS', 'A room needs between one and five columns.')
  }

  const names: string[] = []
  for (const column of columns) {
    if (typeof column !== 'string' || column.trim().length === 0) {
      throw new RoomRuleError('INVALID_COLUMNS', 'Each column needs a nonempty name.')
    }
    names.push(column.trim())
  }

  return { columns: names, state: 'writing' }
}

export function transitionRoom(room: Room, next: RoomState): Room {
  const allowed =
    (room.state === 'writing' && next === 'revealed') ||
    (room.state === 'revealed' && next === 'closed')

  if (!allowed) {
    throw new RoomRuleError('INVALID_TRANSITION', `Cannot move a room from ${room.state} to ${next}.`)
  }

  return { ...room, state: next }
}
